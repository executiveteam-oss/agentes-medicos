// ============================================================
// Help Chatbot API — SSE streaming endpoint
// POST /api/chatbot/help
// Auth: requires Supabase session
// Rate limit: 20/min + 200/day per user
// ============================================================

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkRateLimitAsync, RATE_LIMITS } from '@/lib/rate-limit'
import { buildChatbotSystemPrompt } from '@/lib/chatbot/system-prompt'
import { chatbotTools, INTERNAL_TOOLS } from '@/lib/chatbot/tools'
import type { Permissions } from '@/types/permissions'

const anthropic = new Anthropic()

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  // ---- Auth ----
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Get clinic user for permissions + clinic_id
  const { data: clinicUser } = await supabaseAdmin
    .from('clinic_users')
    .select('id, clinic_id, role_id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!clinicUser) {
    return Response.json({ error: 'Usuario no vinculado a clinica' }, { status: 403 })
  }

  // Get permissions
  const { data: role } = await supabaseAdmin
    .from('clinic_roles')
    .select('permissions')
    .eq('id', clinicUser.role_id)
    .single()

  const permissions = (role?.permissions ?? {}) as Permissions

  // ---- Rate limit (dual: rpm + rpd, async with Upstash await) ----
  const rpmCheck = await checkRateLimitAsync(`chatbot:rpm:${clinicUser.id}`, RATE_LIMITS.chatbotRpm, 'RateLimit-Chatbot')
  if (!rpmCheck.allowed) {
    return Response.json(
      { error: 'Has hecho muchas preguntas. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rpmCheck.resetAt - Date.now()) / 1000)) } }
    )
  }

  const rpdCheck = await checkRateLimitAsync(`chatbot:rpd:${clinicUser.id}`, RATE_LIMITS.chatbotRpd, 'RateLimit-Chatbot')
  if (!rpdCheck.allowed) {
    return Response.json(
      { error: 'Has alcanzado el limite de preguntas del dia. Vuelve manana.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rpdCheck.resetAt - Date.now()) / 1000)) } }
    )
  }

  // ---- Parse body ----
  let body: { messages: ChatMessage[]; sessionId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body invalido' }, { status: 400 })
  }

  const { messages, sessionId } = body

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages requerido' }, { status: 400 })
  }

  // Truncate last user message to 2000 chars
  const lastMsg = messages[messages.length - 1]
  if (lastMsg.role === 'user' && lastMsg.content.length > 2000) {
    lastMsg.content = lastMsg.content.slice(0, 2000)
  }

  // ---- Telemetry: create or update conversation ----
  let convId = sessionId ?? null
  if (!convId) {
    const { data: conv } = await supabaseAdmin
      .from('chatbot_conversations')
      .insert({ clinic_id: clinicUser.clinic_id, user_id: user.id, message_count: 1 })
      .select('id')
      .single()
    convId = conv?.id ?? null
  } else {
    await supabaseAdmin
      .from('chatbot_conversations')
      .update({ last_message_at: new Date().toISOString(), message_count: messages.length })
      .eq('id', convId)
  }

  // ---- Build system prompt with filtered KB ----
  const system = buildChatbotSystemPrompt(permissions)

  // ---- Stream response ----
  const encoder = new TextEncoder()
  const kbFilesUsed: string[] = []
  let navigateCount = 0

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          temperature: 0.3,
          system,
          tools: chatbotTools,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        })

        let currentToolName = ''
        let currentToolInput = ''

        for await (const event of response) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'text') {
              // Text block starting
            } else if (event.content_block.type === 'tool_use') {
              currentToolName = event.content_block.name
              currentToolInput = ''
            }
          }

          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              send({ type: 'text', content: event.delta.text })
            } else if (event.delta.type === 'input_json_delta') {
              currentToolInput += event.delta.partial_json
            }
          }

          if (event.type === 'content_block_stop') {
            if (currentToolName) {
              try {
                const input = JSON.parse(currentToolInput)

                if (INTERNAL_TOOLS.has(currentToolName)) {
                  // Internal tool — intercept, don't stream to client
                  if (currentToolName === 'log_kb_used' && Array.isArray(input.kb_files)) {
                    kbFilesUsed.push(...input.kb_files)
                  }
                } else {
                  // User-facing tool — stream to client
                  send({ type: 'tool_use', tool: currentToolName, input })
                  if (currentToolName === 'navigate_to') navigateCount++
                }
              } catch {
                // JSON parse failed — skip tool
              }
              currentToolName = ''
              currentToolInput = ''
            }
          }

          if (event.type === 'message_delta') {
            // Message complete — send usage stats
            const usage = (event as unknown as Record<string, unknown>).usage as Record<string, number> | undefined
            send({ type: 'done', sessionId: convId, usage: usage ?? {} })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error del servicio de ayuda'
        send({ type: 'error', message: msg })
      } finally {
        // ---- Save KB topics used ----
        if (convId && kbFilesUsed.length > 0) {
          const uniqueFiles = [...new Set(kbFilesUsed)]
          try {
            await supabaseAdmin.from('chatbot_topics_used').insert(
              uniqueFiles.map((f) => ({ conversation_id: convId, kb_file: f }))
            )
          } catch { /* telemetry is non-critical */ }
        }

        // Update navigate_to count
        if (convId && navigateCount > 0) {
          try {
            const { data: current } = await supabaseAdmin
              .from('chatbot_conversations')
              .select('navigate_to_calls')
              .eq('id', convId)
              .single()
            await supabaseAdmin
              .from('chatbot_conversations')
              .update({ navigate_to_calls: (current?.navigate_to_calls ?? 0) + navigateCount })
              .eq('id', convId)
          } catch { /* telemetry non-critical */ }
        }

        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
