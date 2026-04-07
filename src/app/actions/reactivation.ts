'use server'

// ============================================================
// Server Actions — Frecuencia de visita y reactivación manual
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { checkWritePermission } from '@/lib/actions-helpers'
import { format } from 'date-fns'

/**
 * Calcular y guardar visit_frequency_days para un paciente.
 * Se llama cada vez que se completa una cita.
 */
export async function calculateVisitFrequency(
  patientId: string,
  clinicId: string
): Promise<number | null> {
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('starts_at')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('status', 'completed')
    .order('starts_at', { ascending: true })

  const appts = appointments ?? []
  if (appts.length < 2) {
    // No se puede calcular con <2 citas
    await supabaseAdmin
      .from('patients')
      .update({ visit_frequency_days: null })
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
    return null
  }

  // Calcular promedio de días entre citas consecutivas
  let totalDays = 0
  for (let i = 1; i < appts.length; i++) {
    const prev = new Date(appts[i - 1].starts_at)
    const curr = new Date(appts[i].starts_at)
    totalDays += Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
  }
  const avgDays = Math.round(totalDays / (appts.length - 1))
  const frequency = Math.max(1, avgDays) // mínimo 1 día

  await supabaseAdmin
    .from('patients')
    .update({ visit_frequency_days: frequency })
    .eq('id', patientId)
    .eq('clinic_id', clinicId)

  return frequency
}

/**
 * Formato legible de la frecuencia de visita
 */
export async function formatFrequency(days: number): Promise<string> {
  if (days <= 10) return `cada ${days} días`
  if (days <= 21) return `cada ${Math.round(days / 7)} semanas`
  const months = Math.round(days / 30)
  if (months <= 1) return 'cada mes'
  return `cada ${months} meses`
}

/**
 * Enviar recordatorio de reactivación manual desde el dashboard
 */
export async function sendManualReactivation(
  patientId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')

    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone, visit_frequency_days')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .single()

    if (!patient) return { ok: false, error: 'Paciente no encontrado' }

    // Obtener última cita completada
    const { data: lastAppt } = await supabaseAdmin
      .from('appointments')
      .select('starts_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .order('starts_at', { ascending: false })
      .limit(1)
      .single()

    let message: string
    if (patient.visit_frequency_days && lastAppt) {
      const daysSince = Math.floor(
        (Date.now() - new Date(lastAppt.starts_at).getTime()) / (1000 * 60 * 60 * 24)
      )
      const freqText = await formatFrequency(patient.visit_frequency_days)
      const sinceText = daysSince >= 30
        ? `${Math.round(daysSince / 30)} mes${Math.round(daysSince / 30) !== 1 ? 'es' : ''}`
        : `${daysSince} días`

      message =
        `Hola ${patient.name} 😊\n\n` +
        `Solías visitarnos ${freqText} y hace ${sinceText} que no te vemos.\n\n` +
        `¿Todo bien? Con gusto te agendamos tu próxima visita cuando quieras.\n\n` +
        `Responde *Sí* y te ayudamos de inmediato.`
    } else {
      message =
        `Hola ${patient.name} 😊\n\n` +
        `Han pasado unos meses desde tu última visita y queremos saber cómo estás.\n\n` +
        `Si necesitas una consulta o chequeo, con gusto te agendamos.\n\n` +
        `Responde *Sí* y te ayudamos de inmediato.`
    }

    const phone = patient.phone.replace('+', '')
    const result = await sendWhatsAppMessage(phone, message)
    if (!result) return { ok: false, error: 'Error enviando mensaje por WhatsApp' }

    const today = format(new Date(), 'yyyy-MM-dd')
    await supabaseAdmin
      .from('patients')
      .update({ last_reactivation_sent: today })
      .eq('id', patientId)
      .eq('clinic_id', clinicId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'manual_reactivation_sent',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: patientId,
      details: { name: patient.name },
    })

    revalidatePath(`/dashboard/patients/${patientId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
