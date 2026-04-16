'use server'

// ============================================================
// Server Actions — Importación de convenios desde iSalud
//
// Flujo:
// 1. runConveniosImport(): scrape + vuelca en isalud_import_staging
// 2. getStagingProducts(): productos agrupados por convenio para UI
// 3. confirmImport(): crea consultation_types + borra staging
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { scrapeConvenios } from '@/lib/isalud/convenios-agent'
import { revalidatePath } from 'next/cache'

// --- Types ---

export interface StagingProduct {
  id: string
  producto_nombre: string
  tarifa: number
  duracion_minutos: number | null
  agendable_web: boolean
  opcion_detalle: string | null
}

export interface StagingConvenioGroup {
  convenio_nit: string
  convenio_nombre: string
  convenio_nombre_abreviado: string | null
  productos: StagingProduct[]
}

export interface StagingDataResponse {
  groups: StagingConvenioGroup[]
  totalProducts: number
  doctors: Array<{ id: string; name: string }>
}

export interface ConfirmItem {
  productoId: string                   // id del staging row
  doctorId: string                     // doctor al que se asigna
  nombre: string                       // nombre final del consultation_type (puede haber sido editado)
  duracion: number                     // minutos
  precio: number                       // COP
}

export interface ConfirmItemForDoctor {
  productoId: string
  nombre: string
  duracion: number
  precio: number
}

export interface ImportRunResult {
  ok: boolean
  convenios?: number
  productos?: number
  errors?: string[]
  error?: string
}

export interface ConfirmResult {
  ok: boolean
  created?: number
  skipped?: number
  error?: string
}

// --- 1. Ejecutar importación ---

export async function runConveniosImport(): Promise<ImportRunResult> {
  let clinicId: string
  try {
    clinicId = await checkWritePermission('settings')
  } catch {
    return { ok: false, error: 'Sin permisos para ejecutar importación' }
  }

  // Verificar que tiene credenciales de iSalud
  const { data: integ } = await supabaseAdmin
    .from('sync_integrations')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider', 'isalud')
    .maybeSingle()

  if (!integ) {
    return {
      ok: false,
      error: 'No tienes iSalud configurado. Conéctalo primero en el Dashboard → Importar agenda desde iSalud.',
    }
  }

  try {
    const result = await scrapeConvenios(clinicId)
    return {
      ok: result.productos > 0 || result.errors.length === 0,
      convenios: result.convenios,
      productos: result.productos,
      errors: result.errors,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    console.error(`[runConveniosImport] ${msg}`)
    return { ok: false, error: msg }
  }
}

// --- 2. Obtener staging agrupado por convenio ---

export async function getStagingProducts(): Promise<StagingDataResponse> {
  const clinicId = await checkReadPermission('settings')

  const [stagingRes, doctorsRes] = await Promise.all([
    supabaseAdmin
      .from('isalud_import_staging')
      .select('id, convenio_nit, convenio_nombre, convenio_nombre_abreviado, producto_nombre, tarifa, duracion_minutos, agendable_web, opcion_detalle')
      .eq('clinic_id', clinicId)
      .order('convenio_nombre', { ascending: true })
      .order('producto_nombre', { ascending: true }),
    supabaseAdmin
      .from('doctors')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
  ])

  const rows = stagingRes.data ?? []
  const doctors = (doctorsRes.data ?? []) as Array<{ id: string; name: string }>

  // Agrupar por convenio
  const groupsMap = new Map<string, StagingConvenioGroup>()
  for (const r of rows) {
    const key = `${r.convenio_nit}|${r.convenio_nombre}`
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        convenio_nit: r.convenio_nit ?? '',
        convenio_nombre: r.convenio_nombre,
        convenio_nombre_abreviado: r.convenio_nombre_abreviado,
        productos: [],
      })
    }
    groupsMap.get(key)!.productos.push({
      id: r.id,
      producto_nombre: r.producto_nombre,
      tarifa: r.tarifa ?? 0,
      duracion_minutos: r.duracion_minutos,
      agendable_web: !!r.agendable_web,
      opcion_detalle: r.opcion_detalle,
    })
  }

  return {
    groups: Array.from(groupsMap.values()),
    totalProducts: rows.length,
    doctors,
  }
}

// --- 3. Confirmar selección y crear consultation_types ---

export async function confirmImport(items: ConfirmItem[]): Promise<ConfirmResult> {
  let clinicId: string
  try {
    clinicId = await checkWritePermission('settings')
  } catch {
    return { ok: false, error: 'Sin permisos' }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'No seleccionaste ningún producto' }
  }

  // Validar items
  for (const it of items) {
    if (!it.productoId || !it.doctorId || !it.nombre?.trim()) {
      return { ok: false, error: 'Faltan datos en uno de los productos seleccionados' }
    }
    if (typeof it.duracion !== 'number' || it.duracion < 5) {
      return { ok: false, error: `Duración inválida para "${it.nombre}"` }
    }
    if (typeof it.precio !== 'number' || it.precio < 0) {
      return { ok: false, error: `Precio inválido para "${it.nombre}"` }
    }
  }

  // Verificar que todos los staging IDs pertenecen a la clínica
  const stagingIds = items.map((it) => it.productoId)
  const { data: validStaging } = await supabaseAdmin
    .from('isalud_import_staging')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('id', stagingIds)
  const validIds = new Set((validStaging ?? []).map((r) => r.id))
  if (validIds.size !== items.length) {
    return { ok: false, error: 'Algunos productos no pertenecen a esta clínica' }
  }

  // Verificar que doctorId pertenece a la clínica
  const doctorIds = Array.from(new Set(items.map((it) => it.doctorId)))
  const { data: validDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('id', doctorIds)
  const validDocIds = new Set((validDoctors ?? []).map((d) => d.id))
  for (const it of items) {
    if (!validDocIds.has(it.doctorId)) {
      return { ok: false, error: 'Algún médico seleccionado no pertenece a esta clínica' }
    }
  }

  // Para cada item: si NO existe consultation_type con mismo nombre+doctor, insertarlo
  let created = 0
  let skipped = 0

  for (const it of items) {
    // Detectar duplicados por (clinic_id, doctor_id, name) — case insensitive
    const { data: existing } = await supabaseAdmin
      .from('consultation_types')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', it.doctorId)
      .ilike('name', it.nombre.trim())
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    const { error: insErr } = await supabaseAdmin
      .from('consultation_types')
      .insert({
        clinic_id: clinicId,
        doctor_id: it.doctorId,
        name: it.nombre.trim(),
        duration_minutes: it.duracion,
        price: it.precio || null,
        is_active: true,
        bookable_via_whatsapp: true,
        modality: 'presencial',
      })

    if (insErr) {
      console.error(`[confirmImport] insert error:`, insErr.message)
      // continuar con el siguiente
    } else {
      created++
    }
  }

  // Auditoría
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'isalud_convenios_imported',
    actor_type: 'staff',
    details: { selected: items.length, created, skipped },
  })

  // Borrar el staging completo de la clínica al confirmar
  await supabaseAdmin
    .from('isalud_import_staging')
    .delete()
    .eq('clinic_id', clinicId)

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings')

  return { ok: true, created, skipped }
}

// --- 4. Cancelar (limpiar staging sin importar) ---

export async function cancelImport(): Promise<{ ok: boolean }> {
  try {
    const clinicId = await checkWritePermission('settings')
    await supabaseAdmin.from('isalud_import_staging').delete().eq('clinic_id', clinicId)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// --- 5. ¿Hay datos en staging? (para volver al flujo) ---

export async function getStagingCount(): Promise<{ count: number; hasIsalud: boolean }> {
  try {
    const clinicId = await checkReadPermission('settings')
    const [stagingRes, integRes] = await Promise.all([
      supabaseAdmin
        .from('isalud_import_staging')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId),
      supabaseAdmin
        .from('sync_integrations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('provider', 'isalud'),
    ])
    return {
      count: stagingRes.count ?? 0,
      hasIsalud: (integRes.count ?? 0) > 0,
    }
  } catch {
    return { count: 0, hasIsalud: false }
  }
}

// --- 6. Helper simple: ¿la clínica tiene iSalud conectado? ---
//   Usado por la UI para decidir si mostrar el botón "Importar desde iSalud"

export async function hasIsaludConnected(): Promise<boolean> {
  try {
    const clinicId = await checkReadPermission('whatsapp')
    const { count } = await supabaseAdmin
      .from('sync_integrations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

// --- 7. Confirm para un doctor específico (sin selector por item) ---
//   Crea consultation_types asignados al doctorId fijo.
//   También limpia el staging de la clínica al finalizar.

export async function confirmImportForDoctor(
  doctorId: string,
  items: ConfirmItemForDoctor[]
): Promise<ConfirmResult> {
  let clinicId: string
  try {
    clinicId = await checkWritePermission('whatsapp')
  } catch {
    return { ok: false, error: 'Sin permisos' }
  }

  if (!doctorId || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Faltan datos: doctor o productos' }
  }

  // Validar que el doctor pertenece a la clínica
  const { data: doc } = await supabaseAdmin
    .from('doctors')
    .select('id')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!doc) return { ok: false, error: 'Doctor no encontrado en esta clínica' }

  // Validar items
  for (const it of items) {
    if (!it.productoId || !it.nombre?.trim()) {
      return { ok: false, error: 'Faltan datos en uno de los productos' }
    }
    if (typeof it.duracion !== 'number' || it.duracion < 5) {
      return { ok: false, error: `Duración inválida para "${it.nombre}"` }
    }
    if (typeof it.precio !== 'number' || it.precio < 0) {
      return { ok: false, error: `Precio inválido para "${it.nombre}"` }
    }
  }

  // Verificar que todos los staging IDs pertenecen a la clínica
  const stagingIds = items.map((it) => it.productoId)
  const { data: validStaging } = await supabaseAdmin
    .from('isalud_import_staging')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('id', stagingIds)
  const validIds = new Set((validStaging ?? []).map((r) => r.id))
  if (validIds.size !== items.length) {
    return { ok: false, error: 'Algunos productos no pertenecen a esta clínica' }
  }

  let created = 0
  let skipped = 0

  for (const it of items) {
    // Detectar duplicados por (clinic_id, doctor_id, name) — case insensitive
    const { data: existing } = await supabaseAdmin
      .from('consultation_types')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .ilike('name', it.nombre.trim())
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    const { error: insErr } = await supabaseAdmin
      .from('consultation_types')
      .insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        name: it.nombre.trim(),
        duration_minutes: it.duracion,
        price: it.precio || null,
        is_active: true,
        bookable_via_whatsapp: true,
        modality: 'presencial',
      })

    if (insErr) {
      console.error(`[confirmImportForDoctor] insert error:`, insErr.message)
    } else {
      created++
    }
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'isalud_convenios_imported_for_doctor',
    actor_type: 'staff',
    target_type: 'doctor',
    target_id: doctorId,
    details: { selected: items.length, created, skipped },
  })

  // Limpiar staging completo de la clínica (idempotencia)
  await supabaseAdmin
    .from('isalud_import_staging')
    .delete()
    .eq('clinic_id', clinicId)

  revalidatePath('/dashboard/whatsapp')

  return { ok: true, created, skipped }
}
