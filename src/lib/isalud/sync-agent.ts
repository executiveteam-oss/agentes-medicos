// ============================================================
// iSalud Sync Agent — Playwright scraping + DB operations
//
// importISalud()  — Initial: save creds + scrape + ingest
// syncAllISaludIntegrations() — Cron: scrape + ingest for all orgs
// ingestISaludData() — DB-only: create doctors + block appointments
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { scrapeISalud, type ISaludCredentials, type ISaludProfesional, type ISaludAdmision } from './adapter'

// --- Types ---

interface ISaludDisponibilidadSlot {
  dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string
}

export interface ImportResult {
  doctors_created: number
  doctors_existing: number
  appointments_blocked: number
  errors: string[]
}

// --- Import (initial setup from dashboard) ---

export async function importISalud(credentials: ISaludCredentials, clinicId: string): Promise<ImportResult> {
  // Save credentials
  await supabaseAdmin
    .from('sync_integrations')
    .upsert({
      clinic_id: clinicId,
      provider: 'isalud',
      credentials: credentials as unknown as Record<string, unknown>,
      sync_status: 'running',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clinic_id,provider' })

  try {
    const result = await scrapeISalud(credentials, { diasAdelante: 60 })
    return await ingestISaludData(clinicId, result.profesionales, result.admisiones, result.errors)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('sync_integrations')
      .update({ sync_status: 'error', sync_error: errMsg, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId).eq('provider', 'isalud')
    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  }
}

// --- Cron: sync all active integrations ---

export async function syncAllISaludIntegrations(): Promise<{ synced: number; errors: string[] }> {
  const { data: integrations } = await supabaseAdmin
    .from('sync_integrations')
    .select('id, clinic_id, credentials, config')
    .eq('provider', 'isalud')
    .neq('sync_status', 'running')

  if (!integrations || integrations.length === 0) return { synced: 0, errors: [] }

  let synced = 0
  const errors: string[] = []

  for (const raw of integrations) {
    const integration = raw as { id: string; clinic_id: string; credentials: Record<string, unknown>; config: { dias_adelante?: number } }
    const creds: ISaludCredentials = {
      subdomain: integration.credentials.subdomain as string,
      username: integration.credentials.username as string,
      password: integration.credentials.password as string,
    }

    await supabaseAdmin.from('sync_integrations').update({ sync_status: 'running', updated_at: new Date().toISOString() }).eq('id', integration.id)

    try {
      const dias = integration.config?.dias_adelante ?? 60
      const result = await scrapeISalud(creds, { diasAdelante: dias })
      await ingestISaludData(integration.clinic_id, result.profesionales, result.admisiones, result.errors)
      synced++
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      errors.push(`Clinic ${integration.clinic_id}: ${errMsg}`)
      await supabaseAdmin.from('sync_integrations').update({ sync_status: 'error', sync_error: errMsg, updated_at: new Date().toISOString() }).eq('id', integration.id)
    }
  }

  return { synced, errors }
}

// --- Ingest: DB-only (process scraped data) ---

export async function ingestISaludData(
  clinicId: string,
  profesionales: ISaludProfesional[],
  admisiones: ISaludAdmision[],
  scrapeErrors: string[] = []
): Promise<ImportResult> {
  const errors = [...scrapeErrors]
  let doctorsCreated = 0, doctorsExisting = 0

  await supabaseAdmin.from('sync_integrations').update({ sync_status: 'running', updated_at: new Date().toISOString() }).eq('clinic_id', clinicId).eq('provider', 'isalud')

  try {
    for (const prof of profesionales) {
      const mapped = await getOrCreateDoctor(clinicId, prof)
      if (mapped.created) doctorsCreated++; else doctorsExisting++
    }

    const appointmentsBlocked = await upsertBlockedAppointments(clinicId, admisiones, errors)
    await cleanupOrphans(clinicId, admisiones)

    await supabaseAdmin.from('sync_integrations').update({
      sync_status: 'idle', last_synced_at: new Date().toISOString(),
      sync_error: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId).eq('provider', 'isalud')

    console.log(`[iSalud] Clinic ${clinicId}: +${doctorsCreated} docs, ${appointmentsBlocked} blocked`)
    return { doctors_created: doctorsCreated, doctors_existing: doctorsExisting, appointments_blocked: appointmentsBlocked, errors }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin.from('sync_integrations').update({ sync_status: 'error', sync_error: errMsg, updated_at: new Date().toISOString() }).eq('clinic_id', clinicId).eq('provider', 'isalud')
    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  }
}

// --- Helpers ---

async function getOrCreateDoctor(clinicId: string, prof: ISaludProfesional): Promise<{ doctorId: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin.from('doctor_external_mappings').select('doctor_id').eq('clinic_id', clinicId).eq('provider', 'isalud').eq('external_name', prof.nombre).maybeSingle()

  if (existing) {
    const doctorId = (existing as { doctor_id: string }).doctor_id
    const { data: doc } = await supabaseAdmin.from('doctors').select('working_hours').eq('id', doctorId).maybeSingle()
    if (doc && !(doc as { working_hours: unknown }).working_hours && prof.slots.length > 0) {
      await supabaseAdmin.from('doctors').update({ working_hours: buildWorkingHours(prof.slots) as unknown as Record<string, unknown> }).eq('id', doctorId)
    }
    return { doctorId, created: false }
  }

  const workingHours = buildWorkingHours(prof.slots)
  const { data: byName } = await supabaseAdmin.from('doctors').select('id, working_hours').eq('clinic_id', clinicId).ilike('name', prof.nombre).maybeSingle()

  let doctorId: string; let created = false
  if (byName) {
    doctorId = (byName as { id: string }).id
    if (!(byName as { working_hours: unknown }).working_hours) {
      await supabaseAdmin.from('doctors').update({ working_hours: workingHours as unknown as Record<string, unknown> }).eq('id', doctorId)
    }
  } else {
    const { data: newDoc } = await supabaseAdmin.from('doctors').insert({ clinic_id: clinicId, name: prof.nombre, specialty: null, is_active: true, schedule_type: 'fixed', agenda_closed: false, working_hours: workingHours as unknown as Record<string, unknown> }).select('id').single()
    if (!newDoc) throw new Error(`Failed to create doctor: ${prof.nombre}`)
    doctorId = (newDoc as { id: string }).id; created = true
  }

  await supabaseAdmin.from('doctor_external_mappings').insert({ clinic_id: clinicId, doctor_id: doctorId, provider: 'isalud', external_name: prof.nombre, external_metadata: { puntos_atencion: prof.puntos_atencion } as unknown as Record<string, unknown> })
  return { doctorId, created }
}

function buildWorkingHours(slots: ISaludDisponibilidadSlot[]): Record<string, { start: string; end: string; active: boolean }> {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const result: Record<string, { start: string; end: string; active: boolean }> = {}
  for (const d of dayNames) result[d] = { start: '00:00', end: '00:00', active: false }

  if (slots.length === 0) {
    for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) result[d] = { start: '08:00', end: '18:00', active: true }
    return result
  }

  const byDay = new Map<number, { starts: string[]; ends: string[] }>()
  for (const s of slots) {
    if (!byDay.has(s.dia_semana)) byDay.set(s.dia_semana, { starts: [], ends: [] })
    const e = byDay.get(s.dia_semana)!
    if (s.hora_inicio) e.starts.push(s.hora_inicio)
    if (s.hora_fin) e.ends.push(s.hora_fin)
  }
  for (const [n, { starts, ends }] of byDay) {
    const name = dayNames[n]; if (!name) continue
    result[name] = { start: starts.sort()[0] ?? '08:00', end: ends.sort().reverse()[0] ?? '18:00', active: true }
  }
  return result
}

async function upsertBlockedAppointments(clinicId: string, admisiones: ISaludAdmision[], errors: string[]): Promise<number> {
  let count = 0
  for (const adm of admisiones) {
    let mapping = await supabaseAdmin.from('doctor_external_mappings').select('doctor_id').eq('clinic_id', clinicId).eq('provider', 'isalud').eq('external_name', adm.profesional_nombre).maybeSingle()
    if (!mapping.data) {
      await getOrCreateDoctor(clinicId, { nombre: adm.profesional_nombre, puntos_atencion: [adm.ubicacion], slots: [] })
      mapping = await supabaseAdmin.from('doctor_external_mappings').select('doctor_id').eq('clinic_id', clinicId).eq('provider', 'isalud').eq('external_name', adm.profesional_nombre).maybeSingle()
    }
    const doctorId = (mapping.data as { doctor_id: string } | null)?.doctor_id
    if (!doctorId) { errors.push(`No mapping: ${adm.profesional_nombre}`); continue }

    const [h, m] = adm.hora_inicial.split(':').map(Number)
    const startsAt = new Date(`${adm.fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`)
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)
    const externalId = `isalud-${adm.id}-${adm.fecha}`

    const { data: ex } = await supabaseAdmin.from('appointments').select('id').eq('external_his_id', externalId).maybeSingle()
    if (ex) {
      await supabaseAdmin.from('appointments').update({ status: 'blocked_external', external_data: adm as unknown as Record<string, unknown>, synced_at: new Date().toISOString() }).eq('id', (ex as { id: string }).id)
    } else {
      await supabaseAdmin.from('appointments').insert({ clinic_id: clinicId, doctor_id: doctorId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: 'blocked_external', source: 'isalud', external_his_id: externalId, external_source: 'isalud', external_data: adm as unknown as Record<string, unknown>, synced_at: new Date().toISOString(), reason: `${adm.procedimiento} — ${adm.nombre_paciente}` })
    }
    count++
  }
  return count
}

async function cleanupOrphans(clinicId: string, currentAdmisiones: ISaludAdmision[]): Promise<number> {
  const currentIds = new Set(currentAdmisiones.map((a) => `isalud-${a.id}-${a.fecha}`))
  const { data: blocked } = await supabaseAdmin.from('appointments').select('id, external_his_id').eq('clinic_id', clinicId).eq('status', 'blocked_external').eq('external_source', 'isalud').gte('starts_at', new Date().toISOString())
  if (!blocked) return 0
  let cancelled = 0
  for (const a of blocked) {
    const extId = (a as { id: string; external_his_id: string | null }).external_his_id
    if (extId && !currentIds.has(extId)) {
      await supabaseAdmin.from('appointments').update({ status: 'cancelled', cancellation_reason: 'isalud_sync_orphan' }).eq('id', (a as { id: string }).id)
      cancelled++
    }
  }
  return cancelled
}
