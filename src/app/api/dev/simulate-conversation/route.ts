// ============================================================
// Dev-only endpoint: simular conversación con el agente WhatsApp
// SIN enviar mensajes reales por WhatsApp.
//
// POST /api/dev/simulate-conversation
//   body: {
//     clinicId: string,
//     doctorId?: string,        // si se omite usa el primero activo
//     patientPhone: string,     // simulado, no se envía
//     patientName: string,      // simulado
//     messageHistory?: [        // historial previo simulado
//       { role: 'patient' | 'agent', text: string, created_at?: string }
//     ],
//     patientMessage: string,   // el mensaje a procesar ahora
//   }
//
// Devuelve TODO lo que el agente respondió, incluyendo:
//   - text: respuesta natural al paciente
//   - toolsUsed: qué tools llamó
//   - tokenUsage: cuántos tokens consumió
//   - appointmentData: si se creó cita
//
// SEGURIDAD:
//   - Solo disponible para usuarios autenticados de la clínica que se simula.
//   - NO envía WhatsApp real (no llama sendWhatsAppMessage).
//   - SÍ ejecuta tools reales (create_appointment crearía citas si las
//     condiciones se cumplen). Para evitar contaminar prod data, usar con
//     consultation_types/doctores de TEST.
//
// Bloque 1 del sistema de reglas: la respuesta evidencia si el agente
// respeta la regla "escalar siempre a humano" (capa A prompt + capa B
// check duro en executor).
// ============================================================

import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import type { Message, WhatsAppConfig } from '@/types/database'

interface SimulateBody {
  clinicId: string
  doctorId?: string
  patientPhone: string
  patientName: string
  messageHistory?: Array<{
    role: 'patient' | 'agent'
    text: string
    created_at?: string
  }>
  patientMessage: string
}

export async function POST(request: NextRequest): Promise<Response> {
  // --- Auth: solo usuarios de la clínica pueden simular ---
  const supa = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supa.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: SimulateBody
  try { body = await request.json() }
  catch { return Response.json({ error: 'Body inválido' }, { status: 400 }) }

  if (!body.clinicId || !body.patientPhone || !body.patientName || !body.patientMessage) {
    return Response.json(
      { error: 'Faltan campos requeridos: clinicId, patientPhone, patientName, patientMessage' },
      { status: 400 },
    )
  }

  // Verificar que el usuario pertenece a la clínica que está simulando
  const { data: clinicUser } = await supabaseAdmin
    .from('clinic_users')
    .select('id, clinic_id')
    .eq('auth_user_id', user.id)
    .eq('clinic_id', body.clinicId)
    .eq('is_active', true)
    .maybeSingle()

  if (!clinicUser) {
    return Response.json(
      { error: 'No tienes acceso a esta clínica' },
      { status: 403 },
    )
  }

  // --- Cargar datos de la clínica ---
  const { data: clinic } = await supabaseAdmin
    .from('clinics').select('*').eq('id', body.clinicId).single()
  if (!clinic) {
    return Response.json({ error: 'Clínica no encontrada' }, { status: 404 })
  }

  const { data: doctors } = await supabaseAdmin
    .from('doctors')
    .select('*')
    .eq('clinic_id', body.clinicId)
    .eq('is_active', true)
    .order('name')

  if (!doctors || doctors.length === 0) {
    return Response.json({ error: 'La clínica no tiene doctores activos' }, { status: 400 })
  }

  const doctor = body.doctorId
    ? doctors.find((d) => d.id === body.doctorId) ?? doctors[0]
    : doctors[0]

  const { data: consultationTypes } = await supabaseAdmin
    .from('consultation_types')
    .select('*')
    .eq('clinic_id', body.clinicId)
    .eq('is_active', true)

  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null

  // --- Buscar paciente existente por teléfono normalizado ---
  // Para la simulación NO crea paciente, solo lo carga si existe
  let existingPatient = null
  const normalizedPhone = body.patientPhone.startsWith('+57')
    ? body.patientPhone
    : `+57${body.patientPhone.replace(/^\+?57?/, '')}`

  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, name, phone, document_type, document_number, date_of_birth, eps, email, total_appointments, no_show_count')
    .eq('clinic_id', body.clinicId)
    .eq('phone', normalizedPhone)
    .maybeSingle()

  if (patient) {
    existingPatient = {
      name: patient.name as string,
      phone: patient.phone as string,
      document_type: patient.document_type as string | null,
      document_number: patient.document_number as string | null,
      date_of_birth: patient.date_of_birth as string | null,
      eps: patient.eps as string | null,
      email: patient.email as string | null,
      total_appointments: (patient.total_appointments as number) ?? 0,
      no_show_count: (patient.no_show_count as number) ?? 0,
    }
  }

  // --- Construir messageHistory desde el formato simulado ---
  // El agente espera Message[] de la DB; lo emulo
  const messageHistory: Message[] = (body.messageHistory ?? []).map((m, i) => ({
    id: `sim-${i}`,
    conversation_id: 'sim-conversation',
    role: m.role,
    content: m.text,
    media_url: null,
    media_type: null,
    whatsapp_message_id: null,
    message_type: 'text',
    metadata: {},
    created_at: m.created_at ?? new Date(Date.now() - (body.messageHistory!.length - i) * 60000).toISOString(),
  } as unknown as Message))

  // --- Ejecutar agente ---
  try {
    const agentResponse = await runAppointmentAgent({
      patientMessage: body.patientMessage,
      messageHistory,
      clinic,
      doctor,
      doctors,
      waConfig: waConfig ?? undefined,
      consultationTypes: consultationTypes ?? undefined,
      patientPhone: normalizedPhone,
      patientName: body.patientName,
      existingPatient,
    })

    return Response.json({
      ok: true,
      response: {
        text: agentResponse.text,
        toolsUsed: agentResponse.toolsUsed,
        tokenUsage: agentResponse.tokenUsage,
        appointmentData: agentResponse.appointmentData ?? null,
      },
      // Metadatos útiles para entender qué pasó
      meta: {
        clinic_name: clinic.name,
        doctor_name: doctor.name,
        consultation_types_in_context: consultationTypes?.length ?? 0,
        patient_exists_in_db: !!existingPatient,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[simulate-conversation] Error agente:', msg)
    return Response.json(
      { ok: false, error: 'Error ejecutando agente: ' + msg },
      { status: 500 },
    )
  }
}
