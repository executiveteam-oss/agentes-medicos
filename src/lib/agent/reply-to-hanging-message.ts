// ============================================================
// "Devolver al agente" (Etapa 3) — re-corre el agente sobre el ÚLTIMO mensaje
// del paciente que quedó SIN respuesta (el "colgado" al escalar) y lo contesta,
// sin esperar al próximo. Usa EXACTAMENTE el mismo contexto que el webhook
// (agent-context.ts) → mismo input, misma respuesta. Nunca lanza. Si el agente
// vuelve a escalar (contenido ruleado/crisis), re-escala (defensa).
// ============================================================
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import { stripTimestampMarkers } from '@/lib/whatsapp/strip-timestamp-markers'
import { refreshEscalationNotifications } from '@/lib/notifications/escalation-notify'
import {
  getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes,
  buildExistingPatient, resolveTratantesForClinic,
} from '@/lib/agent/agent-context'
import type { Clinic, Patient, Message } from '@/types/database'

export interface HangingReplyResult {
  replied: boolean
  escalatedAgain?: boolean
  reason?: 'no_hanging_message' | 'no_creds' | 'no_doctors' | 'error'
}

export async function replyToHangingMessage(conversationId: string): Promise<HangingReplyResult> {
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, clinic_id, whatsapp_phone, patients(*)')
      .eq('id', conversationId)
      .single()
    const patient = (conv?.patients as unknown as Patient | null) ?? null
    if (!conv || !patient) return { replied: false, reason: 'no_hanging_message' }

    const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', conv.clinic_id).single()
    if (!clinicRow) return { replied: false, reason: 'error' }
    const clinic = clinicRow as Clinic

    const clinicCreds = clinic.whatsapp_phone_id && clinic.whatsapp_access_token
      ? { phoneNumberId: clinic.whatsapp_phone_id, accessToken: clinic.whatsapp_access_token }
      : null
    if (!clinicCreds) return { replied: false, reason: 'no_creds' }

    // Historial cronológico (últimos 20). El colgado = último, y debe ser del
    // paciente (si el último es agent/staff, ya fue contestado → nada colgado).
    const { data: raw } = await supabaseAdmin
      .from('messages').select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(20)
    const history = ((raw ?? []) as Message[]).reverse()
    const last = history[history.length - 1]
    if (!last || last.role !== 'patient') return { replied: false, reason: 'no_hanging_message' }

    const patientMessage = last.content
    const priorHistory = history.slice(0, -1)   // el colgado va como patientMessage, no en el historial

    // MISMO contexto que el webhook — fuente única en agent-context.ts.
    const waConfig = getWhatsAppConfig(clinic)
    const doctors = await findActiveDoctors(clinic.id, waConfig)
    if (doctors.length === 0) return { replied: false, reason: 'no_doctors' }
    const consultationTypes = await findActiveConsultationTypes(clinic.id)
    const existingPatient = buildExistingPatient(patient)
    const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic, patient, conversationId)

    const agentResponse = await runAppointmentAgent({
      patientMessage, messageHistory: priorHistory, clinic, doctor: doctors[0], doctors, waConfig,
      consultationTypes, patientPhone: patient.phone, patientName: patient.name,
      existingPatient, tratanteMode, tratantes,
    })

    const text = stripTimestampMarkers(agentResponse.text).text
    await sendWhatsAppMessage(conv.whatsapp_phone.replace('+', ''), text, clinicCreds)
    await supabaseAdmin.from('messages').insert({ conversation_id: conversationId, role: 'agent', content: text, message_type: 'text' })
    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

    // El agente puede volver a escalar (servicio ruleado / crisis / falla) — re-escala.
    if (agentResponse.escalate) {
      const r = agentResponse.escalate.reason
      const escReason = r === 'tool_technical_error' ? 'error_tecnico_tool' : r === 'booking_failure' ? 'falla_agendamiento' : 'reescalado_por_agente'
      await supabaseAdmin.from('conversations')
        .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: escReason } })
        .eq('id', conversationId)
      await refreshEscalationNotifications({ conversationId, clinicId: clinic.id, patientName: patient.name, latestMessage: `El agente volvió a escalar tras devolver (${agentResponse.escalate.code})` })
      return { replied: true, escalatedAgain: true }
    }

    return { replied: true }
  } catch (err) {
    console.error('[replyToHangingMessage] error (no crítico):', err)
    return { replied: false, reason: 'error' }
  }
}
