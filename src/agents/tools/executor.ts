// ============================================================
// Ejecutor de Tools — La lógica real detrás de cada herramienta
//
// Cuando Claude decide usar una tool, este archivo la ejecuta:
// 1. Claude dice: "quiero usar check_availability para el 15 de febrero"
// 2. Este código consulta la DB y devuelve los horarios libres
// 3. Claude lee el resultado y le responde al paciente
//
// TODAS las consultas filtran por clinic_id (seguridad multi-tenant)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateEndTime, formatForPatient, formatTimeForPatient, normalizePhone, getDayOfWeek } from '@/lib/utils/dates'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { syncClinicSheet } from '@/lib/google-sheets'
import type { Clinic, Doctor, WorkingDay, WhatsAppConfig } from '@/types/database'
import { parseISO, addMinutes, format, startOfDay, endOfDay, isValid } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Bogota'

// Tipo para el resultado que devolvemos a Claude
interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Ejecuta una tool por nombre y devuelve el resultado para Claude
 * @param toolName - Nombre de la tool (ej: "check_availability")
 * @param input - Parámetros que Claude envió
 * @param clinicId - ID de la clínica (SIEMPRE se filtra por esto)
 * @param clinic - Datos de la clínica (para duración de citas, etc.)
 * @param doctor - Datos del doctor
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  doctor: Doctor
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'check_availability':
        return await checkAvailability(input, clinicId, clinic, doctor)

      case 'create_appointment':
        return await createAppointment(input, clinicId, clinic)

      case 'get_patient_appointments':
        return await getPatientAppointments(input, clinicId)

      case 'cancel_appointment':
        return await cancelAppointment(input, clinicId)

      case 'reschedule_appointment':
        return await rescheduleAppointment(input, clinicId, clinic)

      case 'escalate_to_human':
        return await escalateToHuman(input, clinicId)

      case 'add_to_waitlist':
        return await addToWaitlist(input, clinicId)

      default:
        return { success: false, error: `Tool "${toolName}" no reconocida` }
    }
  } catch (error) {
    console.error(`[Tool:${toolName}] Error:`, error)
    return {
      success: false,
      error: 'Ocurrió un error interno. Informa al paciente que hubo un problema y puede escribir "hablar con humano".',
    }
  }
}

// ============================================================
// CHECK AVAILABILITY — Buscar horarios disponibles
// ============================================================
async function checkAvailability(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  doctor: Doctor
): Promise<ToolResult> {
  const preferredDate = input.preferred_date as string | undefined
  const doctorId = (input.doctor_id as string) || doctor.id

  // Si no dan fecha, usar hoy
  const dateStr = preferredDate ?? format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd')
  const date = parseISO(dateStr)

  if (!isValid(date)) {
    return { success: false, error: 'Fecha no válida. Formato esperado: YYYY-MM-DD' }
  }

  // Verificar config per-doctor desde whatsapp_config
  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null
  const docConfig = waConfig?.doctors[doctorId]

  // Determinar horario: per-doctor config > doctor.working_hours > clinic.working_hours
  const dayOfWeek = getDayOfWeek(date)
  let startTime: string
  let endTime: string
  let isDayActive: boolean

  if (docConfig) {
    // Usar config de WhatsApp para este doctor
    const dayNum = date.getDay() // 0=dom
    isDayActive = docConfig.days.includes(dayNum)
    startTime = docConfig.start
    endTime = docConfig.end
  } else {
    // Fallback a working_hours del doctor o la clínica
    const workingHours = doctor.working_hours ?? clinic.working_hours
    const dayConfig: WorkingDay = workingHours[dayOfWeek as keyof typeof workingHours]
    isDayActive = dayConfig?.active ?? false
    startTime = dayConfig?.start ?? '08:00'
    endTime = dayConfig?.end ?? '18:00'
  }

  if (!isDayActive) {
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        reason: `El doctor no atiende ese día`,
      },
    }
  }

  // Buscar citas existentes para ese día y doctor
  const dayStart = `${dateStr}T${startTime}:00-05:00`
  const dayEnd = `${dateStr}T${endTime}:00-05:00`

  const { data: existingAppointments, error } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, ends_at')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[check_availability] Error DB:', error)
    return { success: false, error: 'Error consultando disponibilidad' }
  }

  // Duración: per-doctor config > whatsapp_config default > clinic default
  const duration = docConfig?.duration ?? waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes
  const allSlots = generateTimeSlots(dateStr, startTime, endTime, duration)

  // Filtrar los que ya están ocupados
  const occupiedTimes = new Set(
    (existingAppointments ?? []).map((apt) => apt.starts_at)
  )

  const availableSlots = allSlots.filter((slot) => !occupiedTimes.has(slot.utc))

  if (availableSlots.length === 0) {
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        reason: 'No hay horarios disponibles para esta fecha',
        suggestion: 'Puedes ofrecer al paciente unirse a la lista de espera o probar otro día',
      },
    }
  }

  return {
    success: true,
    data: {
      available: true,
      date: dateStr,
      doctor_name: doctor.name,
      slots: availableSlots.map((s) => ({
        time: s.display,
        starts_at: s.utc,
      })),
      total_available: availableSlots.length,
    },
  }
}

/**
 * Genera todos los slots de tiempo para un día
 * Ejemplo: de 8:00 a 18:00 con slots de 30 min = 20 slots
 */
function generateTimeSlots(
  dateStr: string,
  startTime: string,
  endTime: string,
  durationMinutes: number
): Array<{ utc: string; display: string }> {
  const slots: Array<{ utc: string; display: string }> = []

  // Crear fecha de inicio en hora Colombia
  const startDate = parseISO(`${dateStr}T${startTime}:00-05:00`)
  const endDate = parseISO(`${dateStr}T${endTime}:00-05:00`)

  let current = startDate
  while (current < endDate) {
    const slotEnd = addMinutes(current, durationMinutes)
    // Solo agregar si el slot completo cabe antes del cierre
    if (slotEnd <= endDate) {
      slots.push({
        utc: current.toISOString(),
        display: formatTimeForPatient(current.toISOString()),
      })
    }
    current = addMinutes(current, durationMinutes)
  }

  return slots
}

// ============================================================
// CREATE APPOINTMENT — Crear cita nueva
// ============================================================
async function createAppointment(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic
): Promise<ToolResult> {
  const doctorId = input.doctor_id as string
  const patientName = input.patient_name as string
  const patientPhone = normalizePhone(input.patient_phone as string)
  const startsAt = input.starts_at as string
  const reason = (input.reason as string) ?? null
  const dateOfBirth = (input.date_of_birth as string) ?? null
  const documentType = (input.document_type as string) ?? null
  const documentNumber = (input.document_number as string) ?? null
  const patientEmail = (input.patient_email as string) ?? null
  const patientEps = (input.patient_eps as string) ?? null
  const procedureEntity = (input.procedure_entity as string) ?? null

  // Calcular hora de fin (usar duración per-doctor si existe en config)
  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null
  const docConfig = waConfig?.doctors[doctorId]
  const duration = docConfig?.duration ?? waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes
  const endsAt = calculateEndTime(startsAt, duration)

  // Verificar que no haya otra cita en ese horario (doble booking)
  const { data: conflict } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled'])
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)
    .limit(1)

  if (conflict && conflict.length > 0) {
    return {
      success: false,
      error: 'Ese horario ya está ocupado. Por favor ofrece otro horario al paciente.',
    }
  }

  // Buscar o crear paciente
  let { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', patientPhone)
    .single()

  if (!patient) {
    const { data: newPatient, error: patientError } = await supabaseAdmin
      .from('patients')
      .insert({
        clinic_id: clinicId,
        name: patientName,
        phone: patientPhone,
        date_of_birth: dateOfBirth,
        document_type: documentType,
        document_number: documentNumber,
        ...(patientEmail && { email: patientEmail }),
        ...(patientEps && { eps: patientEps }),
      })
      .select('id')
      .single()

    if (patientError) {
      console.error('[create_appointment] Error creando paciente:', patientError)
      return { success: false, error: 'Error registrando al paciente' }
    }
    patient = newPatient
  } else {
    // Si el paciente ya existe, actualizar todos los datos que llegaron
    await supabaseAdmin
      .from('patients')
      .update({
        name: patientName,
        ...(dateOfBirth && { date_of_birth: dateOfBirth }),
        ...(documentType && { document_type: documentType }),
        ...(documentNumber && { document_number: documentNumber }),
        ...(patientEmail && { email: patientEmail }),
        ...(patientEps && { eps: patientEps }),
      })
      .eq('id', patient.id)
  }

  // Mapear procedure_entity a payment_type para la cita
  // EPS → EPS, Póliza → Póliza, ARL → ARL, SOAT → SOAT, cualquier otra → Particular
  const validPaymentTypes = ['EPS', 'Particular', 'Póliza', 'ARL', 'SOAT']
  const paymentType = procedureEntity && validPaymentTypes.includes(procedureEntity)
    ? procedureEntity
    : 'Particular'

  // Crear la cita
  const { data: appointment, error: aptError } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patient.id,
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
      source: 'whatsapp_agent',
      payment_type: paymentType,
    })
    .select('id, starts_at, ends_at')
    .single()

  if (aptError) {
    console.error('[create_appointment] Error creando cita:', aptError)
    return { success: false, error: 'Error creando la cita' }
  }

  // Incrementar contador de citas del paciente (no crítico si falla)
  try {
    await supabaseAdmin.rpc('increment_patient_appointments', { p_patient_id: patient.id })
  } catch { /* no crítico */ }

  // Registrar en auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_created',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointment.id,
        details: { patient_phone: patientPhone, starts_at: startsAt },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments', 'patients']) } catch { /* no crítico */ }

  return {
    success: true,
    data: {
      appointment_id: appointment.id,
      starts_at: appointment.starts_at,
      ends_at: appointment.ends_at,
      formatted_date: formatForPatient(appointment.starts_at),
      message: 'Cita creada exitosamente',
    },
  }
}

// ============================================================
// GET PATIENT APPOINTMENTS — Citas futuras del paciente
// ============================================================
async function getPatientAppointments(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const phone = normalizePhone(input.patient_phone as string)

  // Buscar paciente
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()

  if (!patient) {
    return {
      success: true,
      data: { appointments: [], message: 'No se encontró el paciente. Puede que sea nuevo.' },
    }
  }

  // Buscar citas futuras confirmadas
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, ends_at, status, reason, doctor_id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patient.id)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[get_patient_appointments] Error:', error)
    return { success: false, error: 'Error consultando citas' }
  }

  // Formatear para que Claude las muestre bonito
  const formatted = (appointments ?? []).map((apt) => ({
    appointment_id: apt.id,
    date: formatForPatient(apt.starts_at),
    time: formatTimeForPatient(apt.starts_at),
    status: apt.status,
    reason: apt.reason,
  }))

  return {
    success: true,
    data: {
      appointments: formatted,
      total: formatted.length,
    },
  }
}

// ============================================================
// CANCEL APPOINTMENT — Cancelar cita
// ============================================================
async function cancelAppointment(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const appointmentId = input.appointment_id as string
  const reason = input.reason as string

  // Verificar que la cita existe y pertenece a esta clínica
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, status, patient_id, doctor_id, starts_at')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!appointment) {
    return { success: false, error: 'Cita no encontrada' }
  }

  if (appointment.status === 'cancelled') {
    return { success: false, error: 'Esta cita ya está cancelada' }
  }

  // Cancelar la cita
  const { error } = await supabaseAdmin
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[cancel_appointment] Error:', error)
    return { success: false, error: 'Error cancelando la cita' }
  }

  // Registrar en auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_cancelled',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointmentId,
        details: { reason },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments', 'finances', 'noshow_stats']) } catch { /* no crítico */ }

  // Revisar si hay alguien en lista de espera para ese doctor
  await notifyWaitlist(clinicId, appointment.doctor_id, appointment.starts_at)

  return {
    success: true,
    data: {
      cancelled_appointment_id: appointmentId,
      message: 'Cita cancelada exitosamente. Ofrece reagendar al paciente.',
    },
  }
}

// ============================================================
// RESCHEDULE APPOINTMENT — Reagendar cita
// ============================================================
async function rescheduleAppointment(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic
): Promise<ToolResult> {
  const appointmentId = input.appointment_id as string
  const newStartsAt = input.new_starts_at as string
  const newEndsAt = calculateEndTime(newStartsAt, clinic.consultation_duration_minutes)

  // Verificar que la cita existe
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, doctor_id, patient_id, starts_at, payment_type, reason')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!appointment) {
    return { success: false, error: 'Cita no encontrada' }
  }

  // Verificar que el nuevo horario no tenga conflicto
  const { data: conflict } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', appointment.doctor_id)
    .in('status', ['confirmed', 'rescheduled'])
    .neq('id', appointmentId)
    .lt('starts_at', newEndsAt)
    .gt('ends_at', newStartsAt)
    .limit(1)

  if (conflict && conflict.length > 0) {
    return {
      success: false,
      error: 'El nuevo horario ya está ocupado. Ofrece otro horario.',
    }
  }

  // Marcar la cita actual como reagendada
  await supabaseAdmin
    .from('appointments')
    .update({ status: 'rescheduled' })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  // Crear la nueva cita (copiar payment_type y reason de la original)
  const { data: newAppointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      doctor_id: appointment.doctor_id,
      patient_id: appointment.patient_id,
      starts_at: newStartsAt,
      ends_at: newEndsAt,
      source: 'whatsapp_agent',
      payment_type: appointment.payment_type,
      reason: appointment.reason,
    })
    .select('id, starts_at')
    .single()

  if (error) {
    console.error('[reschedule_appointment] Error:', error)
    return { success: false, error: 'Error reagendando la cita' }
  }

  // Auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_rescheduled',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: newAppointment.id,
        details: {
          old_appointment_id: appointmentId,
          old_starts_at: appointment.starts_at,
          new_starts_at: newStartsAt,
        },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments']) } catch { /* no crítico */ }

  // Revisar waitlist para el horario liberado
  await notifyWaitlist(clinicId, appointment.doctor_id, appointment.starts_at)

  return {
    success: true,
    data: {
      new_appointment_id: newAppointment.id,
      new_date: formatForPatient(newAppointment.starts_at),
      message: 'Cita reagendada exitosamente',
    },
  }
}

// ============================================================
// ESCALATE TO HUMAN — Escalar a humano
// ============================================================
async function escalateToHuman(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const reason = input.reason as string
  const urgency = input.urgency as string

  // Auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'conversation_escalated',
        actor_type: 'agent',
        details: { reason, urgency },
      })
  } catch { /* no crítico */ }

  return {
    success: true,
    data: {
      escalated: true,
      urgency,
      message:
        urgency === 'emergency'
          ? 'Escalado como EMERGENCIA. Informar al paciente que alguien lo contactará pronto.'
          : 'Escalado al equipo. Informar al paciente que alguien del consultorio lo contactará pronto.',
    },
  }
}

// ============================================================
// ADD TO WAITLIST — Agregar a lista de espera
// ============================================================
async function addToWaitlist(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const doctorId = input.doctor_id as string
  const phone = normalizePhone(input.patient_phone as string)
  const preferredDates = (input.preferred_dates as string[]) ?? []
  const preferredTime = (input.preferred_time as string) ?? 'any'
  const reason = (input.reason as string) ?? null

  // Buscar paciente
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()

  if (!patient) {
    return { success: false, error: 'Paciente no encontrado' }
  }

  // Verificar que no esté ya en lista de espera activa
  const { data: existing } = await supabaseAdmin
    .from('waitlist')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patient.id)
    .eq('status', 'waiting')
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      success: true,
      data: { already_waiting: true, message: 'El paciente ya está en la lista de espera' },
    }
  }

  // Agregar a la lista
  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({
      clinic_id: clinicId,
      patient_id: patient.id,
      doctor_id: doctorId,
      preferred_dates: preferredDates,
      preferred_time: preferredTime,
      reason,
    })

  if (error) {
    console.error('[add_to_waitlist] Error:', error)
    return { success: false, error: 'Error agregando a la lista de espera' }
  }

  return {
    success: true,
    data: {
      added: true,
      message: 'Paciente agregado a la lista de espera. Se le notificará si se abre un espacio.',
    },
  }
}

// ============================================================
// NOTIFY WAITLIST — Notificar al siguiente en lista de espera
// Se llama automáticamente al cancelar o reagendar una cita
// ============================================================
async function notifyWaitlist(
  clinicId: string,
  doctorId: string,
  freedSlotStartsAt: string
): Promise<void> {
  try {
    // Buscar el primero en la lista de espera para ese doctor
    const { data: waitlistEntry } = await supabaseAdmin
      .from('waitlist')
      .select('id, patient_id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (!waitlistEntry) return // No hay nadie esperando

    // Obtener teléfono del paciente
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('phone, name')
      .eq('id', waitlistEntry.patient_id)
      .single()

    if (!patient) return

    // Marcar como notificado
    await supabaseAdmin
      .from('waitlist')
      .update({ status: 'notified', notified_at: new Date().toISOString() })
      .eq('id', waitlistEntry.id)

    // Enviar mensaje por WhatsApp
    const formattedDate = formatForPatient(freedSlotStartsAt)
    const message =
      `¡Hola ${patient.name}! 🎉 Se liberó un espacio: ${formattedDate}. ` +
      `¿Te gustaría agendarte? Responde "sí" para confirmar.`

    // Quitar el "+" del teléfono para WhatsApp API
    const whatsappNumber = patient.phone.replace('+', '')
    await sendWhatsAppMessage(whatsappNumber, message)
  } catch (error) {
    // No es crítico — la cita ya se canceló, el paciente simplemente no se entera
    console.error('[notifyWaitlist] Error:', error)
  }
}
