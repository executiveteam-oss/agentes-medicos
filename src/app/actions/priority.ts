'use server'

// ============================================================
// Server Actions — Priority scoring para lista de espera
// Score 0-100 basado en historial de pago, frecuencia, no-shows y tiempo en espera
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { getSessionClinicId } from '@/lib/actions-helpers'
import { normalizeWorkingHours, dayTotalMinutes } from '@/lib/utils/working-hours'

export interface PriorityScore {
  patientId: string
  score: number
  label: string       // "Prioritario" | "Regular" | "Bajo"
  tier: 'high' | 'mid' | 'low'
}

export interface WaitlistPriorityData {
  scores: Record<string, PriorityScore>   // patientId → score
  availableSlotsThisWeek: number
  waitlistCount: number
}

/** Calcular prioridad de un solo paciente */
export async function calculatePatientPriority(
  patientId: string,
  clinicId: string
): Promise<PriorityScore> {
  const [patientRes, carteraRes, appointmentsRes] = await Promise.all([
    supabaseAdmin
      .from('patients')
      .select('id, no_show_count, total_appointments')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .single(),
    supabaseAdmin
      .from('cartera')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('status', 'pendiente')
      .limit(1),
    // Último tipo de pago
    supabaseAdmin
      .from('appointments')
      .select('payment_type')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .order('starts_at', { ascending: false })
      .limit(1),
  ])

  const patient = patientRes.data
  if (!patient) return { patientId, score: 0, label: 'Bajo', tier: 'low' }

  const hasCartera = (carteraRes.data ?? []).length > 0
  const lastPayment = appointmentsRes.data?.[0]?.payment_type ?? null

  return computeScore(patientId, {
    paymentType: lastPayment,
    hasCartera,
    totalAppointments: patient.total_appointments ?? 0,
    noShowCount: patient.no_show_count ?? 0,
    daysWaiting: 0, // Se sobreescribe cuando se calcula en bulk
  })
}

interface ScoreInput {
  paymentType: string | null
  hasCartera: boolean
  totalAppointments: number
  noShowCount: number
  daysWaiting: number
}

function computeScore(patientId: string, input: ScoreInput): PriorityScore {
  let score = 0

  // Historial de pago (+30 particular, +10 EPS, -20 cartera)
  if (input.paymentType === 'Particular') score += 30
  else if (input.paymentType) score += 10 // EPS u otro
  if (input.hasCartera) score -= 20

  // Frecuencia de visitas
  if (input.totalAppointments >= 5) score += 25
  else if (input.totalAppointments >= 2) score += 15
  // first time: +0

  // Historial de no-shows
  if (input.noShowCount === 0) score += 20
  else if (input.noShowCount === 1) score += 5
  else score -= 10 // 2+

  // Tiempo en lista de espera (+1/día, max 25)
  score += Math.min(input.daysWaiting, 25)

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score))

  const tier = score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low'
  const label = tier === 'high' ? 'Prioritario' : tier === 'mid' ? 'Regular' : 'Bajo'

  return { patientId, score, label, tier }
}

/** Calcular prioridades para todos los pacientes en lista de espera */
export async function calculateWaitlistPriorities(clinicId: string): Promise<WaitlistPriorityData> {
  // Obtener todos los waitlist entries activos
  const { data: waitlistEntries } = await supabaseAdmin
    .from('waitlist')
    .select('id, patient_id, created_at')
    .eq('clinic_id', clinicId)
    .in('status', ['waiting', 'notified'])

  const entries = waitlistEntries ?? []
  const patientIds = [...new Set(entries.map((e) => e.patient_id))]

  if (patientIds.length === 0) {
    return { scores: {}, availableSlotsThisWeek: 0, waitlistCount: 0 }
  }

  // Queries en paralelo para todos los pacientes
  const [patientsRes, carteraRes, paymentsRes, clinicRes, weekApptsRes] = await Promise.all([
    supabaseAdmin
      .from('patients')
      .select('id, no_show_count, total_appointments')
      .in('id', patientIds),
    supabaseAdmin
      .from('cartera')
      .select('patient_id')
      .eq('clinic_id', clinicId)
      .eq('status', 'pendiente')
      .in('patient_id', patientIds),
    supabaseAdmin
      .from('appointments')
      .select('patient_id, payment_type')
      .eq('clinic_id', clinicId)
      .eq('status', 'completed')
      .in('patient_id', patientIds)
      .order('starts_at', { ascending: false }),
    // Para available slots: clinic working hours
    supabaseAdmin
      .from('clinics')
      .select('consultation_duration_minutes, working_hours')
      .eq('id', clinicId)
      .single(),
    // Citas esta semana
    (() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
      const day = now.getDay()
      const diff = day === 0 ? 6 : day - 1
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
      monday.setHours(0, 0, 0, 0)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)
      const mondayUTC = new Date(monday.getTime() + 5 * 60 * 60 * 1000)
      const sundayUTC = new Date(sunday.getTime() + 5 * 60 * 60 * 1000)
      return supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('starts_at', mondayUTC.toISOString())
        .lte('starts_at', sundayUTC.toISOString())
        .in('status', ['confirmed', 'completed'])
    })(),
  ])

  const patients = patientsRes.data ?? []
  const carteraPatients = new Set((carteraRes.data ?? []).map((c) => c.patient_id))

  // Último tipo de pago por paciente
  const lastPayment: Record<string, string> = {}
  for (const a of paymentsRes.data ?? []) {
    if (!lastPayment[a.patient_id]) lastPayment[a.patient_id] = a.payment_type
  }

  const patientMap: Record<string, { total_appointments: number; no_show_count: number }> = {}
  for (const p of patients) {
    patientMap[p.id] = { total_appointments: p.total_appointments ?? 0, no_show_count: p.no_show_count ?? 0 }
  }

  const now = Date.now()
  const scores: Record<string, PriorityScore> = {}

  for (const entry of entries) {
    const pid = entry.patient_id
    const pat = patientMap[pid]
    if (!pat) continue

    const daysWaiting = Math.floor((now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24))

    scores[pid] = computeScore(pid, {
      paymentType: lastPayment[pid] ?? null,
      hasCartera: carteraPatients.has(pid),
      totalAppointments: pat.total_appointments,
      noShowCount: pat.no_show_count,
      daysWaiting,
    })
  }

  // Estimar slots disponibles esta semana (sumando todos los bloques de cada día activo)
  const whRaw = clinicRes.data?.working_hours as Record<string, unknown> | null
  const duration = clinicRes.data?.consultation_duration_minutes ?? 30
  let totalSlots = 0
  if (whRaw) {
    const wh = normalizeWorkingHours(whRaw)
    for (const day of Object.values(wh)) {
      const minutes = dayTotalMinutes(day)
      if (minutes > 0) totalSlots += Math.floor(minutes / duration)
    }
  }
  const bookedThisWeek = weekApptsRes.count ?? 0
  const availableSlotsThisWeek = Math.max(0, totalSlots - bookedThisWeek)

  return {
    scores,
    availableSlotsThisWeek,
    waitlistCount: entries.length,
  }
}

/**
 * Cuando una cita se cancela, notificar al paciente con mayor prioridad
 * en lista de espera (para el mismo doctor).
 * Retorna el nombre del paciente notificado o null.
 */
export async function notifyHighestPriorityWaitlistPatient(
  clinicId: string,
  doctorId: string
): Promise<string | null> {
  // Buscar waitlist entries con status='waiting' para ese doctor
  const { data: entries } = await supabaseAdmin
    .from('waitlist')
    .select('id, patient_id, created_at, patients(id, name, phone, no_show_count, total_appointments)')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })

  if (!entries || entries.length === 0) return null

  // Obtener cartera y payment info para scoring
  const patientIds = entries.map((e) => e.patient_id)

  const [carteraRes, paymentsRes] = await Promise.all([
    supabaseAdmin
      .from('cartera')
      .select('patient_id')
      .eq('clinic_id', clinicId)
      .eq('status', 'pendiente')
      .in('patient_id', patientIds),
    supabaseAdmin
      .from('appointments')
      .select('patient_id, payment_type')
      .eq('clinic_id', clinicId)
      .eq('status', 'completed')
      .in('patient_id', patientIds)
      .order('starts_at', { ascending: false }),
  ])

  const carteraPatients = new Set((carteraRes.data ?? []).map((c) => c.patient_id))
  const lastPayment: Record<string, string> = {}
  for (const a of paymentsRes.data ?? []) {
    if (!lastPayment[a.patient_id]) lastPayment[a.patient_id] = a.payment_type
  }

  const now = Date.now()

  // Score each entry, pick highest
  let bestEntry: typeof entries[0] | null = null
  let bestScore = -Infinity

  for (const entry of entries) {
    const patient = entry.patients as unknown as {
      id: string; name: string; phone: string; no_show_count: number; total_appointments: number
    } | null
    if (!patient) continue

    const daysWaiting = Math.floor((now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24))

    let score = 0
    const pt = lastPayment[entry.patient_id] ?? null
    if (pt === 'Particular') score += 30
    else if (pt) score += 10
    if (carteraPatients.has(entry.patient_id)) score -= 20
    if (patient.total_appointments >= 5) score += 25
    else if (patient.total_appointments >= 2) score += 15
    if (patient.no_show_count === 0) score += 20
    else if (patient.no_show_count === 1) score += 5
    else score -= 10
    score += Math.min(daysWaiting, 25)

    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
    }
  }

  if (!bestEntry) return null

  const patient = bestEntry.patients as unknown as { name: string; phone: string } | null
  if (!patient) return null

  // Enviar notificación WhatsApp
  const mensaje =
    `¡Hola ${patient.name}! 🎉 Se ha liberado un espacio en el consultorio. ` +
    `¿Te gustaría agendar tu cita ahora? Responde "sí" para que te ayudemos.`

  const phone = patient.phone.replace('+', '')
  await sendWhatsAppMessage(phone, mensaje)

  // Marcar como notificado
  await supabaseAdmin
    .from('waitlist')
    .update({
      status: 'notified',
      notified_at: new Date().toISOString(),
    })
    .eq('id', bestEntry.id)
    .eq('clinic_id', clinicId)

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'waitlist_auto_notified_on_cancel',
    actor_type: 'system',
    target_type: 'waitlist',
    target_id: bestEntry.id,
    details: { patient_name: patient.name, score: bestScore },
  })

  revalidatePath('/dashboard/espera')
  return patient.name
}
