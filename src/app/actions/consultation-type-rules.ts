'use server'

// ============================================================
// Server Actions — Reglas configurables por tipo de consulta
//
// Bloque 1 (escalate_human) implementado. Bloques 2-6 son futuro
// — la tabla consultation_type_rules ya tiene CHECK para los 6.
//
// Gate de permiso: 'whatsapp' (mismo patrón que el resto de las
// actions de consultation_types — ver CLAUDE.md sección
// "Permission gates en doctors").
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission, extractActionError } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import {
  AgeLimitConfigSchema,
  deriveRowActionFromConfig,
  type AgeLimitConfig,
} from '@/lib/rules/age-limit-config'
import {
  PatientConditionConfigSchema,
  deriveRowActionFromPatientConditionConfig,
  type PatientConditionConfig,
} from '@/lib/rules/patient-condition-config'
import {
  AuthConvenioConfigSchema,
  type AuthConvenioConfig,
} from '@/lib/rules/auth-convenio-config'

// --- Tipos ---

export type RuleType =
  | 'escalate_human'
  | 'age_limit'
  | 'patient_condition'
  | 'requires_authorization'
  | 'special_message'
  | 'clinical_doc_review'

export type RuleAction =
  | 'derivar_humano'
  | 'informar_y_agendar'
  | 'informar_y_derivar'
  | 'rechazar'

export interface ConsultationTypeRule {
  id: string
  consultation_type_id: string
  clinic_id: string
  rule_type: RuleType
  condition_config: Record<string, unknown>
  action: RuleAction
  message: string | null
  /** POR QUÉ existe esta regla. Nota INTERNA del equipo de la clínica: se ve
   *  sólo en el editor y NUNCA se le muestra a la paciente ni se le pasa al
   *  modelo. Vacío = nadie escribió el motivo todavía. */
  motivo_interno: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// --- Bloque 1: escalate_human ---

/**
 * Activa la regla "escalar siempre a humano" para un tipo de consulta.
 * Si ya existía una regla escalate_human inactiva, la reactiva.
 * Idempotente: llamar dos veces no crea duplicados.
 */
export async function enableEscalateHumanRule(
  consultationTypeId: string,
): Promise<{ ok: boolean; error?: string; rule?: ConsultationTypeRule }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data: ct, error: ctErr } = await supabaseAdmin
    .from('consultation_types')
    .select('id, clinic_id, name')
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (ctErr) return { ok: false, error: 'Error consultando tipo de consulta' }
  if (!ct) return { ok: false, error: 'Tipo de consulta no encontrado en esta clínica' }

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'escalate_human')
    .maybeSingle()

  let ruleId: string
  if (existing) {
    if (existing.active) {
      ruleId = existing.id
    } else {
      const { error: upErr } = await supabaseAdmin
        .from('consultation_type_rules')
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (upErr) return { ok: false, error: 'Error reactivando regla' }
      ruleId = existing.id
    }
  } else {
    const { data: created, error: insErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .insert({
        consultation_type_id: consultationTypeId,
        clinic_id: clinicId,
        rule_type: 'escalate_human',
        condition_config: {},
        action: 'derivar_humano',
        message: null,
        active: true,
      })
      .select('*')
      .single()
    if (insErr || !created) return { ok: false, error: 'Error creando regla' }
    ruleId = created.id
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_enabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: {
      consultation_type_id: consultationTypeId,
      consultation_type_name: ct.name,
      rule_type: 'escalate_human',
    },
  })

  revalidatePath('/dashboard/doctors')

  const { data: finalRule } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('*')
    .eq('id', ruleId)
    .single()

  return { ok: true, rule: finalRule as ConsultationTypeRule }
}

/**
 * Desactiva la regla escalate_human. NO borra la fila (preserva audit) —
 * setea active=false. Si Lady la vuelve a activar, se reusa la misma fila.
 * Idempotente.
 */
export async function disableEscalateHumanRule(
  consultationTypeId: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'escalate_human')
    .maybeSingle()

  if (!existing) return { ok: true }
  if (!existing.active) return { ok: true }

  const { error: upErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('clinic_id', clinicId)

  if (upErr) return { ok: false, error: 'Error desactivando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_disabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: existing.id,
    details: {
      consultation_type_id: consultationTypeId,
      rule_type: 'escalate_human',
    },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Devuelve todas las reglas (activas e inactivas) de un consultation_type.
 * Útil para la UI: muestra el estado actual del toggle.
 */
/**
 * Guarda el motivo INTERNO de una regla — por qué existe.
 *
 * No toca `active`, ni `action`, ni `condition_config`: el agente se comporta
 * exactamente igual antes y después de escribir esto. Es una nota del equipo
 * para el equipo, y el executor ni siquiera selecciona esta columna.
 */
export async function setMotivoInternoRegla(
  consultationTypeId: string,
  ruleType: RuleType,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const texto = motivo.trim().slice(0, 1000) || null

  const { data, error } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({ motivo_interno: texto, updated_at: new Date().toISOString() })
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', ruleType)
    .eq('clinic_id', clinicId)   // el tenant SIEMPRE, aunque el id ya acote
    .select('id')

  if (error) return { ok: false, error: 'No se pudo guardar el motivo' }
  // Un UPDATE que no tocó ninguna fila devuelve error null: hay que mirar el
  // conteo o la pantalla dice "guardado" sobre nada.
  if (!data || data.length === 0) return { ok: false, error: 'La regla no existe en esta clínica' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId, action: 'regla_motivo_interno_editado', actor_type: 'user',
    target_type: 'consultation_type', target_id: consultationTypeId,
    details: { rule_type: ruleType, tiene_motivo: texto !== null },
  })
  return { ok: true }
}

export async function getRulesForConsultationType(
  consultationTypeId: string,
): Promise<ConsultationTypeRule[]> {
  let clinicId: string
  try { clinicId = await checkReadPermission('whatsapp') }
  catch { return [] }

  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('*')
    .eq('consultation_type_id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true })

  return (data ?? []) as ConsultationTypeRule[]
}

/**
 * Helper interno: devuelve true si el consultation_type tiene regla
 * escalate_human activa. Usado por el executor del agente (capa B).
 *
 * NO chequea permisos — se llama desde el executor del agente que
 * ya tiene clinic_id validado por otros medios. NO exportar al cliente.
 */
export async function hasActiveEscalateHumanRule(
  consultationTypeId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'escalate_human')
    .eq('active', true)
    .maybeSingle()

  return !!data
}

// --- Bloque 2: age_limit ---

/**
 * Crea o actualiza la regla age_limit para un tipo de consulta.
 * Una sola fila por (consultation_type, 'age_limit') — si ya existe,
 * actualiza condition_config y action.
 */
export async function upsertAgeLimitRule(
  consultationTypeId: string,
  config: AgeLimitConfig,
): Promise<{ ok: boolean; error?: string; rule?: ConsultationTypeRule }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const parsed = AgeLimitConfigSchema.safeParse(config)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Configuración de edad inválida' }
  }
  const validConfig = parsed.data

  const { data: ct, error: ctErr } = await supabaseAdmin
    .from('consultation_types')
    .select('id, clinic_id, name')
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (ctErr) return { ok: false, error: 'Error consultando tipo de consulta' }
  if (!ct) return { ok: false, error: 'Tipo de consulta no encontrado en esta clínica' }

  const rowAction = deriveRowActionFromConfig(validConfig)

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active, condition_config, action')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'age_limit')
    .maybeSingle()

  let ruleId: string
  let auditAction: 'consultation_type_rule_enabled' | 'consultation_type_rule_updated'

  if (existing) {
    const { error: upErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .update({
        condition_config: validConfig,
        action: rowAction,
        active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (upErr) return { ok: false, error: 'Error actualizando regla' }
    ruleId = existing.id
    auditAction = existing.active ? 'consultation_type_rule_updated' : 'consultation_type_rule_enabled'
  } else {
    const { data: created, error: insErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .insert({
        consultation_type_id: consultationTypeId,
        clinic_id: clinicId,
        rule_type: 'age_limit',
        condition_config: validConfig,
        action: rowAction,
        message: null,
        active: true,
      })
      .select('*')
      .single()
    if (insErr || !created) return { ok: false, error: 'Error creando regla' }
    ruleId = created.id
    auditAction = 'consultation_type_rule_enabled'
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: auditAction,
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: {
      consultation_type_id: consultationTypeId,
      consultation_type_name: ct.name,
      rule_type: 'age_limit',
      condition_config: validConfig,
    },
  })

  revalidatePath('/dashboard/doctors')

  const { data: finalRule } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('*')
    .eq('id', ruleId)
    .single()

  return { ok: true, rule: finalRule as ConsultationTypeRule }
}

/**
 * Desactiva la regla age_limit. NO borra la fila (preserva config y audit).
 * Idempotente.
 */
export async function disableAgeLimitRule(
  consultationTypeId: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'age_limit')
    .maybeSingle()

  if (!existing) return { ok: true }
  if (!existing.active) return { ok: true }

  const { error: upErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('clinic_id', clinicId)

  if (upErr) return { ok: false, error: 'Error desactivando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_disabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: existing.id,
    details: { consultation_type_id: consultationTypeId, rule_type: 'age_limit' },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Helper interno: devuelve la config age_limit activa de un CT, o null.
 * Usado por el agente (capa A — armar el Map) y el executor (capa B).
 *
 * NO chequea permisos — se llama desde rutas del agente que ya tienen
 * clinic_id validado.
 */
export async function getActiveAgeLimitConfig(
  consultationTypeId: string,
): Promise<AgeLimitConfig | null> {
  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('condition_config')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'age_limit')
    .eq('active', true)
    .maybeSingle()

  if (!data) return null
  const parsed = AgeLimitConfigSchema.safeParse(data.condition_config)
  return parsed.success ? parsed.data : null
}

// --- Bloque 3: patient_condition ---

export interface PatientConditionRule extends ConsultationTypeRule {
  condition_config: PatientConditionConfig & Record<string, unknown>
}

/**
 * Crea una nueva regla patient_condition para un CT.
 * Múltiples preguntas en el mismo CT = múltiples filas (una por pregunta).
 * NO es idempotente como las otras — siempre INSERT.
 */
export async function createPatientConditionRule(
  consultationTypeId: string,
  config: PatientConditionConfig,
): Promise<{ ok: boolean; error?: string; rule?: ConsultationTypeRule }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const parsed = PatientConditionConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Configuración inválida' }
  }
  const validConfig = parsed.data

  const { data: ct, error: ctErr } = await supabaseAdmin
    .from('consultation_types')
    .select('id, name')
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (ctErr) return { ok: false, error: 'Error consultando tipo de consulta' }
  if (!ct) return { ok: false, error: 'Tipo de consulta no encontrado en esta clínica' }

  // El column 'action' de la fila es informativo (no es la fuente de verdad —
  // esa vive en condition_config). Para yes_no usamos action_on_trigger; para
  // multiple_choice usamos la acción "más bloqueante" entre las opciones
  // (rechazar > derivar_humano > continuar). El executor lee condition_config,
  // no este campo.
  const rowAction = deriveRowActionFromPatientConditionConfig(validConfig)

  const { data: created, error: insErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .insert({
      consultation_type_id: consultationTypeId,
      clinic_id: clinicId,
      rule_type: 'patient_condition',
      condition_config: validConfig,
      action: rowAction,
      message: null,
      active: true,
    })
    .select('*')
    .single()
  if (insErr || !created) return { ok: false, error: 'Error creando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_enabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: created.id,
    details: {
      consultation_type_id: consultationTypeId,
      consultation_type_name: ct.name,
      rule_type: 'patient_condition',
      question: validConfig.question,
    },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true, rule: created as ConsultationTypeRule }
}

/**
 * Actualiza una regla patient_condition existente (por rule_id, no ctId,
 * porque puede haber varias del mismo tipo para un CT).
 */
export async function updatePatientConditionRule(
  ruleId: string,
  config: PatientConditionConfig,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const parsed = PatientConditionConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Configuración inválida' }
  }

  const { error: upErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({
      condition_config: parsed.data,
      action: deriveRowActionFromPatientConditionConfig(parsed.data),
      updated_at: new Date().toISOString(),
    })
    .eq('id', ruleId)
    .eq('clinic_id', clinicId)
    .eq('rule_type', 'patient_condition')

  if (upErr) return { ok: false, error: 'Error actualizando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_updated',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: { rule_type: 'patient_condition', question: parsed.data.question },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Activa o desactiva una regla patient_condition (sin borrarla).
 */
export async function togglePatientConditionRule(
  ruleId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { error: upErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', ruleId)
    .eq('clinic_id', clinicId)
    .eq('rule_type', 'patient_condition')

  if (upErr) return { ok: false, error: 'Error actualizando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: active ? 'consultation_type_rule_enabled' : 'consultation_type_rule_disabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: { rule_type: 'patient_condition' },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Borra una regla patient_condition. Preserva audit_log.
 */
export async function deletePatientConditionRule(
  ruleId: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { error: delErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .delete()
    .eq('id', ruleId)
    .eq('clinic_id', clinicId)
    .eq('rule_type', 'patient_condition')

  if (delErr) return { ok: false, error: 'Error eliminando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_deleted',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: { rule_type: 'patient_condition' },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Devuelve TODAS las reglas patient_condition de un CT (activas e inactivas)
 * — para la UI del editor.
 */
export async function getPatientConditionRulesForCt(
  consultationTypeId: string,
): Promise<PatientConditionRule[]> {
  let clinicId: string
  try { clinicId = await checkReadPermission('whatsapp') }
  catch { return [] }

  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('*')
    .eq('consultation_type_id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .eq('rule_type', 'patient_condition')
    .order('created_at', { ascending: true })

  return (data ?? []) as PatientConditionRule[]
}

/**
 * Helper interno (sin permission check) para el agente: devuelve reglas
 * patient_condition ACTIVAS para una lista de CTs.
 * El agente usa esto para armar el Map ctId → reglas activas.
 */
export async function getActivePatientConditionRulesForCts(
  consultationTypeIds: string[],
): Promise<Array<{ id: string; consultation_type_id: string; config: PatientConditionConfig }>> {
  if (consultationTypeIds.length === 0) return []
  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, consultation_type_id, condition_config')
    .eq('rule_type', 'patient_condition')
    .eq('active', true)
    .in('consultation_type_id', consultationTypeIds)

  const result: Array<{ id: string; consultation_type_id: string; config: PatientConditionConfig }> = []
  for (const row of data ?? []) {
    const r = row as { id: string; consultation_type_id: string; condition_config: unknown }
    const parsed = PatientConditionConfigSchema.safeParse(r.condition_config)
    if (parsed.success) {
      result.push({ id: r.id, consultation_type_id: r.consultation_type_id, config: parsed.data })
    }
  }
  return result
}

// --- Bloque 4: requires_authorization (auth_convenio) ---

export interface AuthConvenioRule extends ConsultationTypeRule {
  condition_config: AuthConvenioConfig & Record<string, unknown>
}

/**
 * Crea o actualiza la regla auth_convenio del CT (una sola por CT).
 */
export async function upsertAuthConvenioRule(
  consultationTypeId: string,
  config: AuthConvenioConfig,
): Promise<{ ok: boolean; error?: string; rule?: ConsultationTypeRule }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const parsed = AuthConvenioConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Configuración inválida' }
  }
  const validConfig = parsed.data

  const { data: ct } = await supabaseAdmin
    .from('consultation_types')
    .select('id, name')
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!ct) return { ok: false, error: 'Tipo de consulta no encontrado en esta clínica' }

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'requires_authorization')
    .maybeSingle()

  let ruleId: string
  let auditAction: 'consultation_type_rule_enabled' | 'consultation_type_rule_updated'

  if (existing) {
    const { error: upErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .update({
        condition_config: validConfig,
        action: 'derivar_humano', // todas las reglas de auth siguen el mismo flujo
        active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (upErr) return { ok: false, error: 'Error actualizando regla' }
    ruleId = existing.id
    auditAction = existing.active ? 'consultation_type_rule_updated' : 'consultation_type_rule_enabled'
  } else {
    const { data: created, error: insErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .insert({
        consultation_type_id: consultationTypeId,
        clinic_id: clinicId,
        rule_type: 'requires_authorization',
        condition_config: validConfig,
        action: 'derivar_humano',
        message: null,
        active: true,
      })
      .select('*')
      .single()
    if (insErr || !created) return { ok: false, error: 'Error creando regla' }
    ruleId = created.id
    auditAction = 'consultation_type_rule_enabled'
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: auditAction,
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: ruleId,
    details: {
      consultation_type_id: consultationTypeId,
      consultation_type_name: ct.name,
      rule_type: 'requires_authorization',
      convenios_count: validConfig.convenios_que_requieren.length,
    },
  })

  revalidatePath('/dashboard/doctors')
  const { data: finalRule } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('*')
    .eq('id', ruleId)
    .single()
  return { ok: true, rule: finalRule as ConsultationTypeRule }
}

export async function disableAuthConvenioRule(
  consultationTypeId: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data: existing } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('id, active')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'requires_authorization')
    .maybeSingle()

  if (!existing || !existing.active) return { ok: true }

  const { error: upErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('clinic_id', clinicId)
  if (upErr) return { ok: false, error: 'Error desactivando regla' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'consultation_type_rule_disabled',
    actor_type: 'staff',
    target_type: 'consultation_type_rule',
    target_id: existing.id,
    details: { consultation_type_id: consultationTypeId, rule_type: 'requires_authorization' },
  })

  revalidatePath('/dashboard/doctors')
  return { ok: true }
}

/**
 * Helper interno (sin permission check): devuelve la config auth_convenio
 * activa de un CT, o null. Usado por agente (capa A) y executor (capa B).
 */
export async function getActiveAuthConvenioConfig(
  consultationTypeId: string,
): Promise<AuthConvenioConfig | null> {
  const { data } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('condition_config')
    .eq('consultation_type_id', consultationTypeId)
    .eq('rule_type', 'requires_authorization')
    .eq('active', true)
    .maybeSingle()

  if (!data) return null
  const parsed = AuthConvenioConfigSchema.safeParse(data.condition_config)
  return parsed.success ? parsed.data : null
}

/**
 * Lista los convenios disponibles para configurar en el editor de auth.
 *
 * Post-unificación 2026-07-10: la fuente es `available_conventions` (TEXT[])
 * que quedó poblado en cada CT canónico como parte del dedup. Antes de la
 * unificación, los convenios se derivaban de filas duplicadas por convenio;
 * ahora vienen del array. Se conserva el fallback a `eps_name` legacy por si
 * queda alguna fila vieja o de otras clínicas sin migrar.
 */
export async function getAvailableConveniosForClinic(): Promise<string[]> {
  let clinicId: string
  try { clinicId = await checkReadPermission('whatsapp') }
  catch { return [] }

  const { data } = await supabaseAdmin
    .from('consultation_types')
    .select('eps_name, available_conventions')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)

  const unique = new Set<string>()
  for (const row of data ?? []) {
    const r = row as { eps_name: string | null; available_conventions: string[] | null }
    // Fuente nueva: array de convenios asociados al servicio (post-dedup)
    if (Array.isArray(r.available_conventions)) {
      for (const c of r.available_conventions) {
        if (c && c.trim()) unique.add(c.trim())
      }
    }
    // Fallback legacy: eps_name scalar (para CTs no migrados o de otras clínicas)
    if (r.eps_name && r.eps_name.trim()) unique.add(r.eps_name.trim())
  }
  return Array.from(unique).sort()
}
