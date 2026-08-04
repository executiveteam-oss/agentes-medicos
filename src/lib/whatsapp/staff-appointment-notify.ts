// ============================================================
// Notificación al staff cuando el agente crea una cita
//
// ⏳ TRANSITORIO — muere cuando Algia corte iSalud. Mitiga el gap de la
// transición Algia ↔ iSalud (sync unidireccional): el staff que sigue operando
// en iSalud NO ve las citas creadas por el agente en Omuwan. Les llega por
// WhatsApp a clinic.phone para que espejen a mano ANTES de doble-agendar. NO es
// el canal de escalaciones (ese vive en el tablero: campana + Atención).
//
// Comportamiento:
//   - Si clinic.phone es NULL → silencioso, no hace nada
//   - Si las credenciales WA están incompletas → silencioso
//   - Fire-and-forget: nunca lanza excepciones al caller
//   - El error log queda para depurar pero no rompe el flujo del agente
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from './client'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { es } from 'date-fns/locale'

const TIMEZONE = 'America/Bogota'

interface StaffAppointmentNotifyParams {
  clinicId: string
  patientName: string | null
  patientPhone: string
  doctorName: string
  startsAt: string // ISO string en UTC
  endsAt: string   // ISO string en UTC
  consultationTypeName: string | null
  reason: string | null
  modality: string // 'presencial' | 'virtual' — widened para compat con executor
}

/**
 * Notifica al staff de la clínica (vía WhatsApp a clinic.phone)
 * que el agente acaba de crear una cita.
 *
 * Fire-and-forget: nunca lanza. Si no hay número de escalamiento, no hace nada.
 */
export async function notifyStaffAppointmentCreated(
  params: StaffAppointmentNotifyParams,
): Promise<void> {
  try {
    // ⏳ TRANSITORIO (puente Algia↔iSalud): mientras las secretarias espejen a
    // mano en iSalud lo que agenda el agente, esto va por WhatsApp a clinic.phone
    // — si solo sonara en la campana se les pasarían las citas creadas de noche.
    // MUERE cuando Algia corte iSalud. NO es el canal de escalaciones (ese vive
    // en el tablero); es la señal operativa del doble-agendamiento.
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('phone, whatsapp_phone_id, whatsapp_access_token, name')
      .eq('id', params.clinicId)
      .single()

    const rec = clinic as Record<string, unknown> | null
    const rawPhone = rec?.phone as string | null
    const phoneId = rec?.whatsapp_phone_id as string | null
    const accessToken = rec?.whatsapp_access_token as string | null

    if (!rawPhone) {
      console.log('[StaffNotify] clinic.phone no configurado — skip')
      return
    }
    if (!phoneId || !accessToken) {
      console.log('[StaffNotify] credenciales WhatsApp incompletas en clinic — skip')
      return
    }

    const contactPhone = rawPhone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '')
    const clinicCreds = { phoneNumberId: phoneId, accessToken }

    // Formateo de fecha/hora en Bogota
    const startBog = toZonedTime(new Date(params.startsAt), TIMEZONE)
    const endBog = toZonedTime(new Date(params.endsAt), TIMEZONE)
    const dayStr = format(startBog, "EEEE d 'de' MMMM", { locale: es })
    const startTimeStr = format(startBog, 'h:mm a', { locale: es })
    const endTimeStr = format(endBog, 'h:mm a', { locale: es })

    const displayPatient = params.patientName?.trim() || 'Paciente'
    const patientPhoneClean = params.patientPhone.replace(/^\+?57/, '').trim()

    const lines = [
      `📅 *Nueva cita agendada por el agente*`,
      ``,
      `Paciente: ${displayPatient}`,
      `Tel: ${patientPhoneClean}`,
      `Médico: ${params.doctorName}`,
      `Día: ${dayStr}`,
      `Hora: ${startTimeStr} → ${endTimeStr}`,
    ]
    if (params.consultationTypeName) {
      lines.push(`Tipo: ${params.consultationTypeName}`)
    }
    if (params.reason && params.reason.trim() && params.reason !== params.consultationTypeName) {
      lines.push(`Motivo: ${params.reason.slice(0, 80)}`)
    }
    if (params.modality === 'virtual') {
      lines.push(`Modalidad: Virtual`)
    }
    lines.push(``)
    lines.push(`👉 Ver agenda completa:`)
    lines.push(`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://omuwan.co'}/dashboard/agenda`)
    lines.push(``)
    lines.push(`⚠️ Recordá NO agendar esta hora en iSalud — ya está bloqueada en Omuwan.`)

    const message = lines.join('\n')
    await sendWhatsAppMessage(contactPhone, message, clinicCreds, { clinicId: params.clinicId, sendType: 'staff_appointment' })
    console.log(`[StaffNotify] WhatsApp enviado a ${contactPhone.slice(0, 5)}*** por nueva cita en ${(rec?.name as string) ?? params.clinicId.slice(0, 8)}`)
  } catch (err) {
    // Fire-and-forget — nunca bloquear el flujo del agente
    console.error('[StaffNotify] Error no crítico (cita ya creada, solo falló la notificación):', err)
  }
}
