// ============================================================
// iSalud Sync Agent — DB operations only (no browser)
//
// ingestISaludData() — Processes scraped data from GitHub Actions
// importISalud()     — Saves credentials + triggers via GitHub dispatch
//
// Scraping happens in scripts/isalud-scraper.ts (GitHub Actions)
// This file only does database operations.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

// --- Types ---

interface ISaludDisponibilidadSlot {
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  fecha: string
}

interface ISaludProfesional {
  nombre: string
  puntos_atencion: string[]
  slots: ISaludDisponibilidadSlot[]
}

interface ISaludAdmision {
  id: string
  identificacion: string
  nombre_paciente: string
  procedimiento: string
  aseguradora: string
  profesional_nombre: string
  ubicacion: string
  hora_inicial: string
  fase: string
  fecha: string
}

export interface ImportResult {
  doctors_created: number
  doctors_existing: number
  appointments_blocked: number
  errors: string[]
}

// --- Ingest (called by /api/sync/isalud/ingest from GitHub Actions) ---

export async function ingestISaludData(
  clinicId: string,
  profesionales: ISaludProfesional[],
  admisiones: ISaludAdmision[]
): Promise<ImportResult> {
  const errors: string[] = []
  let doctorsCreated = 0
  let doctorsExisting = 0

  // Update sync status to running
  await supabaseAdmin
    .from('sync_integrations')
    .update({ sync_status: 'running', updated_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .eq('provider', 'isalud')

  try {
    // 1. Process professionals → doctors + mappings
    for (const prof of profesionales) {
      const mapped = await getOrCreateDoctor(clinicId, prof)
      if (mapped.created) doctorsCreated++
      else doctorsExisting++
    }

    // 2. Process admisiones → blocked appointments
    const appointmentsBlocked = await upsertBlockedAppointments(clinicId, admisiones, errors)

    // 3. Cleanup orphans
    const cancelled = await cleanupOrphans(clinicId, admisiones)

    // 4. Update sync status
    await supabaseAdmin
      .from('sync_integrations')
      .update({
        sync_status: 'idle',
        last_synced_at: new Date().toISOString(),
        sync_error: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')

    console.log(`[iSalud Ingest] Clinic ${clinicId}: +${doctorsCreated} docs, ${doctorsExisting} existing, ${appointmentsBlocked} blocked, ${cancelled} cancelled`)

    return { doctors_created: doctorsCreated, doctors_existing: doctorsExisting, appointments_blocked: appointmentsBlocked, errors }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('sync_integrations')
      .update({ sync_status: 'error', sync_error: errMsg, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')

    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  }
}

// --- Save credentials (from dashboard import modal) ---

export async function saveISaludCredentials(
  clinicId: string,
  credentials: { subdomain: string; username: string; password: string }
): Promise<void> {
  await supabaseAdmin
    .from('sync_integrations')
    .upsert({
      clinic_id: clinicId,
      provider: 'isalud',
      credentials: credentials as unknown as Record<string, unknown>,
      sync_status: 'idle',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clinic_id,provider' })
}

// --- Trigger GitHub Actions workflow ---

export async function triggerGitHubSync(): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = process.env.GITHUB_REPO ?? 'jlondonoechavarria-source/agentes-medicos'

  if (!token) {
    return { ok: false, error: 'GITHUB_DISPATCH_TOKEN not configured' }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'isalud-sync' }),
    })

    if (res.ok || res.status === 204) {
      return { ok: true }
    }
    return { ok: false, error: `GitHub API: ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de red' }
  }
}

// --- Helpers ---

async function getOrCreateDoctor(
  clinicId: string,
  prof: ISaludProfesional
): Promise<{ doctorId: string; created: boolean }> {
  // Check if mapping already exists
  const { data: existing } = await supabaseAdmin
    .from('doctor_external_mappings')
    .select('doctor_id')
    .eq('clinic_id', clinicId)
    .eq('provider', 'isalud')
    .eq('external_name', prof.nombre)
    .maybeSingle()

  if (existing) {
    const doctorId = (existing as { doctor_id: string }).doctor_id

    // Update working_hours if null
    const { data: doc } = await supabaseAdmin
      .from('doctors')
      .select('working_hours')
      .eq('id', doctorId)
      .maybeSingle()

    if (doc && !(doc as { working_hours: unknown }).working_hours && prof.slots.length > 0) {
      const workingHours = buildWorkingHours(prof.slots)
      await supabaseAdmin
        .from('doctors')
        .update({ working_hours: workingHours as unknown as Record<string, unknown> })
        .eq('id', doctorId)
    }

    return { doctorId, created: false }
  }

  const workingHours = buildWorkingHours(prof.slots)

  // Try to match by name
  const { data: doctorByName } = await supabaseAdmin
    .from('doctors')
    .select('id, working_hours')
    .eq('clinic_id', clinicId)
    .ilike('name', prof.nombre)
    .maybeSingle()

  let doctorId: string
  let created = false

  if (doctorByName) {
    doctorId = (doctorByName as { id: string }).id
    if (!(doctorByName as { working_hours: unknown }).working_hours) {
      await supabaseAdmin
        .from('doctors')
        .update({ working_hours: workingHours as unknown as Record<string, unknown> })
        .eq('id', doctorId)
    }
  } else {
    const { data: newDoctor } = await supabaseAdmin
      .from('doctors')
      .insert({
        clinic_id: clinicId,
        name: prof.nombre,
        specialty: null,
        is_active: true,
        schedule_type: 'fixed',
        agenda_closed: false,
        working_hours: workingHours as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (!newDoctor) throw new Error(`Failed to create doctor: ${prof.nombre}`)
    doctorId = (newDoctor as { id: string }).id
    created = true
  }

  // Create mapping
  await supabaseAdmin
    .from('doctor_external_mappings')
    .insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      provider: 'isalud',
      external_name: prof.nombre,
      external_metadata: { puntos_atencion: prof.puntos_atencion } as unknown as Record<string, unknown>,
    })

  return { doctorId, created }
}

function buildWorkingHours(slots: ISaludDisponibilidadSlot[]): Record<string, { start: string; end: string; active: boolean }> {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const result: Record<string, { start: string; end: string; active: boolean }> = {}

  for (const day of dayNames) {
    result[day] = { start: '00:00', end: '00:00', active: false }
  }

  if (slots.length === 0) {
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
      result[day] = { start: '08:00', end: '18:00', active: true }
    }
    return result
  }

  const byDay = new Map<number, { starts: string[]; ends: string[] }>()
  for (const slot of slots) {
    if (!byDay.has(slot.dia_semana)) byDay.set(slot.dia_semana, { starts: [], ends: [] })
    const entry = byDay.get(slot.dia_semana)!
    if (slot.hora_inicio) entry.starts.push(slot.hora_inicio)
    if (slot.hora_fin) entry.ends.push(slot.hora_fin)
  }

  for (const [dayNum, { starts, ends }] of byDay) {
    const dayName = dayNames[dayNum]
    if (!dayName) continue
    result[dayName] = {
      start: starts.sort()[0] ?? '08:00',
      end: ends.sort().reverse()[0] ?? '18:00',
      active: true,
    }
  }

  return result
}

async function upsertBlockedAppointments(
  clinicId: string,
  admisiones: ISaludAdmision[],
  errors: string[]
): Promise<number> {
  let count = 0

  for (const adm of admisiones) {
    // Find or create doctor mapping
    let mapping = await supabaseAdmin
      .from('doctor_external_mappings')
      .select('doctor_id')
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')
      .eq('external_name', adm.profesional_nombre)
      .maybeSingle()

    if (!mapping.data) {
      await getOrCreateDoctor(clinicId, { nombre: adm.profesional_nombre, puntos_atencion: [adm.ubicacion], slots: [] })
      mapping = await supabaseAdmin
        .from('doctor_external_mappings')
        .select('doctor_id')
        .eq('clinic_id', clinicId)
        .eq('provider', 'isalud')
        .eq('external_name', adm.profesional_nombre)
        .maybeSingle()
    }

    const doctorId = (mapping.data as { doctor_id: string } | null)?.doctor_id
    if (!doctorId) { errors.push(`No mapping: ${adm.profesional_nombre}`); continue }

    const [hours, minutes] = adm.hora_inicial.split(':').map(Number)
    const startsAt = new Date(`${adm.fecha}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`)
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)
    const externalId = `isalud-${adm.id}-${adm.fecha}`

    // Check if exists
    const { data: existingAppt } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('external_his_id', externalId)
      .maybeSingle()

    if (existingAppt) {
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'blocked_external', external_data: adm as unknown as Record<string, unknown>, synced_at: new Date().toISOString() })
        .eq('id', (existingAppt as { id: string }).id)
    } else {
      await supabaseAdmin
        .from('appointments')
        .insert({
          clinic_id: clinicId,
          doctor_id: doctorId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: 'blocked_external',
          source: 'isalud',
          external_his_id: externalId,
          external_source: 'isalud',
          external_data: adm as unknown as Record<string, unknown>,
          synced_at: new Date().toISOString(),
          reason: `${adm.procedimiento} — ${adm.nombre_paciente}`,
        })
    }
    count++
  }

  return count
}

async function cleanupOrphans(clinicId: string, currentAdmisiones: ISaludAdmision[]): Promise<number> {
  const currentIds = new Set(currentAdmisiones.map((a) => `isalud-${a.id}-${a.fecha}`))

  const { data: blocked } = await supabaseAdmin
    .from('appointments')
    .select('id, external_his_id')
    .eq('clinic_id', clinicId)
    .eq('status', 'blocked_external')
    .eq('external_source', 'isalud')
    .gte('starts_at', new Date().toISOString())

  if (!blocked) return 0

  let cancelled = 0
  for (const appt of blocked) {
    const extId = (appt as { id: string; external_his_id: string | null }).external_his_id
    if (extId && !currentIds.has(extId)) {
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled', cancellation_reason: 'isalud_sync_orphan' })
        .eq('id', (appt as { id: string }).id)
      cancelled++
    }
  }

  return cancelled
}
