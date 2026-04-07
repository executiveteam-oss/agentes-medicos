'use server'

// ============================================================
// Server Actions — Pacientes (lectura + CRUD)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { DocumentType } from '@/types/database'

const PAGE_SIZE = 20

export interface PatientListItem {
  id: string
  name: string
  phone: string
  eps: string | null
  total_appointments: number
  no_show_count: number
  last_no_show_date: string | null
  outstanding_balance: number
}

export interface PatientListResult {
  patients: PatientListItem[]
  total: number
  page: number
  totalPages: number
}

/**
 * Buscar pacientes con filtros, búsqueda y paginación.
 */
export async function getPatientsList(opts: {
  page?: number
  search?: string
  epsFilter?: string
}): Promise<PatientListResult> {
  const clinicId = await checkReadPermission('patients')
  const page = Math.max(1, opts.page ?? 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Query base
  let query = supabaseAdmin
    .from('patients')
    .select('id, name, phone, eps, total_appointments, no_show_count, created_at', { count: 'exact' })
    .eq('clinic_id', clinicId)

  // Filtro de búsqueda por nombre o teléfono
  if (opts.search && opts.search.trim()) {
    const term = opts.search.trim()
    // Buscar por nombre (ilike) o por teléfono (contains)
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
  }

  // Filtro por EPS
  if (opts.epsFilter && opts.epsFilter !== 'todas') {
    if (opts.epsFilter === 'Particular') {
      query = query.or('eps.eq.Particular,eps.is.null')
    } else {
      query = query.eq('eps', opts.epsFilter)
    }
  }

  query = query.order('name', { ascending: true }).range(from, to)

  const { data: patients, count, error } = await query
  if (error) throw error

  const total = count ?? 0
  const patientIds = (patients ?? []).map((p) => p.id)

  // Obtener último no-show y saldo pendiente en paralelo
  let noShowMap: Record<string, string> = {}
  let balanceMap: Record<string, number> = {}

  if (patientIds.length > 0) {
    const [noShowRes, carteraRes] = await Promise.all([
      // Último no-show por paciente
      supabaseAdmin
        .from('appointments')
        .select('patient_id, starts_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'no_show')
        .in('patient_id', patientIds)
        .order('starts_at', { ascending: false }),
      // Saldo pendiente por paciente
      supabaseAdmin
        .from('cartera')
        .select('patient_id, amount')
        .eq('clinic_id', clinicId)
        .eq('status', 'pendiente')
        .in('patient_id', patientIds),
    ])

    // Agrupar: último no-show (primero de cada paciente)
    for (const row of noShowRes.data ?? []) {
      if (!noShowMap[row.patient_id]) {
        noShowMap[row.patient_id] = row.starts_at
      }
    }

    // Agrupar: suma de saldos
    for (const row of carteraRes.data ?? []) {
      balanceMap[row.patient_id] = (balanceMap[row.patient_id] ?? 0) + row.amount
    }
  }

  const result: PatientListItem[] = (patients ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    eps: p.eps,
    total_appointments: p.total_appointments,
    no_show_count: p.no_show_count,
    last_no_show_date: noShowMap[p.id] ?? null,
    outstanding_balance: balanceMap[p.id] ?? 0,
  }))

  return {
    patients: result,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  }
}

export interface PatientDetail {
  id: string
  name: string
  phone: string
  email: string | null
  document_type: string
  document_number: string | null
  date_of_birth: string | null
  eps: string | null
  notes: string | null
  no_show_count: number
  total_appointments: number
  visit_frequency_days: number | null
  last_visit_at: string | null          // ISO de última cita completada
  days_since_last_visit: number | null
  created_at: string
}

export interface PatientAppointment {
  id: string
  starts_at: string
  status: string
  reason: string | null
  payment_type: string
  invoice_status: string
  documents_requested: boolean
  documents_received: boolean
  doctor_name: string | null
}

export interface PatientConversation {
  id: string
  status: string
  last_message_at: string
  message_count: number
}

export interface PatientCarteraEntry {
  id: string
  amount: number
  days_overdue: number
  treatment: string | null
  payment_type: string
  status: string
}

export interface PatientDetailResult {
  patient: PatientDetail
  appointments: PatientAppointment[]
  conversations: PatientConversation[]
  cartera: PatientCarteraEntry[]
}

/**
 * Obtener detalle completo de un paciente: perfil, citas, conversaciones, cartera.
 */
export async function getPatientDetail(patientId: string): Promise<PatientDetailResult | null> {
  const clinicId = await checkReadPermission('patients')

  const { data: patientRaw, error } = await supabaseAdmin
    .from('patients')
    .select('id, name, phone, email, document_type, document_number, date_of_birth, eps, notes, no_show_count, total_appointments, visit_frequency_days, created_at')
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .single()

  if (error || !patientRaw) return null

  // Citas, conversaciones, cartera en paralelo
  const [apptRes, convRes, cartRes] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('id, starts_at, status, reason, payment_type, invoice_status, documents_requested, documents_received, doctors(name)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('starts_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('conversations')
      .select('id, status, last_message_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('last_message_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('cartera')
      .select('id, amount, days_overdue, treatment, payment_type, status')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('days_overdue', { ascending: false }),
  ])

  // Contar mensajes por conversación
  const convIds = (convRes.data ?? []).map((c) => c.id)
  let msgCounts: Record<string, number> = {}
  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
    for (const m of msgs ?? []) {
      msgCounts[m.conversation_id] = (msgCounts[m.conversation_id] ?? 0) + 1
    }
  }

  // Última visita completada
  const completedAppts = (apptRes.data ?? []).filter((a) => a.status === 'completed')
  const lastVisit = completedAppts.length > 0 ? completedAppts[0] : null // ya ordenadas desc
  const lastVisitAt = lastVisit?.starts_at ?? null
  const daysSinceLastVisit = lastVisitAt
    ? Math.floor((Date.now() - new Date(lastVisitAt).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const patient: PatientDetail = {
    ...patientRaw,
    visit_frequency_days: patientRaw.visit_frequency_days ?? null,
    last_visit_at: lastVisitAt,
    days_since_last_visit: daysSinceLastVisit,
  }

  return {
    patient,
    appointments: (apptRes.data ?? []).map((a) => {
      const doc = a.doctors as unknown as { name: string } | null
      return {
        id: a.id,
        starts_at: a.starts_at,
        status: a.status,
        reason: a.reason,
        payment_type: a.payment_type,
        invoice_status: a.invoice_status,
        documents_requested: (a.documents_requested as boolean) ?? false,
        documents_received: (a.documents_received as boolean) ?? false,
        doctor_name: doc?.name ?? null,
      }
    }),
    conversations: (convRes.data ?? []).map((c) => ({
      id: c.id,
      status: c.status,
      last_message_at: c.last_message_at,
      message_count: msgCounts[c.id] ?? 0,
    })),
    cartera: (cartRes.data ?? []).map((c) => ({
      id: c.id,
      amount: c.amount,
      days_overdue: c.days_overdue,
      treatment: c.treatment,
      payment_type: c.payment_type,
      status: c.status,
    })),
  }
}

// ============================================================
// CRUD Pacientes
// ============================================================

export interface PatientInput {
  name: string
  phone: string
  document_type: DocumentType
  document_number: string
  date_of_birth: string
  eps: string
  email: string
  notes: string
}

/** Crear paciente */
export async function createPatient(
  input: PatientInput
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')

    if (!input.name.trim()) return { ok: false, error: 'El nombre es obligatorio' }
    if (!input.phone.trim()) return { ok: false, error: 'El teléfono es obligatorio' }

    // Normalizar teléfono: asegurar +57
    let phone = input.phone.trim().replace(/\s/g, '')
    if (!phone.startsWith('+57')) {
      phone = '+57' + phone.replace(/^\+/, '')
    }

    // Verificar duplicado por teléfono
    const { data: existing } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('phone', phone)
      .maybeSingle()

    if (existing) return { ok: false, error: 'Ya existe un paciente con ese teléfono' }

    const { data, error } = await supabaseAdmin
      .from('patients')
      .insert({
        clinic_id: clinicId,
        name: input.name.trim(),
        phone,
        document_type: input.document_type || 'CC',
        document_number: input.document_number.trim() || null,
        date_of_birth: input.date_of_birth || null,
        eps: input.eps.trim() || null,
        email: input.email.trim() || null,
        notes: input.notes.trim() || null,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando paciente' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'patient_created',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: data.id,
      details: { name: input.name.trim(), phone },
    })

    revalidatePath('/dashboard/patients')
    return { ok: true, id: data.id }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar paciente */
export async function updatePatient(
  patientId: string,
  input: PatientInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')

    if (!input.name.trim()) return { ok: false, error: 'El nombre es obligatorio' }

    let phone = input.phone.trim().replace(/\s/g, '')
    if (!phone.startsWith('+57')) {
      phone = '+57' + phone.replace(/^\+/, '')
    }

    // Verificar duplicado (otro paciente con ese teléfono)
    const { data: existing } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('phone', phone)
      .neq('id', patientId)
      .maybeSingle()

    if (existing) return { ok: false, error: 'Ya existe otro paciente con ese teléfono' }

    const { error } = await supabaseAdmin
      .from('patients')
      .update({
        name: input.name.trim(),
        phone,
        document_type: input.document_type || 'CC',
        document_number: input.document_number.trim() || null,
        date_of_birth: input.date_of_birth || null,
        eps: input.eps.trim() || null,
        email: input.email.trim() || null,
        notes: input.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', patientId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando paciente' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'patient_updated',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: patientId,
      details: { name: input.name.trim() },
    })

    revalidatePath('/dashboard/patients')
    revalidatePath(`/dashboard/patients/${patientId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Eliminar paciente (solo si no tiene citas) */
export async function deletePatient(
  patientId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')

    // Verificar si tiene citas
    const { count } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)

    if (count && count > 0) {
      return { ok: false, error: `No se puede eliminar: tiene ${count} cita(s) registrada(s)` }
    }

    const { error } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('id', patientId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error eliminando paciente' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'patient_deleted',
      actor_type: 'staff',
      target_type: 'patient',
      target_id: patientId,
      details: {},
    })

    revalidatePath('/dashboard/patients')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Obtener datos de un paciente para el formulario de edición */
export async function getPatientForEdit(
  patientId: string
): Promise<PatientFormData | null> {
  try {
    const clinicId = await checkReadPermission('patients')

    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone, document_type, document_number, date_of_birth, eps, email, notes')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .single()

    if (error || !data) return null

    return {
      id: data.id,
      name: data.name,
      phone: data.phone.replace('+57', ''),
      document_type: (data.document_type as DocumentType) ?? 'CC',
      document_number: data.document_number ?? '',
      date_of_birth: data.date_of_birth ?? '',
      eps: data.eps ?? '',
      email: data.email ?? '',
      notes: data.notes ?? '',
    }
  } catch {
    return null
  }
}

export interface PatientFormData {
  id?: string
  name: string
  phone: string
  document_type: DocumentType
  document_number: string
  date_of_birth: string
  eps: string
  email: string
  notes: string
}

/** Buscar pacientes para dropdown (nombre o teléfono) */
export async function searchPatientsForSelect(
  query: string
): Promise<{ id: string; name: string; phone: string }[]> {
  try {
    const clinicId = await checkReadPermission('patients')

    const term = query.trim()
    if (!term) return []

    const { data } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone')
      .eq('clinic_id', clinicId)
      .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
      .order('name')
      .limit(10)

    return data ?? []
  } catch {
    return []
  }
}
