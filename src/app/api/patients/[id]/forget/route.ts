// ============================================================
// ARCO — Derecho de Cancelación/Supresión (Ley 1581/2012)
// DELETE /api/patients/:id/forget
//
// Anonimiza los datos personales del paciente sin eliminar
// los registros (mantiene integridad referencial y estadísticas).
//
// Solo accesible por staff autenticado de la misma clínica.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: patientId } = await params

  // Rate limit
  const ip = getClientIp(request)
  const rateLimit = checkRateLimit(`patient-forget:${ip}`, RATE_LIMITS.general)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Autenticación
  const session = await getUserSession()
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const clinicId = session.clinicId

  try {
    // Verificar que el paciente existe y pertenece a esta clínica
    const { data: patient, error: patientError } = await supabaseAdmin
      .from('patients')
      .select('id, name')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .single()

    if (patientError || !patient) {
      return NextResponse.json({ error: 'Paciente no encontrado' }, { status: 404 })
    }

    // 1. Anonimizar datos personales del paciente
    await supabaseAdmin
      .from('patients')
      .update({
        name: '[DATOS ELIMINADOS]',
        phone: `+57000${Date.now()}`,  // Teléfono único pero no real
        email: null,
        document_type: 'CC',
        document_number: null,
        date_of_birth: null,
        eps: null,
        notes: null,
        data_consent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', patientId)
      .eq('clinic_id', clinicId)

    // 2. Anonimizar mensajes del paciente en conversaciones
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)

    const conversationIds = (conversations ?? []).map((c) => c.id)

    if (conversationIds.length > 0) {
      // Anonimizar mensajes del paciente
      await supabaseAdmin
        .from('messages')
        .update({ content: '[MENSAJE ELIMINADO POR SOLICITUD ARCO]' })
        .in('conversation_id', conversationIds)
        .eq('role', 'patient')

      // Anonimizar teléfono en conversaciones
      await supabaseAdmin
        .from('conversations')
        .update({ whatsapp_phone: '[ELIMINADO]', context: {} })
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
    }

    // 3. Anonimizar notas en citas
    await supabaseAdmin
      .from('appointments')
      .update({ notes: null, reason: null, cancellation_reason: null })
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)

    // 4. Anonimizar razón en lista de espera
    await supabaseAdmin
      .from('waitlist')
      .update({ reason: null })
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'patient_data_anonymized',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: patientId,
      details: { original_name: patient.name },
    })

    return NextResponse.json({
      status: 'ok',
      message: 'Datos del paciente anonimizados exitosamente',
    })
  } catch (error) {
    console.error('[ARCO:Forget] Error:', error)
    return NextResponse.json({ error: 'Error anonimizando datos' }, { status: 500 })
  }
}
