// ============================================================
// ARCO — Derecho de Acceso (Ley 1581/2012, Colombia)
// GET /api/patients/:id/export
//
// Exporta TODOS los datos del paciente en formato JSON.
// Solo accesible por staff autenticado de la misma clínica.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: patientId } = await params

  // Rate limit
  const ip = getClientIp(request)
  const rateLimit = checkRateLimit(`patient-export:${ip}`, RATE_LIMITS.general)
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
    // 1. Datos del paciente (filtrado por clinic_id)
    const { data: patient, error: patientError } = await supabaseAdmin
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .single()

    if (patientError || !patient) {
      return NextResponse.json({ error: 'Paciente no encontrado' }, { status: 404 })
    }

    // 2. Citas del paciente
    const { data: appointments } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, ends_at, status, reason, source, notes, payment_type, created_at')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .order('starts_at', { ascending: false })

    // 3. Conversaciones
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id, status, last_message_at, created_at')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })

    // 4. Mensajes de cada conversación
    const conversationIds = (conversations ?? []).map((c) => c.id)
    const { data: messages } = conversationIds.length > 0
      ? await supabaseAdmin
          .from('messages')
          .select('id, conversation_id, role, content, message_type, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: true })
      : { data: [] }

    // 5. Recordatorios
    const appointmentIds = (appointments ?? []).map((a) => a.id)
    const { data: reminders } = appointmentIds.length > 0
      ? await supabaseAdmin
          .from('reminders')
          .select('id, appointment_id, type, scheduled_for, sent_at, status, response, created_at')
          .in('appointment_id', appointmentIds)
          .order('created_at', { ascending: false })
      : { data: [] }

    // 6. Lista de espera
    const { data: waitlist } = await supabaseAdmin
      .from('waitlist')
      .select('id, preferred_dates, preferred_time, reason, status, notified_at, created_at')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'patient_data_exported',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: patientId,
      details: {},
    })

    const exportData = {
      exported_at: new Date().toISOString(),
      patient,
      appointments: appointments ?? [],
      conversations: (conversations ?? []).map((conv) => ({
        ...conv,
        messages: (messages ?? []).filter((m) => m.conversation_id === conv.id),
      })),
      reminders: reminders ?? [],
      waitlist: waitlist ?? [],
    }

    return NextResponse.json(exportData)
  } catch (error) {
    console.error('[ARCO:Export] Error:', error)
    return NextResponse.json({ error: 'Error exportando datos' }, { status: 500 })
  }
}
