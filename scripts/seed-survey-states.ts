// ============================================================
// Seed local — 4 citas facturadas para ver los 4 estados
// de SurveyRow en QuickActions.
//
// Prerequisito: seed-local.ts ya corrió (crea la Clinica de Pruebas +
// test@omuwan.local).
//
// Usage:
//   npx tsx scripts/seed-survey-states.ts        # crea todo
//   npx tsx scripts/seed-survey-states.ts --reset  # resetea survey_sent en las 4 citas
//
// SOLO corre contra DB local (safety check).
// ============================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Cargar .env.local
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
} catch {
  console.error('❌ No se pudo leer .env.local')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const CLINIC_NAME = 'Clinica de Pruebas'
const RESET = process.argv.includes('--reset')

// Fecha base = hoy Bogotá. Las citas se plantan a horas pasadas del día
// para que aparezcan en la vista día al entrar a /dashboard/agenda.
function todayBogota(): Date {
  const now = new Date()
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  bogota.setUTCHours(0, 0, 0, 0)
  return bogota
}

function isoAtBogotaHour(baseDay: Date, h: number, m: number): string {
  return `${baseDay.toISOString().split('T')[0]}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`
}

async function main(): Promise<void> {
  if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
    console.error('❌ Este script solo corre contra DB local. Tu .env.local apunta a:', SUPABASE_URL)
    process.exit(1)
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('🔧 Seed survey states →', SUPABASE_URL)
  console.log('')

  // 1. Localizar la Clínica de Pruebas
  const { data: clinic } = await supa
    .from('clinics')
    .select('id, name')
    .eq('name', CLINIC_NAME)
    .maybeSingle()

  if (!clinic) {
    console.error(`❌ No existe la clínica "${CLINIC_NAME}". Corré primero: npx tsx scripts/seed-local.ts`)
    process.exit(1)
  }
  const clinicId = clinic.id as string
  console.log(`✓ Clínica: ${clinic.name} (${clinicId})`)

  // 2. Feature flag maestro + config de survey
  console.log('')
  console.log('🔧 Configurando feature encuesta post-consulta...')
  await supa
    .from('clinics')
    .update({
      feature_config: { survey_post_consulta_enabled: true },
      whatsapp_config: {
        automations: {
          survey: {
            enabled: true,
            template_name: 'encuesta_satisfaccion',
            form_url: 'https://forms.gle/EJEMPLO-LOCAL-XYZ',
            clinic_display_name: 'Clínica de Pruebas Omuwan',
            guardrail_hours: 48,
            cron_frequency_minutes: 60,
          },
        },
      },
    })
    .eq('id', clinicId)
  console.log(`  ✓ feature_flag ON + form_url + clinic_display_name`)

  // 3. Doctor
  let doctorId: string
  const { data: existingDoc } = await supa
    .from('doctors')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('name', 'Dr. Test Encuesta')
    .maybeSingle()
  if (existingDoc) {
    doctorId = existingDoc.id as string
    console.log(`  ⏭️  Doctor ya existe (${doctorId})`)
  } else {
    const { data: newDoc, error } = await supa
      .from('doctors')
      .insert({
        clinic_id: clinicId,
        name: 'Dr. Test Encuesta',
        specialty: 'Ginecología',
        is_active: true,
        schedule_type: 'fixed',
        agenda_closed: false,
      })
      .select('id')
      .single()
    if (error) { console.error(error); process.exit(1) }
    doctorId = newDoc.id as string
    console.log(`  ✓ Doctor: Dr. Test Encuesta (${doctorId})`)
  }

  // 4. Pacientes
  const patients = [
    { name: 'MARIA GONZALEZ ROMERO', first_name: 'MARIA', phone: '+573101111111', case: 'estado_A' },
    { name: 'SOFIA RODRIGUEZ TORRES', first_name: 'SOFIA', phone: '+573102222222', case: 'estado_B' },
    { name: 'CARLA LOPEZ INVALIDO', first_name: 'CARLA', phone: '+571234567', case: 'estado_C' }, // phone inválido: fijo bogotá
  ]

  const patientIds: Record<string, string> = {}
  for (const p of patients) {
    const { data: exist } = await supa
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('phone', p.phone)
      .maybeSingle()
    if (exist) {
      patientIds[p.case] = exist.id as string
      console.log(`  ⏭️  Paciente ${p.name} ya existe`)
    } else {
      const { data: nw, error } = await supa
        .from('patients')
        .insert({
          clinic_id: clinicId,
          name: p.name,
          first_name: p.first_name,
          phone: p.phone,
          document_type: 'CC',
          document_number: '99' + Date.now().toString().slice(-6),
          data_consent_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (error) { console.error(error); process.exit(1) }
      patientIds[p.case] = nw.id as string
      console.log(`  ✓ Paciente: ${p.name} → ${p.case}`)
    }
  }

  // 5. Citas
  const baseDay = todayBogota()
  const cases = [
    { case: 'estado_A', hour: 9, patientKey: 'estado_A', survey_sent: true, sent_hours_ago: 2 },
    { case: 'estado_B', hour: 10, patientKey: 'estado_B', survey_sent: false, sent_hours_ago: 0 },
    { case: 'estado_C', hour: 11, patientKey: 'estado_C', survey_sent: false, sent_hours_ago: 0 },
  ]

  for (const c of cases) {
    const patientId = patientIds[c.patientKey]
    const startsAt = isoAtBogotaHour(baseDay, c.hour, 0)
    const endsAt = isoAtBogotaHour(baseDay, c.hour, 30)

    // Idempotente: buscar por clinic + patient + starts_at
    const { data: exist } = await supa
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('starts_at', startsAt)
      .maybeSingle()

    const surveyPayload: {
      survey_sent: boolean
      survey_sent_at: string | null
    } = {
      survey_sent: RESET ? false : c.survey_sent,
      survey_sent_at: RESET
        ? null
        : c.survey_sent
          ? new Date(Date.now() - c.sent_hours_ago * 60 * 60 * 1000).toISOString()
          : null,
    }

    if (exist) {
      await supa
        .from('appointments')
        .update({
          status: 'confirmed',
          attendance_outcome: 'facturado',
          ...surveyPayload,
        })
        .eq('id', exist.id as string)
      console.log(`  ✓ Cita ${c.case} actualizada (${(exist.id as string).slice(0, 8)})`)
    } else {
      await supa.from('appointments').insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        patient_id: patientId,
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'confirmed',
        source: 'manual',
        reason: `Cita de prueba (${c.case})`,
        attendance_outcome: 'facturado',
        ...surveyPayload,
      })
      console.log(`  ✓ Cita ${c.case} creada @ ${c.hour}:00`)
    }
  }

  if (RESET) {
    console.log('\n🔄 RESET: survey_sent=false para las 3 citas.')
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('✓ Seed completado')
  console.log('')
  console.log('URL:    http://localhost:3000/dashboard/agenda')
  console.log('Login:  test@omuwan.local / test123456')
  console.log('')
  console.log('En la vista DÍA de hoy vas a ver 3 citas facturadas:')
  console.log('  09:00  MARIA GONZALEZ   → Estado A (verde, "Encuesta enviada")')
  console.log('  10:00  SOFIA RODRIGUEZ  → Estado B (amarillo, botón "Enviar por WhatsApp")')
  console.log('  11:00  CARLA LOPEZ      → Estado C (gris, "Sin teléfono válido")')
  console.log('')
  console.log('Para ver Estado D (config incompleta):')
  console.log('  Andá a /dashboard/settings/automations/survey')
  console.log('  Borrá el campo "URL del formulario" y guardá.')
  console.log('  Volvé a la agenda: las 3 citas van a mostrar Estado D.')
  console.log('  Para restaurar, poné cualquier URL válida y guardá.')
  console.log('')
  console.log('Para re-testear el flujo click → confirmar (Estado B → A):')
  console.log('  npx tsx scripts/seed-survey-states.ts --reset')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
