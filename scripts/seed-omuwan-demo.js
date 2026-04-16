#!/usr/bin/env node

// ============================================================
// SEED OMUWAN DEMO — Clínica ficticia para video de ventas
// 100% ADITIVO: solo INSERT con ON CONFLICT DO NOTHING
// Uso: node scripts/seed-omuwan-demo.js
// ============================================================

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')

// --- Cargar .env.local ---
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i)] = t.slice(i + 1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DEMO_USER_UUID = '6bd69bcd-4276-4555-aeb2-7d33768cceea'
const CLINIC_ID = 'a1b2c3d4-0000-0000-0000-000000000001'
const ROLE_ID = 'd1b2c3d4-0000-0000-0000-000000000001'
const DR_ANA = 'b1b2c3d4-0000-0000-0000-000000000001'
const DR_CARLOS = 'b1b2c3d4-0000-0000-0000-000000000002'
const DR_VALENTINA = 'b1b2c3d4-0000-0000-0000-000000000003'

// --- Helpers ---
function hoursAgo(h, m = 0) {
  const d = new Date()
  d.setTime(d.getTime() - (h * 60 + m) * 60 * 1000)
  return d.toISOString()
}
function hoursAhead(h, m = 0) {
  const d = new Date()
  d.setTime(d.getTime() + (h * 60 + m) * 60 * 1000)
  return d.toISOString()
}
function pad(n) { return String(n).padStart(12, '0') }
function patientId(n) { return `c0000001-0000-0000-0000-${pad(n)}` }

async function countBefore() {
  const tables = ['clinics', 'doctors', 'appointments', 'patients']
  const before = {}
  for (const t of tables) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
    before[t] = count
  }
  return before
}

async function main() {
  console.log('=== OMUWAN DEMO SEED ===\n')

  console.log('Conteos ANTES:')
  const before = await countBefore()
  console.log(before, '\n')

  // 1. CLINIC
  console.log('1/7 Insertando clínica demo...')
  {
    const { error } = await supabase.from('clinics').upsert({
      id: CLINIC_ID,
      name: 'Consultorio Médico Demo',
      slug: 'demo',
      phone: '+573001234567',
      city: 'Pereira',
      department: 'Risaralda',
      address: 'Calle 19 # 6-48, Centro, Pereira',
      specialty: ['Medicina General', 'Ginecología', 'Pediatría'],
      agent_name: 'Sofía',
      agent_personality: 'profesional, cálida y eficiente',
      welcome_message: 'Hola 👋 Soy Sofía, asistente virtual del Consultorio Médico Demo. ¿En qué te puedo ayudar hoy?',
      consultation_price: 80000,
      consultation_duration_minutes: 30,
      subscription_status: 'active',
      subscription_plan: 'professional',
      trial_ends_at: hoursAhead(24 * 30),
      whatsapp_connected: true,
      onboarded_at: hoursAgo(24 * 15),
      feature_config: { agent: true, virtual: true, insights: true, waitlist: true, dashboard: true, reactivation: true, docs_required: false, reminders_24h: true, reminders_72h: true },
      notification_settings: { reminder_2h: true, noshow_alert: true, reminder_24h: true, morning_report: true, morning_report_hour: '07:00', overdue_billing_days: 30, overdue_billing_alert: true, noshow_alert_threshold: 25 },
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) { console.error('  ✗', error.message); process.exit(1) }
    console.log('  ✓')
  }

  // 2. CLINIC SETUP PROGRESS
  console.log('2/7 Setup progress...')
  {
    const { error } = await supabase.from('clinic_setup_progress').upsert({
      clinic_id: CLINIC_ID,
      clinic_data_complete: true,
      doctors_added: true,
      consultation_types_added: true,
      whatsapp_connected: true,
      team_invited: true,
      completed_at: hoursAgo(24 * 10),
    }, { onConflict: 'clinic_id', ignoreDuplicates: true })
    if (error) { console.error('  ✗', error.message); process.exit(1) }
    console.log('  ✓')
  }

  // 3. DOCTORS
  console.log('3/7 Insertando 3 doctores...')
  {
    const doctors = [
      {
        id: DR_ANA, clinic_id: CLINIC_ID,
        name: 'Dra. Ana María Ríos', specialty: 'Medicina General',
        email: 'ana.rios@demo.co', phone: '+573111111111', is_active: true,
        working_hours: {
          monday: { active: true, start: '08:00', end: '17:00' },
          tuesday: { active: true, start: '08:00', end: '17:00' },
          wednesday: { active: true, start: '08:00', end: '17:00' },
          thursday: { active: true, start: '08:00', end: '17:00' },
          friday: { active: true, start: '08:00', end: '16:00' },
          saturday: { active: false }, sunday: { active: false },
        },
      },
      {
        id: DR_CARLOS, clinic_id: CLINIC_ID,
        name: 'Dr. Carlos Mejía', specialty: 'Ginecología',
        email: 'carlos.mejia@demo.co', phone: '+573222222222', is_active: true,
        working_hours: {
          monday: { active: true, start: '07:00', end: '13:00' },
          tuesday: { active: true, start: '07:00', end: '13:00' },
          wednesday: { active: false },
          thursday: { active: true, start: '07:00', end: '13:00' },
          friday: { active: true, start: '07:00', end: '13:00' },
          saturday: { active: true, start: '08:00', end: '12:00' },
          sunday: { active: false },
        },
      },
      {
        id: DR_VALENTINA, clinic_id: CLINIC_ID,
        name: 'Dra. Valentina Torres', specialty: 'Pediatría',
        email: 'valentina.torres@demo.co', phone: '+573333333333', is_active: true,
        working_hours: {
          monday: { active: true, start: '09:00', end: '18:00' },
          tuesday: { active: true, start: '09:00', end: '18:00' },
          wednesday: { active: true, start: '09:00', end: '18:00' },
          thursday: { active: true, start: '09:00', end: '18:00' },
          friday: { active: true, start: '09:00', end: '17:00' },
          saturday: { active: false }, sunday: { active: false },
        },
      },
    ]
    const { error } = await supabase.from('doctors').upsert(doctors, { onConflict: 'id', ignoreDuplicates: true })
    if (error) { console.error('  ✗', error.message); process.exit(1) }
    console.log('  ✓ 3 doctores')
  }

  // 4. CONSULTATION TYPES
  console.log('4/7 Tipos de consulta...')
  {
    const types = [
      { clinic_id: CLINIC_ID, doctor_id: DR_ANA, name: 'Consulta General', duration_minutes: 30, price: 80000, bookable_via_whatsapp: true, modality: 'presencial' },
      { clinic_id: CLINIC_ID, doctor_id: DR_ANA, name: 'Control de Hipertensión', duration_minutes: 20, price: 60000, bookable_via_whatsapp: true, modality: 'presencial' },
      { clinic_id: CLINIC_ID, doctor_id: DR_CARLOS, name: 'Consulta Ginecológica', duration_minutes: 40, price: 120000, bookable_via_whatsapp: true, modality: 'presencial' },
      { clinic_id: CLINIC_ID, doctor_id: DR_CARLOS, name: 'Control Prenatal', duration_minutes: 30, price: 100000, bookable_via_whatsapp: true, modality: 'presencial' },
      { clinic_id: CLINIC_ID, doctor_id: DR_VALENTINA, name: 'Consulta Pediátrica', duration_minutes: 30, price: 90000, bookable_via_whatsapp: true, modality: 'presencial' },
      { clinic_id: CLINIC_ID, doctor_id: DR_VALENTINA, name: 'Vacunación', duration_minutes: 15, price: 0, bookable_via_whatsapp: true, modality: 'presencial' },
    ]
    const { error } = await supabase.from('consultation_types').insert(types)
    if (error && !error.message.includes('duplicate')) {
      console.error('  ✗', error.message); process.exit(1)
    }
    console.log('  ✓ 6 tipos')
  }

  // 5. PATIENTS
  console.log('5/7 Pacientes (15)...')
  {
    const patients = [
      { id: patientId(1), name: 'Laura Gómez Restrepo', phone: '+573151111111', document_number: '1090123456', eps: 'Sura', total_appointments: 6, no_show_count: 0 },
      { id: patientId(2), name: 'Andrés Felipe Salazar', phone: '+573152222222', document_number: '1090234567', eps: 'Particular', total_appointments: 4, no_show_count: 1 },
      { id: patientId(3), name: 'María Isabela Zuluaga', phone: '+573153333333', document_number: '1090345678', eps: 'Coomeva', total_appointments: 3, no_show_count: 0 },
      { id: patientId(4), name: 'Jorge Esteban Cardona', phone: '+573154444444', document_number: '1090456789', eps: 'Nuevo Horizonte', total_appointments: 2, no_show_count: 0 },
      { id: patientId(5), name: 'Sofía Valentina Muñoz', phone: '+573155555555', document_number: '1090567890', eps: 'Particular', total_appointments: 5, no_show_count: 1 },
      { id: patientId(6), name: 'Ricardo Hernández Lagos', phone: '+573156666666', document_number: '1090678901', eps: 'Sura', total_appointments: 2, no_show_count: 0 },
      { id: patientId(7), name: 'Diana Carolina Ospina', phone: '+573157777777', document_number: '1090789012', eps: 'Coomeva', total_appointments: 7, no_show_count: 0 },
      { id: patientId(8), name: 'Miguel Ángel Betancur', phone: '+573158888888', document_number: '1090890123', eps: 'Particular', total_appointments: 1, no_show_count: 0 },
      { id: patientId(9), name: 'Natalia Ríos Castaño', phone: '+573159999999', document_number: '1090901234', eps: 'Sura', total_appointments: 4, no_show_count: 0 },
      { id: patientId(10), name: 'Camila Arbeláez Pérez', phone: '+573160000000', document_number: '1091012345', eps: 'Nueva EPS', total_appointments: 3, no_show_count: 1 },
      { id: patientId(11), name: 'Felipe Londoño Torres', phone: '+573161111111', document_number: '1091123456', eps: 'Particular', total_appointments: 2, no_show_count: 0 },
      { id: patientId(12), name: 'Valentina Echeverry Gil', phone: '+573162222222', document_number: '1091234567', eps: 'Coomeva', total_appointments: 4, no_show_count: 0 },
      { id: patientId(13), name: 'Santiago Morales Vera', phone: '+573163333333', document_number: '1091345678', eps: 'Sura', total_appointments: 1, no_show_count: 0 },
      { id: patientId(14), name: 'Isabella Ramírez Cano', phone: '+573164444444', document_number: '1091456789', eps: 'Particular', total_appointments: 3, no_show_count: 0 },
      { id: patientId(15), name: 'Tomás Aguirre Soto', phone: '+573165555555', document_number: '1091567890', eps: 'Famisanar', total_appointments: 2, no_show_count: 0 },
    ].map(p => ({ ...p, clinic_id: CLINIC_ID }))
    const { error } = await supabase.from('patients').upsert(patients, { onConflict: 'id', ignoreDuplicates: true })
    if (error) { console.error('  ✗', error.message); process.exit(1) }
    console.log('  ✓ 15 pacientes')
  }

  // 6. APPOINTMENTS
  console.log('6/7 Citas (pasadas + hoy + próximas)...')
  {
    const appts = [
      // Semana pasada (completadas)
      { doctor_id: DR_ANA, patient_id: patientId(1), starts_at: hoursAgo(7 * 24 + 16), ends_at: hoursAgo(7 * 24 + 15, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pagada' },
      { doctor_id: DR_ANA, patient_id: patientId(2), starts_at: hoursAgo(7 * 24 + 15), ends_at: hoursAgo(7 * 24 + 14, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pagada' },
      { doctor_id: DR_CARLOS, patient_id: patientId(3), starts_at: hoursAgo(7 * 24 + 17), ends_at: hoursAgo(7 * 24 + 16, 20), status: 'completed', source: 'whatsapp_agent', payment_type: 'Sura', clinic_value: 120000, invoice_status: 'pagada' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(4), starts_at: hoursAgo(7 * 24 + 15), ends_at: hoursAgo(7 * 24 + 14, 30), status: 'completed', source: 'dashboard', payment_type: 'Coomeva', clinic_value: 90000, invoice_status: 'pagada' },
      { doctor_id: DR_ANA, patient_id: patientId(5), starts_at: hoursAgo(6 * 24 + 14), ends_at: hoursAgo(6 * 24 + 13, 30), status: 'no_show', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_CARLOS, patient_id: patientId(6), starts_at: hoursAgo(6 * 24 + 16), ends_at: hoursAgo(6 * 24 + 15, 20), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 120000, invoice_status: 'pagada' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(7), starts_at: hoursAgo(5 * 24 + 15), ends_at: hoursAgo(5 * 24 + 14, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Sura', clinic_value: 90000, invoice_status: 'pagada' },
      { doctor_id: DR_ANA, patient_id: patientId(8), starts_at: hoursAgo(5 * 24 + 13), ends_at: hoursAgo(5 * 24 + 12, 30), status: 'completed', source: 'dashboard', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pagada' },
      { doctor_id: DR_CARLOS, patient_id: patientId(9), starts_at: hoursAgo(4 * 24 + 17), ends_at: hoursAgo(4 * 24 + 16, 20), status: 'completed', source: 'whatsapp_agent', payment_type: 'Coomeva', clinic_value: 120000, invoice_status: 'en_tramite' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(10), starts_at: hoursAgo(4 * 24 + 14), ends_at: hoursAgo(4 * 24 + 13, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Nueva EPS', clinic_value: 90000, invoice_status: 'en_tramite' },
      { doctor_id: DR_ANA, patient_id: patientId(11), starts_at: hoursAgo(3 * 24 + 16), ends_at: hoursAgo(3 * 24 + 15, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pagada' },
      { doctor_id: DR_ANA, patient_id: patientId(12), starts_at: hoursAgo(3 * 24 + 14, 30), ends_at: hoursAgo(3 * 24 + 14), status: 'completed', source: 'dashboard', payment_type: 'Sura', clinic_value: 80000, invoice_status: 'pagada' },
      { doctor_id: DR_CARLOS, patient_id: patientId(13), starts_at: hoursAgo(2 * 24 + 17), ends_at: hoursAgo(2 * 24 + 16, 20), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 120000, invoice_status: 'pagada' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(14), starts_at: hoursAgo(2 * 24 + 15), ends_at: hoursAgo(2 * 24 + 14, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 90000, invoice_status: 'pagada' },
      { doctor_id: DR_ANA, patient_id: patientId(15), starts_at: hoursAgo(1 * 24 + 14), ends_at: hoursAgo(1 * 24 + 13, 30), status: 'completed', source: 'whatsapp_agent', payment_type: 'Famisanar', clinic_value: 80000, invoice_status: 'en_tramite' },
      // Hoy próximas horas
      { doctor_id: DR_ANA, patient_id: patientId(1), starts_at: hoursAhead(1), ends_at: hoursAhead(1, 30), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_CARLOS, patient_id: patientId(7), starts_at: hoursAhead(2), ends_at: hoursAhead(2, 40), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Sura', clinic_value: 120000, invoice_status: 'pendiente' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(2), starts_at: hoursAhead(3), ends_at: hoursAhead(3, 30), status: 'confirmed', source: 'dashboard', payment_type: 'Particular', clinic_value: 90000, invoice_status: 'pendiente' },
      // Próximos 5 días
      { doctor_id: DR_ANA, patient_id: patientId(3), starts_at: hoursAhead(1 * 24 + 12, 30), ends_at: hoursAhead(1 * 24 + 13), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Coomeva', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_CARLOS, patient_id: patientId(4), starts_at: hoursAhead(1 * 24 + 11), ends_at: hoursAhead(1 * 24 + 11, 40), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Nuevo Horizonte', clinic_value: 120000, invoice_status: 'pendiente' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(5), starts_at: hoursAhead(1 * 24 + 13), ends_at: hoursAhead(1 * 24 + 13, 30), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 90000, invoice_status: 'pendiente' },
      { doctor_id: DR_ANA, patient_id: patientId(6), starts_at: hoursAhead(2 * 24 + 14), ends_at: hoursAhead(2 * 24 + 14, 30), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Sura', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_CARLOS, patient_id: patientId(8), starts_at: hoursAhead(2 * 24 + 11, 40), ends_at: hoursAhead(2 * 24 + 12, 20), status: 'confirmed', source: 'dashboard', payment_type: 'Particular', clinic_value: 120000, invoice_status: 'pendiente' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(9), starts_at: hoursAhead(3 * 24 + 13), ends_at: hoursAhead(3 * 24 + 13, 30), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Sura', clinic_value: 90000, invoice_status: 'pendiente' },
      { doctor_id: DR_ANA, patient_id: patientId(10), starts_at: hoursAhead(3 * 24 + 15), ends_at: hoursAhead(3 * 24 + 15, 30), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Nueva EPS', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_CARLOS, patient_id: patientId(11), starts_at: hoursAhead(4 * 24 + 11), ends_at: hoursAhead(4 * 24 + 11, 40), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 120000, invoice_status: 'pendiente' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(12), starts_at: hoursAhead(4 * 24 + 14, 30), ends_at: hoursAhead(4 * 24 + 15), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Coomeva', clinic_value: 90000, invoice_status: 'pendiente' },
      { doctor_id: DR_ANA, patient_id: patientId(13), starts_at: hoursAhead(5 * 24 + 12), ends_at: hoursAhead(5 * 24 + 12, 30), status: 'confirmed', source: 'dashboard', payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pendiente' },
      { doctor_id: DR_VALENTINA, patient_id: patientId(14), starts_at: hoursAhead(5 * 24 + 13, 30), ends_at: hoursAhead(5 * 24 + 14), status: 'confirmed', source: 'whatsapp_agent', payment_type: 'Particular', clinic_value: 90000, invoice_status: 'pendiente' },
    ].map(a => ({ ...a, clinic_id: CLINIC_ID }))

    const { error } = await supabase.from('appointments').insert(appts)
    if (error) { console.error('  ✗', error.message); process.exit(1) }
    console.log(`  ✓ ${appts.length} citas`)
  }

  // 7. ROL ADMIN
  console.log('7/7 Rol admin + vínculo usuario...')
  {
    // Estructura de permisos por módulo (NO usar { all: true } — el código no lo interpreta)
    const ADMIN_PERMS = {
      agenda: { read: true, write: true }, espera: { read: true, write: true },
      noshow: { read: true, write: true }, cartera: { read: true, write: true },
      patients: { read: true, write: true }, settings: { read: true, write: true },
      whatsapp: { read: true, write: true }, analytics: { read: true, write: true },
      asistente: { read: true, write: true }, onboarding: { read: true, write: true },
      facturacion: { read: true, write: true }, conversations: { read: true, write: true },
      user_management: { read: true, write: true },
    }
    const { error: e1 } = await supabase.from('clinic_roles').upsert({
      id: ROLE_ID,
      clinic_id: CLINIC_ID,
      name: 'Admin',
      description: 'Administrador completo',
      permissions: ADMIN_PERMS,
      is_default: true,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (e1) { console.error('  ✗ rol:', e1.message); process.exit(1) }

    const { error: e2 } = await supabase.from('clinic_users').insert({
      clinic_id: CLINIC_ID,
      auth_user_id: DEMO_USER_UUID,
      full_name: 'Demo Admin',
      role_id: ROLE_ID,
      is_active: true,
      onboarding_completed_at: hoursAgo(24 * 10),
    })
    if (e2 && !e2.message.includes('duplicate')) {
      console.error('  ✗ clinic_user:', e2.message); process.exit(1)
    }
    console.log('  ✓')
  }

  console.log('\nConteos DESPUÉS:')
  const after = await countBefore()
  console.log(after)

  console.log('\n=== DELTAS ===')
  for (const k of Object.keys(after)) {
    const delta = after[k] - before[k]
    console.log(`  ${k}: +${delta}`)
  }

  // Verificación demo
  console.log('\n=== CLÍNICA DEMO ===')
  const { data: demo } = await supabase.from('clinics').select('name, slug, subscription_status').eq('id', CLINIC_ID).single()
  console.log(demo)

  const { data: docs } = await supabase.from('doctors').select('name, specialty').eq('clinic_id', CLINIC_ID)
  console.log('Doctores:', docs)

  const { count: aptCount } = await supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('clinic_id', CLINIC_ID)
  console.log(`Citas demo: ${aptCount}`)

  console.log('\n✅ DONE')
  console.log('Login: demo@omuwan.co / OmuwanDemo2026')
}

main().catch(e => { console.error(e); process.exit(1) })
