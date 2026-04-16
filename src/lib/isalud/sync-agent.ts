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
  console.log(`[iSalud importISalud] START for clinic ${clinicId}, subdomain: ${credentials.subdomain}`)

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
    console.log('[iSalud importISalud] Calling scrapeISalud...')
    const result = await scrapeISalud(credentials, { diasAdelante: 60 })
    console.log(`[iSalud importISalud] Scrape returned: ${result.profesionales.length} profs, ${result.admisiones.length} admisiones, ${result.errors.length} errors`)
    if (result.errors.length > 0) console.log(`[iSalud importISalud] Scrape errors: ${result.errors.slice(0, 3).join('; ')}`)
    return await ingestISaludData(clinicId, result.profesionales, result.admisiones, result.errors)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error(`[iSalud importISalud] FATAL ERROR: ${errMsg}`)
    console.error(`[iSalud importISalud] STACK: ${stack}`)
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
      console.log(`[iSalud syncAll] Syncing clinic ${integration.clinic_id}, subdomain: ${creds.subdomain}, dias: ${dias}`)
      const result = await scrapeISalud(creds, { diasAdelante: dias })
      console.log(`[iSalud syncAll] Scrape result: ${result.profesionales.length} profs, ${result.admisiones.length} admisiones, ${result.errors.length} errors`)
      if (result.errors.length > 0) console.log(`[iSalud syncAll] Errors: ${result.errors.slice(0, 3).join('; ')}`)
      await ingestISaludData(integration.clinic_id, result.profesionales, result.admisiones, result.errors)
      synced++
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[iSalud syncAll] FATAL for clinic ${integration.clinic_id}: ${errMsg}`)
      console.error(`[iSalud syncAll] STACK: ${err instanceof Error ? err.stack : ''}`)
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

    const insertErrors = errors.filter((e) => e.startsWith('Insert ')).length
    console.log(`[iSalud] Clinic ${clinicId}: +${doctorsCreated} docs, ${appointmentsBlocked} blocked, ${insertErrors} insert errors, ${errors.length} total errors`)
    if (insertErrors > 0) console.log(`[iSalud] Sample errors: ${errors.filter((e) => e.startsWith('Insert ')).slice(0, 3).join(' | ')}`)
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
      await supabaseAdmin.from('doctors').update({ working_hours: buildDefaultWorkingHours() as unknown as Record<string, unknown> }).eq('id', doctorId)
    }
    return { doctorId, created: false }
  }

  const workingHours = buildDefaultWorkingHours()
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

/**
 * Returns conservative default working hours for imported doctors.
 * Does NOT infer from iSalud data — historical slots give unreliable ranges.
 * The admin configures real hours manually in the Omuwan dashboard.
 *
 * Formato nuevo: { active, blocks: [{start, end}] }
 */
function buildDefaultWorkingHours(): Record<string, { active: boolean; blocks: Array<{ start: string; end: string }> }> {
  return {
    sunday:    { active: false, blocks: [] },
    monday:    { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
    tuesday:   { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
    wednesday: { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
    thursday:  { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
    friday:    { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
    saturday:  { active: true,  blocks: [{ start: '08:00', end: '13:00' }] },
  }
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

    // Validate fecha format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(adm.fecha)) { errors.push(`Bad date: ${adm.fecha}`); continue }
    if (!adm.hora_inicial || !adm.hora_inicial.includes(':')) { errors.push(`Bad time: ${adm.hora_inicial}`); continue }

    const [h, m] = adm.hora_inicial.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) { errors.push(`Invalid time: ${adm.hora_inicial}`); continue }

    const startsAt = new Date(`${adm.fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`)

    // Use real hora_final from iSalud (column 15), fallback to +30min
    let endsAt: Date
    if (adm.hora_final && adm.hora_final.includes(':')) {
      const [eh, em] = adm.hora_final.split(':').map(Number)
      if (!isNaN(eh) && !isNaN(em)) {
        endsAt = new Date(`${adm.fecha}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00-05:00`)
      } else {
        endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)
      }
    } else {
      endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)
    }

    const externalId = `isalud-${adm.id}-${adm.fecha}`

    if (count < 3) {
      console.log(`[iSalud] Upsert: ${externalId} | ${adm.fecha} ${adm.hora_inicial}-${adm.hora_final} → ${startsAt.toISOString()} - ${endsAt.toISOString()} | ${adm.nombre_paciente}`)
    }

    // Patient name for calendar display
    const reasonText = adm.nombre_paciente || 'Cita iSalud'
    const notesText = `[iSalud] ${adm.nombre_paciente} | ${adm.procedimiento} | ${adm.aseguradora} | ${adm.profesional_nombre}`

    const { data: ex } = await supabaseAdmin.from('appointments').select('id').eq('external_his_id', externalId).maybeSingle()
    if (ex) {
      const { error: updateErr } = await supabaseAdmin.from('appointments').update({
        status: 'blocked_external', external_data: adm as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(), reason: reasonText, notes: notesText,
      }).eq('id', (ex as { id: string }).id)
      if (updateErr) {
        if (count < 3) console.error(`[iSalud] Update failed: ${updateErr.message}`)
        errors.push(`Update ${externalId}: ${updateErr.message}`)
        continue
      }
    } else {
      const insertPayload = {
        clinic_id: clinicId, doctor_id: doctorId,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        status: 'blocked_external', source: 'isalud',
        external_his_id: externalId, external_source: 'isalud',
        external_data: adm as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
        reason: reasonText, notes: notesText,
      }
      const { error: insertErr } = await supabaseAdmin.from('appointments').insert(insertPayload)
      if (insertErr) {
        console.error(`[iSalud] INSERT FAILED #${errors.length}: ${insertErr.message} | code=${insertErr.code} | details=${insertErr.details} | hint=${insertErr.hint}`)
        console.error(`[iSalud] Payload: extId=${externalId} starts=${startsAt.toISOString()} doctor=${doctorId} clinic=${clinicId}`)
        errors.push(`Insert ${externalId}: ${insertErr.message}`)
        continue
      }
    }
    count++
  }
  return count
}

// Orphan cleanup DISABLED — re-enable after confirming multi-day scraping works.
// The scraper may only return today's citas, causing all future appointments
// to be falsely identified as orphans and cancelled.
async function cleanupOrphans(clinicId: string, currentAdmisiones: ISaludAdmision[]): Promise<number> {
  const currentIds = new Set(currentAdmisiones.map((a) => `isalud-${a.id}-${a.fecha}`))
  const { data: blocked } = await supabaseAdmin.from('appointments').select('id, external_his_id').eq('clinic_id', clinicId).eq('status', 'blocked_external').eq('external_source', 'isalud').gte('starts_at', new Date().toISOString())

  const dbCount = blocked?.length ?? 0
  const scrapeCount = currentIds.size
  console.log(`[iSalud] Orphan check: DB has ${dbCount} blocked_external, scrape has ${scrapeCount} IDs`)
  if (dbCount > 0 && blocked) {
    const sample = (blocked[0] as { external_his_id: string | null }).external_his_id
    const sampleScrape = currentIds.size > 0 ? Array.from(currentIds)[0] : 'none'
    console.log(`[iSalud] Sample DB id: ${sample}`)
    console.log(`[iSalud] Sample scrape id: ${sampleScrape}`)
  }

  // DISABLED: don't cancel anything until multi-day scraping is confirmed
  console.log(`[iSalud] Orphan cleanup SKIPPED (disabled) — would have checked ${dbCount} appointments`)
  return 0
}
