// ============================================================
// iSalud Sync Agent — Playwright scraping + DB operations
//
// importISalud()  — Initial: save creds + scrape + ingest
// syncAllISaludIntegrations() — Cron: scrape + ingest for all orgs
// ingestISaludData() — DB-only: create doctors + block appointments
//
// State management hardening (2026-06-08):
// - Stale-running detection: cron picks up rows stuck in 'running' for >1h
// - finally block: recovers state if try/catch path doesn't reach a terminal status
// - Inner try/catch around catch's DB write: error msg never lost silently
// - RUN START/END logs with duration for future post-mortem
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

/**
 * Umbral de detección de runs colgados en 'running'.
 * Si un run lleva más que esto sin actualizar `updated_at`, el cron lo retoma.
 * 1 hora es seguro porque el cron corre `30 * * * *` y un run normal dura ~75s.
 */
const STALE_RUNNING_MS = 60 * 60 * 1000

/**
 * Helper para persistir el error en sync_integrations.
 * Si el propio UPDATE falla (RLS, red), loguea pero no propaga — la garantía
 * es "best-effort": preferimos un error logueado que perder la traza completa.
 */
async function persistSyncError(filter: { id?: string; clinic_id?: string }, errMsg: string, context: string): Promise<boolean> {
  try {
    let q = supabaseAdmin.from('sync_integrations').update({
      sync_status: 'error',
      sync_error: errMsg.slice(0, 500),  // cap por seguridad
      updated_at: new Date().toISOString(),
    })
    if (filter.id) q = q.eq('id', filter.id)
    if (filter.clinic_id) q = q.eq('clinic_id', filter.clinic_id).eq('provider', 'isalud')
    const { error: updateErr } = await q
    if (updateErr) {
      console.error(`[iSalud ${context}] Failed to persist sync_error: ${updateErr.message}`)
      return false
    }
    return true
  } catch (writeErr) {
    console.error(`[iSalud ${context}] Exception while persisting sync_error: ${writeErr instanceof Error ? writeErr.message : writeErr}`)
    return false
  }
}

// --- Import (initial setup from dashboard) ---

export async function importISalud(credentials: ISaludCredentials, clinicId: string): Promise<ImportResult> {
  const runStart = Date.now()
  const runStartIso = new Date(runStart).toISOString()
  console.log(`[iSalud importISalud] RUN START at ${runStartIso} for clinic ${clinicId}, subdomain: ${credentials.subdomain}`)

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

  let reachedTerminal = false  // true cuando llegamos a 'idle' (vía ingestISaludData) o 'error' (vía catch)

  try {
    console.log('[iSalud importISalud] Calling scrapeISalud...')
    const result = await scrapeISalud(credentials, { diasAdelante: 60 })
    console.log(`[iSalud importISalud] Scrape returned: ${result.profesionales.length} profs, ${result.admisiones.length} admisiones, ${result.errors.length} errors`)
    if (result.errors.length > 0) console.log(`[iSalud importISalud] Scrape errors: ${result.errors.slice(0, 3).join('; ')}`)
    const ingestResult = await ingestISaludData(clinicId, result.profesionales, result.admisiones, result.errors)
    reachedTerminal = true  // ingestISaludData ya setea status='idle' o 'error' internamente
    return ingestResult
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error(`[iSalud importISalud] FATAL ERROR: ${errMsg}`)
    console.error(`[iSalud importISalud] STACK: ${stack}`)
    const persisted = await persistSyncError({ clinic_id: clinicId }, errMsg, 'importISalud')
    if (persisted) reachedTerminal = true
    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  } finally {
    const durationS = (Date.now() - runStart) / 1000
    console.log(`[iSalud importISalud] RUN END at ${new Date().toISOString()}, duration=${durationS.toFixed(2)}s, reachedTerminal=${reachedTerminal}`)
    if (!reachedTerminal) {
      // El try/catch debería haber alcanzado un estado terminal. Si llegamos acá sin él,
      // algo raro pasó (ej: el catch's UPDATE falló y returnó false). Forzamos error.
      console.error(`[iSalud importISalud] UNEXPECTED: finally with reachedTerminal=false. Forzando sync_status=error.`)
      await persistSyncError(
        { clinic_id: clinicId },
        'sync interrupted before reaching terminal state (no error captured by try/catch)',
        'importISalud.finally'
      )
    }
  }
}

// --- Cron: sync all active integrations ---

export async function syncAllISaludIntegrations(): Promise<{ synced: number; errors: string[] }> {
  // Fix 2 — Stale-running detection.
  // Original filtro: .not('sync_status', 'in', '("running","disabled")') hacía
  // que un row pegado en 'running' nunca volviera a ejecutarse. Ahora permitimos
  // pickup si lleva >1h sin updated_at — auto-recuperación si el process muere
  // sin ejecutar try/catch (SIGKILL, OOM, timeout externo).
  const staleThresholdIso = new Date(Date.now() - STALE_RUNNING_MS).toISOString()
  const { data: integrations } = await supabaseAdmin
    .from('sync_integrations')
    .select('id, clinic_id, credentials, config, sync_status, updated_at')
    .eq('provider', 'isalud')
    .neq('sync_status', 'disabled')
    .or(`sync_status.neq.running,updated_at.lt.${staleThresholdIso}`)

  if (!integrations || integrations.length === 0) return { synced: 0, errors: [] }

  let synced = 0
  const errors: string[] = []

  for (const raw of integrations) {
    const integration = raw as { id: string; clinic_id: string; credentials: Record<string, unknown>; config: { dias_adelante?: number }; sync_status?: string; updated_at?: string }
    const creds: ISaludCredentials = {
      subdomain: integration.credentials.subdomain as string,
      username: integration.credentials.username as string,
      password: integration.credentials.password as string,
    }

    const runStart = Date.now()
    const runStartIso = new Date(runStart).toISOString()
    const wasStaleRecovery = integration.sync_status === 'running'  // entró por el bypass de stale
    console.log(`[iSalud syncAll] RUN START at ${runStartIso}, clinic=${integration.clinic_id}, subdomain=${creds.subdomain}, staleRecovery=${wasStaleRecovery}`)

    await supabaseAdmin.from('sync_integrations').update({ sync_status: 'running', updated_at: new Date().toISOString() }).eq('id', integration.id)

    let reachedTerminal = false

    try {
      const dias = integration.config?.dias_adelante ?? 60
      console.log(`[iSalud syncAll] Syncing clinic ${integration.clinic_id}, subdomain: ${creds.subdomain}, dias: ${dias}`)
      const result = await scrapeISalud(creds, { diasAdelante: dias })
      console.log(`[iSalud syncAll] Scrape result: ${result.profesionales.length} profs, ${result.admisiones.length} admisiones, ${result.errors.length} errors`)
      if (result.errors.length > 0) console.log(`[iSalud syncAll] Errors: ${result.errors.slice(0, 3).join('; ')}`)
      await ingestISaludData(integration.clinic_id, result.profesionales, result.admisiones, result.errors)
      reachedTerminal = true  // ingestISaludData seteó status a 'idle' o 'error'
      synced++
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[iSalud syncAll] FATAL for clinic ${integration.clinic_id}: ${errMsg}`)
      console.error(`[iSalud syncAll] STACK: ${err instanceof Error ? err.stack : ''}`)
      errors.push(`Clinic ${integration.clinic_id}: ${errMsg}`)
      const persisted = await persistSyncError({ id: integration.id }, errMsg, 'syncAll')
      if (persisted) reachedTerminal = true
    } finally {
      const durationS = (Date.now() - runStart) / 1000
      console.log(`[iSalud syncAll] RUN END at ${new Date().toISOString()}, clinic=${integration.clinic_id}, duration=${durationS.toFixed(2)}s, reachedTerminal=${reachedTerminal}`)
      if (!reachedTerminal) {
        // Safety net: catch's UPDATE falló y no marcamos terminal. Forzamos error
        // para que el próximo cron pueda decidir (con stale-detection, igual lo retomaría).
        console.error(`[iSalud syncAll] UNEXPECTED: finally with reachedTerminal=false. Forzando sync_status=error.`)
        await persistSyncError(
          { id: integration.id },
          'sync interrupted before reaching terminal state (no error captured by try/catch)',
          'syncAll.finally'
        )
      }
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
  const runStart = Date.now()
  console.log(`[iSalud ingest] RUN START at ${new Date(runStart).toISOString()}, clinic=${clinicId}, profs=${profesionales.length}, admisiones=${admisiones.length}`)
  const errors = [...scrapeErrors]
  let doctorsCreated = 0, doctorsExisting = 0

  await supabaseAdmin.from('sync_integrations').update({ sync_status: 'running', updated_at: new Date().toISOString() }).eq('clinic_id', clinicId).eq('provider', 'isalud')

  let reachedTerminal = false

  try {
    for (const prof of profesionales) {
      const mapped = await getOrCreateDoctor(clinicId, prof)
      if (mapped.created) doctorsCreated++; else doctorsExisting++
    }

    const appointmentsBlocked = await upsertBlockedAppointments(clinicId, admisiones, errors)
    await cleanupOrphans(clinicId, admisiones)

    const { error: idleUpdErr } = await supabaseAdmin.from('sync_integrations').update({
      sync_status: 'idle', last_synced_at: new Date().toISOString(),
      sync_error: errors.length > 0 ? errors.slice(0, 3).join('; ').slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId).eq('provider', 'isalud')
    if (idleUpdErr) {
      console.error(`[iSalud ingest] Failed to set sync_status=idle: ${idleUpdErr.message}`)
      // Aún así marcamos terminal: el work se completó, solo falló el UPDATE final
    }
    reachedTerminal = true

    const insertErrors = errors.filter((e) => e.startsWith('Insert ')).length
    console.log(`[iSalud] Clinic ${clinicId}: +${doctorsCreated} docs, ${appointmentsBlocked} blocked, ${insertErrors} insert errors, ${errors.length} total errors`)
    if (insertErrors > 0) console.log(`[iSalud] Sample errors: ${errors.filter((e) => e.startsWith('Insert ')).slice(0, 3).join(' | ')}`)
    return { doctors_created: doctorsCreated, doctors_existing: doctorsExisting, appointments_blocked: appointmentsBlocked, errors }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error(`[iSalud ingest] FATAL: ${errMsg}`)
    console.error(`[iSalud ingest] STACK: ${stack}`)
    const persisted = await persistSyncError({ clinic_id: clinicId }, errMsg, 'ingest')
    if (persisted) reachedTerminal = true
    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  } finally {
    const durationS = (Date.now() - runStart) / 1000
    console.log(`[iSalud ingest] RUN END at ${new Date().toISOString()}, clinic=${clinicId}, duration=${durationS.toFixed(2)}s, reachedTerminal=${reachedTerminal}`)
    if (!reachedTerminal) {
      console.error(`[iSalud ingest] UNEXPECTED: finally with reachedTerminal=false. Forzando sync_status=error.`)
      await persistSyncError(
        { clinic_id: clinicId },
        'ingest interrupted before reaching terminal state (no error captured by try/catch)',
        'ingest.finally'
      )
    }
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

    // Distinguir cita real (con paciente) vs bloqueo de agenda (slot sin paciente)
    // Real → status='confirmed' (aparece como cita normal en el calendario y en stats)
    // Bloqueo → status='blocked_external' (gris en calendario, no cuenta como cita)
    const patientName = (adm.nombre_paciente ?? '').trim()
    const hasPatient = patientName.length > 1
    const status: 'confirmed' | 'blocked_external' = hasPatient ? 'confirmed' : 'blocked_external'

    if (count < 3) {
      console.log(`[iSalud] Upsert: ${externalId} | ${adm.fecha} ${adm.hora_inicial}-${adm.hora_final} → ${startsAt.toISOString()} - ${endsAt.toISOString()} | "${patientName}" → status=${status}`)
    }

    // Patient name for calendar display
    const reasonText = patientName || 'Bloqueo iSalud'
    const notesText = `[iSalud] ${patientName} | ${adm.procedimiento} | ${adm.aseguradora} | ${adm.profesional_nombre}`

    const { data: ex } = await supabaseAdmin.from('appointments').select('id').eq('clinic_id', clinicId).eq('external_his_id', externalId).maybeSingle()
    if (ex) {
      const { error: updateErr } = await supabaseAdmin.from('appointments').update({
        status, external_data: adm as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(), reason: reasonText, notes: notesText,
      }).eq('id', (ex as { id: string }).id)
      if (updateErr) {
        // Fallback: si el constraint de double-booking bloquea (iSalud permite double-book),
        // dejar como blocked_external para no perder la cita
        if (updateErr.code === '23505' && status === 'confirmed') {
          const { error: retryErr } = await supabaseAdmin.from('appointments').update({
            status: 'blocked_external', external_data: adm as unknown as Record<string, unknown>,
            synced_at: new Date().toISOString(), reason: reasonText, notes: notesText,
          }).eq('id', (ex as { id: string }).id)
          if (retryErr) {
            errors.push(`Update ${externalId}: ${retryErr.message}`)
            continue
          }
          if (count < 3) console.log(`[iSalud] Double-book conflict for ${externalId} → kept as blocked_external`)
        } else {
          if (count < 3) console.error(`[iSalud] Update failed: ${updateErr.message}`)
          errors.push(`Update ${externalId}: ${updateErr.message}`)
          continue
        }
      }
    } else {
      const insertPayload = {
        clinic_id: clinicId, doctor_id: doctorId,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        status, source: 'isalud',
        external_his_id: externalId, external_source: 'isalud',
        external_data: adm as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
        reason: reasonText, notes: notesText,
      }
      const { error: insertErr } = await supabaseAdmin.from('appointments').insert(insertPayload)
      if (insertErr) {
        // Fallback: si choca con otra cita confirmed (iSalud permite double-book),
        // insertar como blocked_external para no perder la cita
        if (insertErr.code === '23505' && status === 'confirmed') {
          const { error: retryErr } = await supabaseAdmin.from('appointments').insert({ ...insertPayload, status: 'blocked_external' })
          if (retryErr) {
            console.error(`[iSalud] INSERT FAILED #${errors.length} (after fallback): ${retryErr.message}`)
            errors.push(`Insert ${externalId}: ${retryErr.message}`)
            continue
          }
          if (count < 3) console.log(`[iSalud] Double-book conflict for ${externalId} → inserted as blocked_external`)
        } else {
          console.error(`[iSalud] INSERT FAILED #${errors.length}: ${insertErr.message} | code=${insertErr.code} | details=${insertErr.details} | hint=${insertErr.hint}`)
          console.error(`[iSalud] Payload: extId=${externalId} starts=${startsAt.toISOString()} doctor=${doctorId} clinic=${clinicId}`)
          errors.push(`Insert ${externalId}: ${insertErr.message}`)
          continue
        }
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
  // Filtrar por external_source para incluir tanto 'confirmed' (citas reales) como 'blocked_external'
  const { data: blocked } = await supabaseAdmin.from('appointments').select('id, external_his_id').eq('clinic_id', clinicId).eq('external_source', 'isalud').in('status', ['confirmed', 'blocked_external']).gte('starts_at', new Date().toISOString())

  const dbCount = blocked?.length ?? 0
  const scrapeCount = currentIds.size
  console.log(`[iSalud] Orphan check: DB has ${dbCount} iSalud-sourced appointments, scrape has ${scrapeCount} IDs`)
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
