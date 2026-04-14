// ============================================================
// iSalud Sync Agent
//
// importISalud()  — Flujo inicial: login + médicos + citas
// syncOrganization() — Cron sync: solo actualiza citas
// syncAllISaludIntegrations() — Cron runner para todas las orgs
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { scrapeISalud, type ISaludCredentials, type ISaludProfesional, type ISaludAdmision } from './adapter'

// --- Types ---

export interface ImportResult {
  doctors_created: number
  doctors_existing: number
  appointments_blocked: number
  errors: string[]
}

export interface SyncReport {
  inserted: number
  updated: number
  cancelled: number
  unmapped_professionals: string[]
  errors: string[]
  duration_ms: number
}

// --- Import (initial setup) ---

export async function importISalud(
  credentials: ISaludCredentials,
  clinicId: string
): Promise<ImportResult> {
  const errors: string[] = []

  // 1. Save credentials to sync_integrations
  await supabaseAdmin
    .from('sync_integrations')
    .upsert({
      clinic_id: clinicId,
      provider: 'isalud',
      credentials: {
        subdomain: credentials.subdomain,
        email: credentials.email,
        password: credentials.password,
      } as unknown as Record<string, unknown>,
      sync_status: 'running',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clinic_id,provider' })

  try {
    // 2. Scrape iSalud
    const result = await scrapeISalud(credentials, { diasAdelante: 60 })
    errors.push(...result.errors)

    // 3. Process professionals → doctors + mappings
    let doctorsCreated = 0
    let doctorsExisting = 0

    for (const prof of result.profesionales) {
      const mapped = await getOrCreateDoctor(clinicId, prof)
      if (mapped.created) doctorsCreated++
      else doctorsExisting++
    }

    // 4. Process admisiones → blocked appointments
    const appointmentsBlocked = await upsertBlockedAppointments(
      clinicId, result.admisiones, errors
    )

    // 5. Update sync status
    await supabaseAdmin
      .from('sync_integrations')
      .update({
        sync_status: 'idle',
        last_synced_at: new Date().toISOString(),
        sync_error: errors.length > 0 ? errors.join('; ') : null,
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')

    return {
      doctors_created: doctorsCreated,
      doctors_existing: doctorsExisting,
      appointments_blocked: appointmentsBlocked,
      errors,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('sync_integrations')
      .update({
        sync_status: 'error',
        sync_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')

    return { doctors_created: 0, doctors_existing: 0, appointments_blocked: 0, errors: [errMsg] }
  }
}

// --- Sync (cron — only appointments) ---

export async function syncOrganization(integration: {
  id: string
  clinic_id: string
  credentials: Record<string, unknown>
  config: { dias_adelante?: number }
}): Promise<SyncReport> {
  const start = Date.now()
  const errors: string[] = []
  const creds: ISaludCredentials = {
    subdomain: integration.credentials.subdomain as string,
    email: integration.credentials.email as string,
    password: integration.credentials.password as string,
  }
  const dias = integration.config.dias_adelante ?? 60

  // Mark as running
  await supabaseAdmin
    .from('sync_integrations')
    .update({ sync_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', integration.id)

  try {
    const result = await scrapeISalud(creds, { diasAdelante: dias })
    errors.push(...result.errors)

    // Upsert appointments
    const blocked = await upsertBlockedAppointments(
      integration.clinic_id, result.admisiones, errors
    )

    // Orphan cleanup: blocked_external that are no longer in iSalud → cancel
    const cancelled = await cleanupOrphans(integration.clinic_id, result.admisiones)

    // Find unmapped professionals
    const { data: mappings } = await supabaseAdmin
      .from('doctor_external_mappings')
      .select('external_name')
      .eq('clinic_id', integration.clinic_id)
      .eq('provider', 'isalud')

    const mappedNames = new Set((mappings ?? []).map((m) => (m as { external_name: string }).external_name))
    const admisionNames = new Set(result.admisiones.map((a) => a.profesional_nombre))
    const unmapped = Array.from(admisionNames).filter((n) => !mappedNames.has(n))

    // Update status
    await supabaseAdmin
      .from('sync_integrations')
      .update({
        sync_status: 'idle',
        last_synced_at: new Date().toISOString(),
        sync_error: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

    return {
      inserted: blocked,
      updated: 0,
      cancelled,
      unmapped_professionals: unmapped,
      errors,
      duration_ms: Date.now() - start,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('sync_integrations')
      .update({
        sync_status: 'error',
        sync_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

    return {
      inserted: 0, updated: 0, cancelled: 0,
      unmapped_professionals: [],
      errors: [errMsg],
      duration_ms: Date.now() - start,
    }
  }
}

// --- Sync all integrations (cron runner) ---

export async function syncAllISaludIntegrations(): Promise<{
  synced: number
  errors: string[]
}> {
  const { data: integrations } = await supabaseAdmin
    .from('sync_integrations')
    .select('id, clinic_id, credentials, config')
    .eq('provider', 'isalud')
    .neq('sync_status', 'running')

  if (!integrations || integrations.length === 0) {
    return { synced: 0, errors: [] }
  }

  let synced = 0
  const errors: string[] = []

  for (const raw of integrations) {
    const integration = raw as {
      id: string
      clinic_id: string
      credentials: Record<string, unknown>
      config: { dias_adelante?: number }
    }

    try {
      const report = await syncOrganization(integration)
      synced++
      if (report.errors.length > 0) {
        errors.push(`Clinic ${integration.clinic_id}: ${report.errors[0]}`)
      }
      console.log(
        `[iSalud Sync] Clinic ${integration.clinic_id}: ` +
        `+${report.inserted} blocked, -${report.cancelled} cancelled, ` +
        `${report.unmapped_professionals.length} unmapped, ${report.duration_ms}ms`
      )
    } catch (err) {
      errors.push(`Clinic ${integration.clinic_id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { synced, errors }
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
    return { doctorId: (existing as { doctor_id: string }).doctor_id, created: false }
  }

  // Try to match by name (fuzzy — uppercase comparison)
  const { data: doctorByName } = await supabaseAdmin
    .from('doctors')
    .select('id')
    .eq('clinic_id', clinicId)
    .ilike('name', prof.nombre)
    .maybeSingle()

  let doctorId: string

  if (doctorByName) {
    doctorId = (doctorByName as { id: string }).id
  } else {
    // Create new doctor
    const { data: newDoctor } = await supabaseAdmin
      .from('doctors')
      .insert({
        clinic_id: clinicId,
        name: prof.nombre,
        specialty: null,
        is_active: true,
      })
      .select('id')
      .single()

    if (!newDoctor) throw new Error(`Failed to create doctor: ${prof.nombre}`)
    doctorId = (newDoctor as { id: string }).id
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

  return { doctorId, created: !doctorByName }
}

async function upsertBlockedAppointments(
  clinicId: string,
  admisiones: ISaludAdmision[],
  errors: string[]
): Promise<number> {
  let count = 0

  for (const adm of admisiones) {
    // Find doctor mapping
    const { data: mapping } = await supabaseAdmin
      .from('doctor_external_mappings')
      .select('doctor_id')
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')
      .eq('external_name', adm.profesional_nombre)
      .maybeSingle()

    if (!mapping) {
      // Create mapping on-the-fly if missing
      const result = await getOrCreateDoctor(clinicId, {
        nombre: adm.profesional_nombre,
        puntos_atencion: [adm.ubicacion],
      })
      if (!result.doctorId) {
        errors.push(`No mapping for: ${adm.profesional_nombre}`)
        continue
      }
    }

    const doctorId = mapping
      ? (mapping as { doctor_id: string }).doctor_id
      : (await supabaseAdmin
          .from('doctor_external_mappings')
          .select('doctor_id')
          .eq('clinic_id', clinicId)
          .eq('provider', 'isalud')
          .eq('external_name', adm.profesional_nombre)
          .single()
          .then((r) => (r.data as { doctor_id: string } | null)?.doctor_id))

    if (!doctorId) continue

    // Build timestamps — assume 30min duration
    const [hours, minutes] = adm.hora_inicial.split(':').map(Number)
    const startsAt = new Date(`${adm.fecha}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`)
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)

    const externalId = `isalud-${adm.id}-${adm.fecha}`

    // Upsert: use external_his_id as unique key
    const { error: upsertErr } = await supabaseAdmin
      .from('appointments')
      .upsert({
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
      }, { onConflict: 'external_his_id' })

    if (upsertErr) {
      // If upsert fails (no unique constraint on external_his_id), try insert with check
      const { data: existingAppt } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('external_his_id', externalId)
        .maybeSingle()

      if (existingAppt) {
        // Update existing
        await supabaseAdmin
          .from('appointments')
          .update({
            status: 'blocked_external',
            external_data: adm as unknown as Record<string, unknown>,
            synced_at: new Date().toISOString(),
          })
          .eq('id', (existingAppt as { id: string }).id)
      } else {
        // Insert new
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
    }

    count++
  }

  return count
}

async function cleanupOrphans(
  clinicId: string,
  currentAdmisiones: ISaludAdmision[]
): Promise<number> {
  // Get all current external IDs from scrape
  const currentIds = new Set(currentAdmisiones.map((a) => `isalud-${a.id}-${a.fecha}`))

  // Get all future blocked_external appointments from this clinic
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
