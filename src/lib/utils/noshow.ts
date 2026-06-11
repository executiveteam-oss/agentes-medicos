// ============================================================
// Cálculo de probabilidad de no-show por paciente
//
// Fórmula:
// 1. Base = (no_shows / total_citas) * 100
// 2. Si NO confirmó el recordatorio de la próxima cita: +30%
// 3. Cap máximo: 95%
//
// Ejemplo: 2 no-shows de 10 citas = 20% base
//          No confirmó recordatorio → 20% + 30% = 50%
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

interface NoShowResult {
  probability: number         // 0-95
  totalAppointments: number
  totalNoShows: number
  confirmedReminder: boolean | null  // null = no se envió recordatorio
}

/**
 * Calcula la probabilidad de no-show de un paciente
 * y la guarda actualizada en la DB
 */
export async function calculateNoShowProbability(
  patientId: string,
  clinicId: string
): Promise<NoShowResult> {
  // 1. Cargar citas del paciente:
  //    - PASADAS con outcome registrado (facturado/inasistente) → para tasa histórica
  //    - FUTURAS confirmed/rescheduled → para chequear el próximo recordatorio
  //    Post-migración 00073: status y attendance_outcome son ejes independientes.
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('status, attendance_outcome, reminder_confirmed')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .or('attendance_outcome.in.(facturado,inasistente),status.in.(confirmed,rescheduled)')

  const allPast = (appointments ?? []).filter(
    (a) => a.attendance_outcome === 'facturado' || a.attendance_outcome === 'inasistente'
  )
  const totalAppointments = allPast.length
  const totalNoShows = allPast.filter((a) => a.attendance_outcome === 'inasistente').length

  // 2. Calcular probabilidad base
  let probability = totalAppointments > 0
    ? (totalNoShows / totalAppointments) * 100
    : 0

  // 3. Verificar si confirmó el recordatorio de la próxima cita futura
  const nextAppointment = (appointments ?? []).find(
    (a) => a.status === 'confirmed' || a.status === 'rescheduled'
  )
  const confirmedReminder = nextAppointment?.reminder_confirmed ?? null

  // Si tiene cita próxima y NO confirmó el recordatorio → +30%
  if (confirmedReminder === false) {
    probability += 30
  }

  // 4. Cap máximo 95%
  probability = Math.min(probability, 95)
  probability = Math.round(probability * 10) / 10 // Redondear a 1 decimal

  // 5. Guardar en la DB
  await supabaseAdmin
    .from('patients')
    .update({
      no_show_probability: probability,
      no_show_count: totalNoShows,
      total_appointments: totalAppointments,
    })
    .eq('id', patientId)

  return {
    probability,
    totalAppointments,
    totalNoShows,
    confirmedReminder,
  }
}

/**
 * Calcula la probabilidad acumulada de no-show para un día
 * Retorna el número esperado de no-shows y si recomienda overbooking
 */
export async function calculateDailyNoShowRisk(
  clinicId: string,
  date: string // YYYY-MM-DD
): Promise<{
  totalAppointments: number
  expectedNoShows: number
  recommendOverbooking: boolean
  patients: Array<{
    name: string
    phone: string
    probability: number
    startsAt: string
    reminderConfirmed: boolean | null
  }>
}> {
  // Buscar todas las citas del día con datos del paciente
  const dayStart = `${date}T00:00:00-05:00`
  const dayEnd = `${date}T23:59:59-05:00`

  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, reminder_confirmed, patient_id, patients(name, phone, no_show_probability)')
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at', { ascending: true })

  const patients: Array<{
    name: string
    phone: string
    probability: number
    startsAt: string
    reminderConfirmed: boolean | null
  }> = []

  let totalProbability = 0

  for (const apt of appointments ?? []) {
    const patient = apt.patients as unknown as {
      name: string
      phone: string
      no_show_probability: number
    } | null

    if (!patient) continue

    const prob = patient.no_show_probability ?? 0
    totalProbability += prob / 100 // Convertir a fracción

    patients.push({
      name: patient.name,
      phone: patient.phone,
      probability: prob,
      startsAt: apt.starts_at,
      reminderConfirmed: apt.reminder_confirmed,
    })
  }

  const totalAppointments = patients.length
  const expectedNoShows = Math.round(totalProbability * 10) / 10

  return {
    totalAppointments,
    expectedNoShows,
    recommendOverbooking: expectedNoShows >= 1,
    patients,
  }
}
