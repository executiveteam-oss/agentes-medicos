// ============================================================
// Agente principal de citas — Orquesta la conversación
//
// FLUJO:
// 1. Recibe mensaje del paciente + historial + datos clínica
// 2. Envía todo a Claude con el system prompt y las tools
// 3. Si Claude quiere usar una tool → la ejecutamos y le damos el resultado
// 4. Repetimos hasta que Claude responda con texto (máx 5 vueltas)
// 5. Devolvemos la respuesta final para enviar por WhatsApp
//
// Máx 5 iteraciones de tools para evitar loops infinitos
// ============================================================

import { anthropic, CLAUDE_CONFIG } from '@/lib/anthropic/client'
import { agentTools } from '@/lib/anthropic/tools'
import { buildSystemPrompt } from '@/agents/prompts/system-prompt'
import { executeTool } from '@/agents/tools/executor'
import type { Clinic, ConsultationType, Doctor, Message, WhatsAppConfig } from '@/types/database'
import type { ContentBlock, MessageParam, ToolResultBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'

const MAX_TOOL_ITERATIONS = 5 // Máximo de veces que Claude puede usar tools en una conversación

interface ExistingPatientData {
  name: string
  phone: string
  document_type: string | null
  document_number: string | null
  date_of_birth: string | null
  eps: string | null
  email: string | null
  total_appointments: number
  no_show_count: number
}

interface AgentParams {
  patientMessage: string      // Lo que el paciente escribió
  messageHistory: Message[]   // Últimos 20 mensajes de la conversación
  clinic: Clinic
  doctor: Doctor              // Doctor principal (primer activo)
  doctors?: Doctor[]          // Todos los doctores activos (multi-doctor)
  waConfig?: WhatsAppConfig   // Configuración del agente
  consultationTypes?: ConsultationType[]  // Tipos de consulta por doctor
  patientPhone: string        // Para pasarle a las tools
  patientName: string         // Nombre del paciente
  existingPatient?: ExistingPatientData | null  // Datos si es paciente recurrente
}

export interface AppointmentData {
  id: string              // appointment.id (UID del .ics)
  starts_at: string       // ISO timestamp
  ends_at: string         // ISO timestamp
  doctor_name: string
  consultation_type: string | null
  sequence: number        // 0 = nueva, 1+ = reagendada/cancelada
}

interface AgentResponse {
  text: string                // Respuesta para enviar por WhatsApp
  toolsUsed: string[]         // Qué tools se usaron (para auditoría)
  tokenUsage: {               // Tokens consumidos (para tracking de costos)
    input: number
    output: number
  }
  appointmentData?: AppointmentData  // Datos de cita creada/reagendada/cancelada (para .ics)
}

/**
 * Ejecuta el agente de citas — el "cerebro" que procesa cada mensaje
 *
 * Funciona como un loop:
 * 1. Le enviamos el mensaje a Claude
 * 2. Si Claude responde con texto → esa es la respuesta final
 * 3. Si Claude quiere usar una tool → la ejecutamos, le damos el resultado, y volvemos al paso 1
 * 4. Máximo 5 vueltas de tools para evitar que se quede en un ciclo infinito
 */
export async function runAppointmentAgent(params: AgentParams): Promise<AgentResponse> {
  const { patientMessage, messageHistory, clinic, doctor, doctors, waConfig, consultationTypes, patientPhone, patientName, existingPatient } = params

  // 1. Generar el system prompt con datos reales de la clínica y del paciente actual
  const allDoctors = doctors && doctors.length > 0 ? doctors : [doctor]
  const systemPrompt = buildSystemPrompt({ clinic, doctor, doctors: allDoctors, waConfig, consultationTypes, patientPhone, patientName, existingPatient })

  // 2. Construir el historial de mensajes para Claude
  //    Tomamos los últimos 20 mensajes para dar contexto sin gastar muchos tokens
  const messages: MessageParam[] = buildMessageHistory(messageHistory)

  // Agregar el mensaje nuevo del paciente
  messages.push({
    role: 'user',
    content: patientMessage,
  })

  // 3. Loop de tool-use: Claude puede usar hasta 5 tools antes de responder
  const toolsUsed: string[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0

  let appointmentData: AppointmentData | undefined

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    // Llamar a Claude
    const response = await anthropic.messages.create({
      model: CLAUDE_CONFIG.model,
      max_tokens: CLAUDE_CONFIG.maxTokens,
      temperature: CLAUDE_CONFIG.temperature,
      system: systemPrompt,
      tools: agentTools,
      messages,
    })

    // Acumular tokens de cada llamada
    totalInputTokens += response.usage?.input_tokens ?? 0
    totalOutputTokens += response.usage?.output_tokens ?? 0

    // Si Claude terminó de hablar (no quiere más tools) → devolver texto
    if (response.stop_reason === 'end_turn') {
      const textContent = response.content.find(
        (block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text'
      )
      return {
        text: textContent?.text ?? 'Lo siento, tuve un problema. Escribe "hablar con humano" para asistencia.',
        toolsUsed,
        tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
        appointmentData,
      }
    }

    // Si Claude quiere usar tools → ejecutarlas
    if (response.stop_reason === 'tool_use') {
      // Encontrar todos los tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      )

      // Agregar la respuesta de Claude (con los tool_use) al historial
      messages.push({
        role: 'assistant',
        content: response.content,
      })

      // Ejecutar cada tool y recopilar resultados
      const toolResults: ToolResultBlockParam[] = []

      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name)

        // Ejecutar la tool con los parámetros que Claude envió
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          clinic.id,
          clinic,
          doctor
        )

        // Capture appointment data for .ics calendar invite
        const resultObj = result as unknown as Record<string, unknown> | null
        const resultData = resultObj?.data as Record<string, unknown> | undefined
        console.log(`[Agent] Tool ${toolUse.name} result: success=${resultObj?.success}, hasAppointmentData=${!!resultData?.appointmentData}`)
        if (resultObj?.success && resultData?.appointmentData) {
          appointmentData = resultData.appointmentData as AppointmentData
          console.log(`[Agent] Captured appointmentData: id=${appointmentData.id}, seq=${appointmentData.sequence}`)
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      // Agregar los resultados al historial para que Claude los vea
      messages.push({
        role: 'user',
        content: toolResults,
      })

      // Continuar el loop — Claude verá los resultados y decidirá qué hacer
      continue
    }

    // Si llegamos aquí es un stop_reason inesperado — devolver lo que haya
    const fallbackText = response.content.find(
      (block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text'
    )
    return {
      text: fallbackText?.text ?? 'Disculpa, tuve un problema técnico. Intenta de nuevo o escribe "hablar con humano".',
      toolsUsed,
      tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
      appointmentData,
    }
  }

  // Si agotamos las 5 iteraciones, algo salió mal
  return {
    text: 'Disculpa, estoy teniendo dificultades. Escribe "hablar con humano" y alguien del consultorio te ayudará.',
    toolsUsed,
    tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
    appointmentData,
  }
}

/**
 * Convierte mensajes de la DB al formato que Claude espera
 *
 * Claude espera un array alternando "user" y "assistant":
 * - patient → role: "user"
 * - agent → role: "assistant"
 * - staff → role: "assistant" (el humano del consultorio también es "assistant" para Claude)
 *
 * Tomamos los últimos 20 mensajes para dar contexto sin gastar muchos tokens
 */
function buildMessageHistory(messages: Message[]): MessageParam[] {
  // Tomar los últimos 20 mensajes
  const recentMessages = messages.slice(-20)

  const history: MessageParam[] = []

  for (const msg of recentMessages) {
    const role: 'user' | 'assistant' = msg.role === 'patient' ? 'user' : 'assistant'

    // Claude no permite dos mensajes seguidos del mismo rol
    // Si hay dos seguidos, los concatenamos
    const lastMessage = history[history.length - 1]
    if (lastMessage && lastMessage.role === role && typeof lastMessage.content === 'string') {
      lastMessage.content += '\n' + msg.content
    } else {
      history.push({
        role,
        content: msg.content,
      })
    }
  }

  // Claude requiere que el primer mensaje sea del usuario
  // Si el historial empieza con assistant, quitamos ese mensaje
  if (history.length > 0 && history[0].role === 'assistant') {
    history.shift()
  }

  return history
}
