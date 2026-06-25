'use server'

// ⏳ MIGRACIÓN ALGIA — código de un solo uso. NO es feature del producto Omuwan.
// Ver sección "MIGRACIÓN ALGIA" en CLAUDE.md antes de modificar o reusar.
// ============================================================
// Server Actions — Flujo doctor-first de sugerencias consulta+convenio
//
// Flujo:
//   1. getSuggestionsForDoctor(doctorId)  — UI carga las sugerencias
//      derivadas de las citas iSalud históricas del médico, ya
//      cruzadas con staging + eapb_codes.
//   2. confirmSuggestionsForDoctor(doctorId, items) — Lady confirma
//      las que quiere crear (con su eapb_code/insurer_type final).
//      NO borra el staging, para que Lady itere por médicos.
//
// El flujo product-first viejo (confirmImportForDoctor en
// isalud-convenios.ts) queda intacto.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import {
  deriveSuggestions,
  type CitaForDerivation,
  type StagingProductForDerivation,
  type EapbCodeForDerivation,
  type DoctorSuggestions,
  type DerivationOutput,
} from '@/lib/isalud/consulta-convenio-derivation'

// --- Types ---

export interface DoctorMeta {
  id: string
  name: string
  specialty: string | null
}

export interface CatalogItem {
  id: string
  productoNombre: string
  convenioNombre: string
  tarifa: number
}

export interface SuggestionsResult {
  ok: boolean
  doctor?: DoctorMeta
  suggestions?: DoctorSuggestions
  unparseable?: DerivationOutput['unparseable']
  stats?: DerivationOutput['stats']
  /** Catálogo completo de staging para que la UI permita "agregar a mano" combinaciones que no salieron como sugerencia */
  catalog?: CatalogItem[]
  error?: string
}

export interface SuggestionConfirmItem {
  /** ID en isalud_import_staging del producto base */
  productoId: string
  /** Nombre final del consultation_type (puede haber sido editado por Lady) */
  nombre: string
  /** Duración en minutos */
  duracion: number
  /** Precio en COP (0 = sin precio) */
  precio: number
  /** Nombre del convenio (el oficial del eapb si fue mapeado, o el crudo si no). null si PARTICULAR. */
  epsName: string | null
  /** Tipo de aseguradora. 'Particular' se traduce a null en DB pero la UI lo envía explícito. null = sin clasificar (permitido, Lady completa después). */
  insurerType: 'EPS' | 'Prepagada' | 'Particular' | null
}

export interface ConfirmResult {
  ok: boolean
  created?: number
  skipped?: number
  error?: string
}

// --- Helper interno (sin auth, para scripts de dry-run) ---

/**
 * Orquesta DB queries + lógica pura para un médico de una clínica concreta.
 * NO chequea permisos. Usar solo desde código server-side con clinic_id ya validado.
 */
export async function internalGetSuggestionsForDoctor(
  clinicId: string,
  doctorId: string,
): Promise<SuggestionsResult> {
  // 1. Verificar doctor pertenece a la clínica
  const { data: docRow } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!docRow) return { ok: false, error: 'Doctor no encontrado en esta clínica' }
  const doctor = docRow as DoctorMeta

  // 2. Cargar citas iSalud del médico
  const { data: citasRaw } = await supabaseAdmin
    .from('appointments')
    .select('doctor_id, external_data, starts_at, ends_at')
    .eq('clinic_id', clinicId)
    .eq('source', 'isalud')
    .eq('doctor_id', doctorId)

  const citas: CitaForDerivation[] = (citasRaw ?? []).map((row) => {
    const r = row as { doctor_id: string; external_data: Record<string, unknown> | null; starts_at: string; ends_at: string }
    const ext = r.external_data ?? {}
    const durationMin = Math.round(
      (new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 60000,
    )
    return {
      doctor_id: r.doctor_id,
      doctor_name: doctor.name,
      procedimiento_raw: (ext['procedimiento'] as string | null) ?? null,
      aseguradora_raw: (ext['aseguradora'] as string | null) ?? null,
      duration_minutes: isNaN(durationMin) || durationMin <= 0 ? NaN : durationMin,
    }
  })

  // 3. Cargar staging products
  const { data: stagingRaw } = await supabaseAdmin
    .from('isalud_import_staging')
    .select('id, producto_nombre, convenio_nombre, tarifa, convenio_nit')
    .eq('clinic_id', clinicId)

  const stagingProducts: StagingProductForDerivation[] = (stagingRaw ?? []).map((row) => {
    const r = row as { id: string; producto_nombre: string; convenio_nombre: string; tarifa: number | null; convenio_nit: string | null }
    return {
      id: r.id,
      producto_nombre: r.producto_nombre,
      convenio_nombre: r.convenio_nombre,
      tarifa: r.tarifa ?? 0,
      convenio_nit: r.convenio_nit,
    }
  })

  // 4. Cargar catálogo de eapb_codes
  const { data: eapbRaw } = await supabaseAdmin
    .from('eapb_codes')
    .select('code, name, type, aliases')

  const eapbCodes: EapbCodeForDerivation[] = (eapbRaw ?? []).map((row) => {
    const r = row as { code: string; name: string; type: 'EPS' | 'Prepagada'; aliases: string[] | null }
    return { code: r.code, name: r.name, type: r.type, aliases: r.aliases ?? [] }
  })

  // 5. Pasar a la lógica pura
  const output = deriveSuggestions({ citas, stagingProducts, eapbCodes })

  // 6. Filtrar al doctor solicitado (output puede traer Map con 1 entrada)
  const docSuggs = output.suggestions.get(doctorId)
  const suggestions: DoctorSuggestions = docSuggs ?? {
    doctor_id: doctorId,
    doctor_name: doctor.name,
    combinations: [],
  }

  // Aplanar el catálogo para la UI (la sección "agregar a mano")
  const catalog: CatalogItem[] = stagingProducts.map((p) => ({
    id: p.id,
    productoNombre: p.producto_nombre,
    convenioNombre: p.convenio_nombre,
    tarifa: p.tarifa,
  }))

  return {
    ok: true,
    doctor,
    suggestions,
    unparseable: output.unparseable,
    stats: output.stats,
    catalog,
  }
}

// --- Server Action: getSuggestionsForDoctor (con auth) ---

export async function getSuggestionsForDoctor(doctorId: string): Promise<SuggestionsResult> {
  let clinicId: string
  try {
    clinicId = await checkReadPermission('whatsapp')
  } catch {
    return { ok: false, error: 'Sin permisos' }
  }
  if (!doctorId) return { ok: false, error: 'doctorId requerido' }
  return internalGetSuggestionsForDoctor(clinicId, doctorId)
}

// --- Server Action: confirmSuggestionsForDoctor (con auth, NO borra staging) ---

export async function confirmSuggestionsForDoctor(
  doctorId: string,
  items: SuggestionConfirmItem[],
): Promise<ConfirmResult> {
  let clinicId: string
  try {
    clinicId = await checkWritePermission('whatsapp')
  } catch {
    return { ok: false, error: 'Sin permisos' }
  }

  if (!doctorId || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Faltan datos: doctor o items' }
  }

  // Validar doctor en la clínica
  const { data: doc } = await supabaseAdmin
    .from('doctors')
    .select('id')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!doc) return { ok: false, error: 'Doctor no encontrado en esta clínica' }

  // Validar items
  // NOTA (2026-06-10): el feature usa el NOMBRE del convenio como dato principal.
  // El eapb_code y el insurer_type son metadatos opcionales — pueden quedar null
  // y Lady los completa después desde la tab "types" del médico. No bloqueamos.
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

  // Validar staging IDs pertenecen a la clínica.
  //
  // El check compara CARDINALIDADES DE DISTINCT vs DISTINCT — no items.length —
  // porque un mismo staging_product puede ser referenciado por VARIOS items
  // legítimos del cliente (un procedimiento "COLPOSCOPIA" que está en staging
  // 1 sola vez, pero el médico lo atiende con N convenios distintos → N items
  // que comparten el mismo staging_product_id). Bug histórico ARG-2026-06-23
  // bloqueaba la creación cuando ocurría esto (caso Adriana Estévez: 7 combos
  // de COLPOSCOPIA con 7 aseguradoras → todos con mismo staging_id → falla).
  //
  // Post-fix, este check solo da false en 2 escenarios reales de error:
  //   (a) fuga multi-tenant — alguien mandó un staging_id de otra clínica
  //   (b) race condition — staging fue borrado entre el load del UI y el confirm
  const stagingIds = items.map((it) => it.productoId)
  const requestedDistinctIds = new Set(stagingIds)
  const { data: validStaging } = await supabaseAdmin
    .from('isalud_import_staging')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('id', stagingIds)
  const validIds = new Set((validStaging ?? []).map((r) => r.id))
  if (validIds.size !== requestedDistinctIds.size) {
    return {
      ok: false,
      error: 'Error de validación: algún producto no corresponde a esta clínica. Recargá la página e intentá de nuevo.',
    }
  }

  let created = 0
  let skipped = 0

  for (const it of items) {
    // Dedup por (clinic_id, doctor_id, name, eps_name) — un médico puede tener
    // "Terapia piso pelvico" para COOMEVA y otra para ALLIANZ; son entradas distintas.
    // Si Lady intenta crear una ya existente con mismo convenio, se skipea.
    const dupQuery = supabaseAdmin
      .from('consultation_types')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .ilike('name', it.nombre.trim())

    if (it.epsName) {
      dupQuery.ilike('eps_name', it.epsName.trim())
    } else {
      dupQuery.is('eps_name', null)
    }

    const { data: existingMatches } = await dupQuery
    if ((existingMatches ?? []).length > 0) {
      skipped++
      continue
    }

    // Coerción PARTICULAR: si el nombre del convenio es 'PARTICULAR' (case-insensitive)
    // o el insurer_type sugerido fue 'Particular', el eps_name se guarda como null
    // (alineado con la convención de los 20 consultation_types existentes en Algia,
    // que tienen eps_name=null para particular).
    const isParticular =
      it.epsName?.trim().toUpperCase() === 'PARTICULAR' ||
      (it.insurerType as string | null) === 'Particular'
    // Y el insurer_type solo se guarda como 'EPS' | 'Prepagada' en DB (la columna acepta
    // text pero la UI y Res-256 esperan estos dos valores). 'Particular' → null.
    const insurerTypeForDb =
      it.insurerType === 'EPS' || it.insurerType === 'Prepagada' ? it.insurerType : null

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
        eps_name: isParticular ? null : it.epsName?.trim() || null,
        insurer_type: insurerTypeForDb,
        insurer_type_set_by_staff: insurerTypeForDb !== null,
      })

    if (insErr) {
      console.error(`[confirmSuggestionsForDoctor] insert error:`, insErr.message)
    } else {
      created++
    }
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'isalud_suggestions_imported_for_doctor',
    actor_type: 'staff',
    target_type: 'doctor',
    target_id: doctorId,
    details: { selected: items.length, created, skipped },
  })

  // NOTA: NO borramos el staging (distinto a confirmImportForDoctor del flujo viejo).
  // Lady puede iterar por varios médicos sin re-scrapear.

  revalidatePath(`/dashboard/doctors/${doctorId}`)

  return { ok: true, created, skipped }
}
