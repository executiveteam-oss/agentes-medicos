'use server'

// ============================================================
// Server actions — etiquetas de PACIENTE.
// Catálogo en clinics.patient_labels; asignaciones en patients.labels (ids).
// Gate: patients.write (la etiqueta es dato de PACIENTE; Admin + Coordinadora
// por default — la Coordinadora es quien hace el batch "agendar en septiembre").
// Crear + aplicar: desde la conversación y la lista de pacientes (frecuente).
// Renombrar/archivar/eliminar: mismo gate, pero la UI vive en el panel Equipo
// (una vez al mes, afecta a toda la clínica).
// ============================================================

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import {
  validateNewLabel, renameInCatalog, archiveInCatalog, deleteFromCatalog, toggleLabel, isValidColor,
  type ClinicLabel, type LabelColor,
} from '@/lib/labels/patient-labels'

async function loadCatalog(clinicId: string): Promise<ClinicLabel[]> {
  const { data } = await supabaseAdmin.from('clinics').select('patient_labels').eq('id', clinicId).single()
  return ((data?.patient_labels as ClinicLabel[] | null) ?? [])
}
async function saveCatalog(clinicId: string, catalog: ClinicLabel[]): Promise<boolean> {
  const { error } = await supabaseAdmin.from('clinics').update({ patient_labels: catalog }).eq('id', clinicId)
  return !error
}

export async function getClinicLabels(): Promise<ClinicLabel[]> {
  const clinicId = await checkReadPermission('patients') // leer el catálogo = read (para filtrar/mostrar)
  return loadCatalog(clinicId)
}

/** Crea una etiqueta en el catálogo de la clínica. Devuelve la etiqueta nueva. */
export async function createClinicLabel(name: string, color: string): Promise<{ ok: boolean; error?: string; label?: ClinicLabel }> {
  try {
    const clinicId = await checkWritePermission('patients')
    if (!isValidColor(color)) return { ok: false, error: 'Color no válido' }
    const catalog = await loadCatalog(clinicId)
    const v = validateNewLabel(name, catalog)
    if (!v.ok) return { ok: false, error: v.error }
    const label: ClinicLabel = { id: `lbl_${randomUUID().slice(0, 8)}`, name: v.name!, color: color as LabelColor }
    if (!(await saveCatalog(clinicId, [...catalog, label]))) return { ok: false, error: 'Error guardando la etiqueta' }
    await supabaseAdmin.from('audit_log').insert({ clinic_id: clinicId, action: 'patient_label_created', actor_type: 'staff', target_type: 'label', details: { id: label.id, name: label.name, color } })
    revalidatePath('/dashboard/conversations'); revalidatePath('/dashboard/configuracion/usuarios')
    return { ok: true, label }
  } catch { return { ok: false, error: 'Error de permisos o sesión' } }
}

/** Agrega o quita una etiqueta de una paciente. */
export async function setPatientLabel(patientId: string, labelId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')
    const { data: pat } = await supabaseAdmin.from('patients').select('labels').eq('id', patientId).eq('clinic_id', clinicId).single()
    if (!pat) return { ok: false, error: 'Paciente no encontrada' }
    const next = toggleLabel((pat.labels as string[] | null) ?? [], labelId, on)
    const { error } = await supabaseAdmin.from('patients').update({ labels: next }).eq('id', patientId).eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'Error actualizando etiquetas' }
    await supabaseAdmin.from('audit_log').insert({ clinic_id: clinicId, action: on ? 'patient_label_applied' : 'patient_label_removed', actor_type: 'staff', target_type: 'patient', target_id: patientId, details: { label_id: labelId } })
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch { return { ok: false, error: 'Error de permisos o sesión' } }
}

/** Renombra/recolorea una etiqueta de la clínica (mismo id → las pacientes no se tocan). */
export async function renameClinicLabel(labelId: string, name: string, color: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')
    if (!isValidColor(color)) return { ok: false, error: 'Color no válido' }
    const catalog = await loadCatalog(clinicId)
    const target = catalog.find((l) => l.id === labelId)
    if (!target) return { ok: false, error: 'Etiqueta no encontrada' }
    // validar duplicado contra las demás (excluyendo la propia)
    const v = validateNewLabel(name, catalog.filter((l) => l.id !== labelId))
    if (!v.ok) return { ok: false, error: v.error }
    if (!(await saveCatalog(clinicId, renameInCatalog(catalog, labelId, v.name!, color as LabelColor)))) return { ok: false, error: 'Error guardando' }
    await supabaseAdmin.from('audit_log').insert({ clinic_id: clinicId, action: 'patient_label_renamed', actor_type: 'staff', target_type: 'label', details: { id: labelId, from: target.name, to: v.name, color } })
    revalidatePath('/dashboard/conversations'); revalidatePath('/dashboard/configuracion/usuarios')
    return { ok: true }
  } catch { return { ok: false, error: 'Error de permisos o sesión' } }
}

/** "Dejar de usar" = archivar (soft): sale del selector, se conserva donde ya está. */
export async function archiveClinicLabel(labelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('patients')
    const catalog = await loadCatalog(clinicId)
    if (!(await saveCatalog(clinicId, archiveInCatalog(catalog, labelId)))) return { ok: false, error: 'Error guardando' }
    await supabaseAdmin.from('audit_log').insert({ clinic_id: clinicId, action: 'patient_label_archived', actor_type: 'staff', target_type: 'label', details: { id: labelId } })
    revalidatePath('/dashboard/conversations'); revalidatePath('/dashboard/configuracion/usuarios')
    return { ok: true }
  } catch { return { ok: false, error: 'Error de permisos o sesión' } }
}

/** Cuántas pacientes tienen esta etiqueta (para mostrar el conteo ANTES de eliminar). */
export async function countPatientsWithLabel(labelId: string): Promise<number> {
  const clinicId = await checkWritePermission('patients')
  const { count } = await supabaseAdmin.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).contains('labels', [labelId])
  return count ?? 0
}

/** "Eliminar" = sacar del catálogo Y quitarla de todas las pacientes que la tenían. */
export async function deleteClinicLabel(labelId: string): Promise<{ ok: boolean; error?: string; removedFrom?: number }> {
  try {
    const clinicId = await checkWritePermission('patients')
    // Quitarla de cada paciente que la tenga
    const { data: withLabel } = await supabaseAdmin.from('patients').select('id, labels').eq('clinic_id', clinicId).contains('labels', [labelId])
    let removed = 0
    for (const p of (withLabel ?? []) as { id: string; labels: string[] }[]) {
      const next = (p.labels ?? []).filter((id) => id !== labelId)
      const { error } = await supabaseAdmin.from('patients').update({ labels: next }).eq('id', p.id)
      if (!error) removed++
    }
    const catalog = await loadCatalog(clinicId)
    if (!(await saveCatalog(clinicId, deleteFromCatalog(catalog, labelId)))) return { ok: false, error: 'Error guardando' }
    await supabaseAdmin.from('audit_log').insert({ clinic_id: clinicId, action: 'patient_label_deleted', actor_type: 'staff', target_type: 'label', details: { id: labelId, removed_from: removed } })
    revalidatePath('/dashboard/conversations'); revalidatePath('/dashboard/configuracion/usuarios')
    return { ok: true, removedFrom: removed }
  } catch { return { ok: false, error: 'Error de permisos o sesión' } }
}
