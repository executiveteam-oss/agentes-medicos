// ============================================================
// API Route — Asistente IA interno del dashboard
// Ruta: POST /api/dashboard/asistente
//
// El asistente puede consultar datos de la clínica y tomar
// acciones sobre citas/recordatorios con confirmación previa.
//
// PATRÓN: action tools requieren confirmación del usuario
// antes de ejecutarse. Se retorna pendingAction sin ejecutar.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/anthropic/client'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { trackTokenUsage, isClinicPaused } from '@/lib/api-usage'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { formatCOP, formatForPatient, nowColombia } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { z } from 'zod'

// Zod schema para validar el body del request
const asistenteRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10000),
  })).min(1).max(50),
  confirmedAction: z.object({
    toolName: z.string(),
    params: z.record(z.string(), z.unknown()),
    description: z.string(),
  }).optional(),
})
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

// Tools de solo lectura — se ejecutan automáticamente
const READ_ONLY_TOOLS = [
  {
    name: 'get_today_appointments',
    description: 'Obtener las citas del día con estado y paciente',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_noshow_stats',
    description: 'Estadísticas de no-shows: tasa, total, costo estimado',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Número de días hacia atrás (default 30)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_waitlist',
    description: 'Ver pacientes en lista de espera',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_cartera',
    description: 'Ver deudas pendientes en cartera',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

// Tools de acción — requieren confirmación del usuario antes de ejecutarse
const ACTION_TOOLS = [
  {
    name: 'send_whatsapp_reminder',
    description: 'Enviar un recordatorio por WhatsApp a un paciente. REQUIERE CONFIRMACIÓN del staff antes de ejecutar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita' },
        message: { type: 'string', description: 'Mensaje a enviar (máx 4096 chars)' },
      },
      required: ['appointment_id', 'message'],
    },
  },
  {
    name: 'update_appointment_status',
    description: 'Cambiar el estado de una cita (completed, no_show, cancelled). REQUIERE CONFIRMACIÓN del staff.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita' },
        new_status: {
          type: 'string',
          enum: ['completed', 'no_show', 'cancelled'],
          description: 'Nuevo estado',
        },
      },
      required: ['appointment_id', 'new_status'],
    },
  },
]

interface PendingAction {
  toolName: string
  params: Record<string, unknown>
  description: string
}

export async function POST(req: NextRequest) {
  try {
    // Autenticación: verificar sesión y obtener clinic_id
    const session = await getUserSession()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const clinicId = session.clinicId

    // Verificar permiso de lectura en módulo asistente
    if (!session.permissions.asistente?.read) {
      return NextResponse.json({ error: 'Sin permiso para usar el asistente' }, { status: 403 })
    }

    // Rate limit: 20 req/min por clínica
    const rateLimit = checkRateLimit(`asistente:${clinicId}`, RATE_LIMITS.asistente)
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
    }

    // Verificar si la clínica está pausada por exceder tokens
    if (await isClinicPaused(clinicId)) {
      return NextResponse.json({
        error: 'Has alcanzado el límite mensual de uso del asistente IA. Contacta soporte para aumentar tu plan.',
      }, { status: 429 })
    }

    const rawBody = await req.json()
    const parsed = asistenteRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 })
    }
    const { messages, confirmedAction } = parsed.data

    // Si el usuario confirmó una acción pendiente, ejecutarla
    if (confirmedAction) {
      // Verificar permiso de escritura para acciones
      if (!session.permissions.asistente?.write) {
        return NextResponse.json({ error: 'Sin permiso para ejecutar acciones' }, { status: 403 })
      }
      const result = await executeActionTool(confirmedAction.toolName, confirmedAction.params, clinicId)
      return NextResponse.json({ reply: result, pendingAction: null })
    }

    // Obtener contexto de la clínica autenticada
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('id, name, consultation_price, daily_goal_appointments')
      .eq('id', clinicId)
      .single()

    if (!clinic) {
      return NextResponse.json({ error: 'No hay clínica configurada' }, { status: 404 })
    }

    const now = nowColombia()
    const todayStr = format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })

    const systemPrompt = `Eres el asistente interno del consultorio médico ${clinic.name}.
Ayudas al staff del consultorio a entender y gestionar la agenda, pacientes y operaciones.

FECHA Y HORA ACTUAL: ${todayStr}, ${format(now, 'h:mm a')}
PRECIO CONSULTA: ${clinic.consultation_price ? formatCOP(clinic.consultation_price) : 'No configurado'}
META DIARIA: ${clinic.daily_goal_appointments ?? 8} citas

CAPACIDADES:
- Consultar citas del día, estadísticas, lista de espera, cartera
- Proponer recordatorios y cambios de estado de citas (REQUIEREN CONFIRMACIÓN antes de ejecutar)

REGLAS:
- Responde en español, de forma concisa y profesional
- Para acciones (enviar WhatsApp, cambiar estados): presenta la acción primero, espera confirmación
- Nunca compartas datos de un paciente en contexto de otro
- Si el staff pide algo que no puedes hacer, dilo claramente
- Usa el formato colombiano: pesos sin decimales, horas en AM/PM, fechas en DD/MM/YYYY`

    // Llamada a Claude con todas las tools
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: [...READ_ONLY_TOOLS, ...ACTION_TOOLS],
    })

    // Registrar uso de tokens
    await trackTokenUsage(
      clinicId,
      response.usage?.input_tokens ?? 0,
      response.usage?.output_tokens ?? 0
    )

    // Procesar la respuesta
    let pendingAction: PendingAction | null = null
    let replyText = ''

    for (const block of response.content) {
      if (block.type === 'text') {
        replyText += block.text
      } else if (block.type === 'tool_use') {
        const isActionTool = ACTION_TOOLS.some((t) => t.name === block.name)

        if (isActionTool) {
          // No ejecutar — retornar como pendingAction para confirmación
          pendingAction = {
            toolName: block.name,
            params: block.input as Record<string, unknown>,
            description: getActionDescription(block.name, block.input as Record<string, unknown>),
          }
          break
        } else {
          // Ejecutar tool de lectura
          const toolResult = await executeReadTool(block.name, clinic.id)
          replyText += '\n\n' + toolResult
        }
      }
    }

    return NextResponse.json({
      reply: replyText || 'Procesando...',
      pendingAction,
    })
  } catch (error) {
    console.error('[asistente] Error:', error)
    return NextResponse.json(
      { error: 'Error procesando la solicitud' },
      { status: 500 }
    )
  }
}

// ============================================================
// Ejecutores de tools de solo lectura
// ============================================================
async function executeReadTool(toolName: string, clinicId: string): Promise<string> {
  try {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('consultation_price')
      .eq('id', clinicId)
      .single()

    switch (toolName) {
      case 'get_today_appointments': {
        const today = new Date()
        const todayStr = today.toISOString().split('T')[0]
        const { data: apts } = await supabaseAdmin
          .from('appointments')
          .select('id, starts_at, status, patients(name)')
          .eq('clinic_id', clinicId)
          .gte('starts_at', `${todayStr}T00:00:00-05:00`)
          .lte('starts_at', `${todayStr}T23:59:59-05:00`)
          .in('status', ['confirmed', 'rescheduled', 'completed', 'no_show'])
          .order('starts_at', { ascending: true })

        if (!apts || apts.length === 0) return 'Hoy no hay citas agendadas.'

        const lines = apts.map((a) => {
          const p = a.patients as unknown as { name: string } | null
          const hora = format(new Date(a.starts_at), 'h:mm a', { locale: es })
          const emojiMap: Record<string, string> = { confirmed: '🟡', rescheduled: '🟡', completed: '✅', no_show: '❌', cancelled: '🚫' }
          const statusEmoji = emojiMap[a.status as string] ?? '?'
          return `${statusEmoji} ${hora} — ${p?.name ?? 'Paciente'} (${a.status})`
        })

        return `Citas de hoy (${apts.length}):\n${lines.join('\n')}`
      }

      case 'get_noshow_stats': {
        const { count: total } = await supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .in('status', ['completed', 'no_show'])

        const { count: noShows } = await supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .eq('status', 'no_show')

        const tasa = total && total > 0 ? Math.round(((noShows ?? 0) / total) * 100) : 0
        const costo = (noShows ?? 0) * (clinic?.consultation_price ?? 0)

        return `Estadísticas no-show:\n- Tasa: ${tasa}%\n- Total no-shows: ${noShows ?? 0}\n- Costo estimado perdido: ${formatCOP(costo)}`
      }

      case 'get_waitlist': {
        const { data: waitlist } = await supabaseAdmin
          .from('waitlist')
          .select('id, status, patients(name)')
          .eq('clinic_id', clinicId)
          .eq('status', 'waiting')

        if (!waitlist || waitlist.length === 0) return 'La lista de espera está vacía.'
        const names = waitlist.map((w) => {
          const p = w.patients as unknown as { name: string } | null
          return p?.name ?? 'Paciente'
        })
        return `Lista de espera (${waitlist.length} pacientes):\n${names.map((n) => `• ${n}`).join('\n')}`
      }

      case 'get_cartera': {
        const { data: cartera } = await supabaseAdmin
          .from('cartera')
          .select('amount, days_overdue, patients(name)')
          .eq('clinic_id', clinicId)
          .eq('status', 'pendiente')

        if (!cartera || cartera.length === 0) return 'No hay deudas pendientes en cartera.'
        const total = cartera.reduce((s, e) => s + e.amount, 0)
        const lines = cartera.map((e) => {
          const p = e.patients as unknown as { name: string } | null
          return `• ${p?.name ?? '-'}: ${formatCOP(e.amount)} (${e.days_overdue}d vencida)`
        })
        return `Cartera pendiente — Total: ${formatCOP(total)}\n${lines.join('\n')}`
      }

      default:
        return `Tool "${toolName}" no reconocida`
    }
  } catch (error) {
    console.error(`[readTool:${toolName}]`, error)
    return `Error ejecutando ${toolName}`
  }
}

// ============================================================
// Ejecutores de tools de acción (post-confirmación)
// ============================================================
async function executeActionTool(toolName: string, params: Record<string, unknown>, clinicId: string): Promise<string> {
  try {
    switch (toolName) {
      case 'send_whatsapp_reminder': {
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp/client')
        const { data: apt } = await supabaseAdmin
          .from('appointments')
          .select('patient_id, patients(phone)')
          .eq('id', params.appointment_id as string)
          .eq('clinic_id', clinicId)
          .single()

        if (!apt) return '❌ Cita no encontrada'
        const p = apt.patients as unknown as { phone: string } | null
        if (!p) return '❌ Paciente no encontrado'

        const phone = p.phone.replace('+', '')
        await sendWhatsAppMessage(phone, params.message as string)
        return `✅ Recordatorio enviado por WhatsApp`
      }

      case 'update_appointment_status': {
        const { error } = await supabaseAdmin
          .from('appointments')
          .update({ status: params.new_status, updated_at: new Date().toISOString() })
          .eq('id', params.appointment_id as string)
          .eq('clinic_id', clinicId)

        if (error) return `❌ Error actualizando cita: ${error.message}`
        return `✅ Estado de la cita actualizado a "${params.new_status}"`
      }

      default:
        return `Tool "${toolName}" no reconocida`
    }
  } catch (error) {
    console.error(`[actionTool:${toolName}]`, error)
    return `❌ Error ejecutando ${toolName}`
  }
}

function getActionDescription(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case 'send_whatsapp_reminder':
      return `Enviar mensaje por WhatsApp: "${String(params.message).slice(0, 80)}..."`
    case 'update_appointment_status':
      return `Cambiar estado de cita a "${params.new_status}"`
    default:
      return `Ejecutar acción: ${toolName}`
  }
}
