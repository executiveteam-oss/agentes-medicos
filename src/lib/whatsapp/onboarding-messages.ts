// ============================================================
// WhatsApp: Secuencia de bienvenida al admin de nueva clínica
// Se envía UNA sola vez cuando whatsapp_connected = true
// por primera vez. 2 mensajes con 1 min de delay.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, type ClinicWhatsAppCredentials } from '@/lib/whatsapp/client'

const MESSAGE_1 =
  '¡Hola! 👋 Soy Omuwan, el asistente de tu consultorio.\n' +
  'Ya estoy configurado y listo para atender a tus pacientes.\n\n' +
  'Para que funcione perfecto, necesito que completes 3 cosas rápidas en el dashboard. ¿Empezamos?'

const MESSAGE_2 =
  'Aquí está tu checklist de activación:\n\n' +
  '1️⃣ Agrega los horarios de tus médicos\n' +
  '2️⃣ Configura los tipos de consulta\n' +
  '3️⃣ Haz una prueba — escríbeme como si fueras un paciente\n\n' +
  '👉 dashboard.omuwan.co/dashboard\n\n' +
  '¿Tienes alguna duda? Escríbeme aquí mismo.'

/**
 * Envía la secuencia de onboarding por WhatsApp al teléfono del admin.
 * Solo se ejecuta si whatsapp_onboarding_sent = false.
 * Marca la clínica como enviada para nunca repetir.
 */
export async function sendWhatsAppOnboardingSequence(
  clinicId: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<void> {
  try {
    // Verificar que no se haya enviado antes
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_onboarding_sent, phone, escalation_contact_phone')
      .eq('id', clinicId)
      .single()

    if (!clinic || clinic.whatsapp_onboarding_sent) return

    // Usar escalation_contact_phone primero, luego phone de la clínica
    const adminPhone = (clinic.escalation_contact_phone || clinic.phone || '').trim()
    if (!adminPhone) return

    const whatsappNumber = adminPhone.replace('+', '')

    // Marcar como enviado ANTES de enviar (para evitar duplicados en caso de retry)
    await supabaseAdmin
      .from('clinics')
      .update({ whatsapp_onboarding_sent: true })
      .eq('id', clinicId)

    // Mensaje 1 — inmediato
    await sendWhatsAppMessage(whatsappNumber, MESSAGE_1, clinicCreds)

    // Mensaje 2 — 1 minuto después
    setTimeout(async () => {
      try {
        await sendWhatsAppMessage(whatsappNumber, MESSAGE_2, clinicCreds)
      } catch (err) {
        console.error('[WhatsApp:Onboarding] Error enviando mensaje 2:', err)
      }
    }, 60_000)

    console.log(`[WhatsApp:Onboarding] Secuencia enviada a ${adminPhone.slice(0, 6)}*** para clínica ${clinicId}`)
  } catch (err) {
    console.error('[WhatsApp:Onboarding] Error:', err)
  }
}
