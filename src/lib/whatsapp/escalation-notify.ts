// ============================================================
// Notificación de escalamiento al equipo del consultorio
// Envía WhatsApp al número configurado en la clínica
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from './client'
import { sendEmail } from '@/lib/email/client'
import type { ClinicWhatsAppCredentials } from './client'

interface EscalationNotifyParams {
  clinicId: string
  patientName: string | null
  patientPhone: string
  lastPatientMessage: string
  clinicCreds: ClinicWhatsAppCredentials | null
}

/**
 * Envía una notificación WhatsApp al contacto de escalamiento de la clínica.
 * Si no hay número configurado, no hace nada (silencioso).
 * Nunca lanza excepciones — todo es fire-and-forget.
 */
export async function notifyEscalationContact({
  clinicId,
  patientName,
  patientPhone,
  lastPatientMessage,
  clinicCreds,
}: EscalationNotifyParams): Promise<void> {
  try {
    // Buscar número de escalamiento configurado
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('escalation_contact_phone')
      .eq('id', clinicId)
      .single()

    const rawPhone = (clinic as Record<string, unknown> | null)?.escalation_contact_phone as string | null
    if (!rawPhone) {
      console.log('[Escalation] No escalation_contact_phone configured — skipping notification')
      return
    }

    // Normalizar número (remover espacios, guiones, asegurar formato sin +)
    const contactPhone = rawPhone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '')

    // Formatear hora Colombia
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
    const hours = now.getHours()
    const minutes = now.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const h12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours
    const timeStr = `${h12}:${String(minutes).padStart(2, '0')} ${ampm}`

    // Truncar mensaje del paciente a 100 caracteres
    const truncatedMsg = lastPatientMessage.length > 100
      ? lastPatientMessage.slice(0, 100) + '...'
      : lastPatientMessage

    const displayName = patientName || 'Paciente nuevo'

    const message = [
      `🚨 *Escalamiento en Omuwan*`,
      ``,
      `Paciente: ${displayName}`,
      `Número: ${patientPhone}`,
      `Motivo: ${truncatedMsg}`,
      `Hora: ${timeStr}`,
      ``,
      `👉 Ver conversación:`,
      `https://agentes-medicos-ten.vercel.app/dashboard/conversations`,
    ].join('\n')

    await sendWhatsAppMessage(contactPhone, message, clinicCreds)
    console.log(`[Escalation] WhatsApp notification sent to ${contactPhone.slice(0, 5)}***`)

    // También notificar por email (redundancia)
    const escalationEmail = process.env.ESCALATION_EMAIL ?? 'executive.team@loncocapital.com'

    const { data: clinicInfo } = await supabaseAdmin
      .from('clinics')
      .select('name')
      .eq('id', clinicId)
      .maybeSingle()
    const clinicNameForEmail = (clinicInfo as { name: string } | null)?.name ?? 'Consultorio'

    await sendEmail({
      to: escalationEmail,
      subject: `🚨 Paciente necesita atención — ${clinicNameForEmail}`,
      html: `
        <div style="font-family: -apple-system, sans-serif; color: #1e293b;">
          <p><strong>Escalamiento en ${clinicNameForEmail}</strong></p>
          <table style="border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Paciente</td><td>${displayName}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Número</td><td>${patientPhone}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Motivo</td><td>${truncatedMsg}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Hora</td><td>${timeStr}</td></tr>
          </table>
          <p style="margin-top: 16px;">
            <a href="https://agentes-medicos-ten.vercel.app/dashboard/conversations" style="color: #028090;">Ver conversación →</a>
          </p>
        </div>
      `,
    })
    console.log(`[Escalation] Email notification sent to ${escalationEmail}`)
  } catch (error) {
    // Fire-and-forget — nunca bloquear el flujo principal
    console.error('[Escalation] Error sending notification (non-critical):', error)
  }
}
