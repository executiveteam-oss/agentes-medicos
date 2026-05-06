// ============================================================
// Seed: Centro Médico Bolívar — Demo account for sales meetings
// Run: set -a && source .env.production.local && set +a && npx tsx scripts/seed-demo-bolivar.ts
// ============================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(SUPABASE_URL, SERVICE_KEY)

// ---- CONFIG ----
const DEMO_EMAIL = 'demo@omuwan.co'
const DEMO_PASSWORD = 'Omuwan2026!'
const CLINIC_NAME = 'Centro Médico Bolívar'

// ---- HELPERS ----
function randomPhone(idx: number): string {
  return `+5730000${String(idx).padStart(4, '0')}`
}

function randomDate(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour + 5, minute, 0, 0) // +5 for UTC offset (Colombia is UTC-5)
  return d.toISOString()
}

function pastDate(daysAgo: number, hour: number, minute = 0): string {
  return randomDate(-daysAgo, hour, minute)
}

// ---- MAIN ----
async function seed() {
  console.log('=== SEEDING CENTRO MÉDICO BOLÍVAR ===\n')

  // ============================================================
  // PHASE 1: Clinic + User + Doctors + Consultation Types
  // ============================================================
  console.log('--- Phase 1: Clinic + Doctors ---')

  // 1a. Create clinic
  const { data: clinic, error: clinicErr } = await db.from('clinics').insert({
    name: CLINIC_NAME,
    slug: 'centro-medico-bolivar',
    phone: '+5730000000',
    address: 'Cra 7 #19-28, Edificio Torres del Otún, Piso 4',
    city: 'Pereira',
    department: 'Risaralda',
    consultation_price: 150000,
    consultation_duration_minutes: 30,
    subscription_status: 'active',
    subscription_plan: 'pro',
    agent_name: 'Omu',
    agent_personality: 'profesional, cálido y eficiente',
    welcome_message: '¡Hola! Soy Omu, asistente virtual del Centro Médico Bolívar. ¿En qué puedo ayudarte?',
    working_hours: {
      monday: { start: '07:00', end: '19:00', active: true },
      tuesday: { start: '07:00', end: '19:00', active: true },
      wednesday: { start: '07:00', end: '19:00', active: true },
      thursday: { start: '07:00', end: '19:00', active: true },
      friday: { start: '07:00', end: '19:00', active: true },
      saturday: { start: '07:00', end: '13:00', active: true },
      sunday: { start: '08:00', end: '12:00', active: false },
    },
    notification_settings: {
      reminder_72h: true,
      reminder_24h: true,
      reminder_2h: true,
      morning_report: true,
      morning_report_hour: '06:00',
      weekly_report: true,
      noshow_alert: true,
      noshow_alert_threshold: 25,
      overdue_billing_alert: false,
      overdue_billing_days: 30,
    },
    faq: [
      { q: '¿Dónde quedan?', a: 'Estamos en la Cra 7 #19-28, Edificio Torres del Otún, Piso 4, Pereira.' },
      { q: '¿Aceptan EPS?', a: 'Atendemos particular y algunas EPS. Consulta disponibilidad con tu EPS específica.' },
      { q: '¿Tienen parqueadero?', a: 'Sí, el edificio tiene parqueadero subterráneo. Primera hora gratis para pacientes.' },
    ],
  }).select('id').single()

  if (clinicErr || !clinic) {
    console.error('Error creating clinic:', clinicErr?.message)
    process.exit(1)
  }
  const clinicId = clinic.id
  console.log('  Clinic:', clinicId)

  // 1b. Create roles
  const roleNames = ['Admin', 'Doctor', 'Secretaria', 'Auxiliar', 'Facturador']
  const { data: roles } = await db.from('clinic_roles').insert(
    roleNames.map((name, i) => ({
      clinic_id: clinicId,
      name,
      permissions: name === 'Admin'
        ? { agenda: { read: true, write: true }, patients: { read: true, write: true }, analytics: { read: true, write: true }, whatsapp: { read: true, write: true }, espera: { read: true, write: true }, settings: { read: true, write: true }, noshow: { read: true, write: true }, conversations: { read: true, write: true }, billing: { read: true, write: true }, roles: { read: true, write: true } }
        : name === 'Secretaria'
        ? { agenda: { read: true, write: true }, patients: { read: true, write: true }, espera: { read: true, write: true }, conversations: { read: true, write: true }, noshow: { read: true, write: false }, analytics: { read: true, write: false }, whatsapp: { read: false, write: false }, settings: { read: false, write: false }, billing: { read: false, write: false }, roles: { read: false, write: false } }
        : { agenda: { read: true, write: false }, patients: { read: true, write: false }, analytics: { read: false, write: false }, whatsapp: { read: false, write: false }, espera: { read: false, write: false }, settings: { read: false, write: false }, noshow: { read: false, write: false }, conversations: { read: false, write: false }, billing: { read: false, write: false }, roles: { read: false, write: false } },
    }))
  ).select('id, name')

  const adminRoleId = roles?.find(r => r.name === 'Admin')?.id
  console.log('  Roles:', roles?.map(r => r.name).join(', '))

  // 1c. Create auth user + clinic_user
  const { data: authUser, error: authErr } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { clinic_id: clinicId },
  })

  if (authErr) {
    console.error('Error creating auth user:', authErr.message)
    // User might already exist
    const { data: existingUsers } = await db.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(u => u.email === DEMO_EMAIL)
    if (existing) {
      console.log('  User already exists, reusing:', existing.id)
      await db.from('clinic_users').insert({
        clinic_id: clinicId,
        auth_user_id: existing.id,
        role_id: adminRoleId,
        full_name: 'Administrador Demo',
        is_active: true,
      })
    }
  } else {
    await db.from('clinic_users').insert({
      clinic_id: clinicId,
      auth_user_id: authUser.user.id,
      role_id: adminRoleId,
      full_name: 'Administrador Demo',
      is_active: true,
    })
    console.log('  Auth user:', authUser.user.id)
  }

  // 1d. Create 3 doctors
  const doctorsData = [
    { name: 'Dr. Andrés Rodríguez', specialty: 'Medicina General', phone: '+573001111111', email: 'arodriguez@demo.co',
      working_hours: { monday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] }, tuesday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] }, wednesday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] }, thursday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] }, friday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] }, saturday: { active: false, blocks: [] }, sunday: { active: false, blocks: [] } } },
    { name: 'Dra. Catalina Mejía', specialty: 'Pediatría', phone: '+573002222222', email: 'cmejia@demo.co',
      working_hours: { monday: { active: true, blocks: [{ start: '14:00', end: '18:00' }] }, tuesday: { active: false, blocks: [] }, wednesday: { active: true, blocks: [{ start: '14:00', end: '18:00' }] }, thursday: { active: false, blocks: [] }, friday: { active: true, blocks: [{ start: '14:00', end: '18:00' }] }, saturday: { active: false, blocks: [] }, sunday: { active: false, blocks: [] } } },
    { name: 'Diana Castaño', specialty: 'Fisioterapia', phone: '+573003333333', email: 'dcastano@demo.co',
      working_hours: { monday: { active: false, blocks: [] }, tuesday: { active: true, blocks: [{ start: '07:00', end: '13:00' }] }, wednesday: { active: true, blocks: [{ start: '07:00', end: '13:00' }] }, thursday: { active: true, blocks: [{ start: '07:00', end: '13:00' }] }, friday: { active: true, blocks: [{ start: '07:00', end: '13:00' }] }, saturday: { active: true, blocks: [{ start: '07:00', end: '13:00' }] }, sunday: { active: false, blocks: [] } } },
  ]

  const { data: doctors } = await db.from('doctors').insert(
    doctorsData.map(d => ({ clinic_id: clinicId, ...d, is_active: true }))
  ).select('id, name')

  if (!doctors?.length) { console.error('Error creating doctors'); process.exit(1) }
  const [drRodriguez, draMejia, dianaCastano] = doctors
  console.log('  Doctors:', doctors.map(d => d.name).join(', '))

  // 1e. Create consultation types
  const ctData = [
    { doctor_id: drRodriguez.id, name: 'Primera vez', duration_minutes: 30, price: 150000, bookable_via_whatsapp: true },
    { doctor_id: drRodriguez.id, name: 'Control', duration_minutes: 20, price: 90000, bookable_via_whatsapp: true },
    { doctor_id: draMejia.id, name: 'Pediatría primera vez', duration_minutes: 40, price: 180000, bookable_via_whatsapp: true },
    { doctor_id: draMejia.id, name: 'Control pediátrico', duration_minutes: 25, price: 110000, bookable_via_whatsapp: true },
    { doctor_id: draMejia.id, name: 'Vacunación', duration_minutes: 15, price: 80000, bookable_via_whatsapp: true },
    { doctor_id: dianaCastano.id, name: 'Evaluación inicial', duration_minutes: 45, price: 120000, bookable_via_whatsapp: true },
    { doctor_id: dianaCastano.id, name: 'Sesión de fisioterapia', duration_minutes: 40, price: 80000, bookable_via_whatsapp: true },
  ]

  await db.from('consultation_types').insert(
    ctData.map(ct => ({ clinic_id: clinicId, ...ct, is_active: true, requires_preparation: false, requires_documents: false, modality: 'presencial' }))
  )
  console.log('  Consultation types:', ctData.length)

  // ============================================================
  // PHASE 2: Patients + Appointments
  // ============================================================
  console.log('\n--- Phase 2: Patients + Appointments ---')

  const patientNames = [
    'María Fernanda López', 'Carlos Alberto Gómez', 'Valentina Ríos Cardona',
    'Jhon Fredy Ospina', 'Luisa Fernanda Marín', 'Sebastián Herrera Torres',
    'Natalia Andrea Duque', 'Alejandro Castaño Ríos', 'Daniela Osorio Grajales',
    'Felipe Morales Quintero', 'Laura Cristina Bedoya', 'Santiago Mejía Restrepo',
    'Camila Jaramillo Vélez', 'Juan Esteban Ochoa', 'Paola Andrea Rendón',
    'Mateo Giraldo López', 'Isabella Franco Muñoz', 'Andrés Felipe Salazar',
    'Sofía Ramírez Henao', 'Diego Alejandro Botero', 'Ana María Gutiérrez',
    'Tomás Londoño Arango', 'Juliana Montoya Pérez', 'Nicolás Zapata Carvajal',
    'Mariana Restrepo Gil', 'David Esteban Henao', 'Gabriela Vargas Rojas',
    'Samuel Arias Gallego', 'Valeria Correa Soto', 'Miguel Ángel Parra',
  ]

  const patients: { id: string; name: string; phone: string }[] = []
  for (let i = 0; i < 30; i++) {
    const noShowCount = i < 15 ? (i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0) : 0
    const totalApts = i < 15 ? Math.floor(Math.random() * 8) + 2 : i < 25 ? Math.floor(Math.random() * 4) + 1 : 0
    const { data: p } = await db.from('patients').insert({
      clinic_id: clinicId,
      name: patientNames[i],
      phone: randomPhone(i + 1),
      document_type: 'CC',
      document_number: `10${String(80000000 + i * 31337).slice(0, 8)}`,
      date_of_birth: `${1965 + (i % 50)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      eps: i % 3 === 0 ? 'Coomeva' : i % 3 === 1 ? 'SOS' : null,
      no_show_count: noShowCount,
      total_appointments: totalApts,
      data_consent_at: new Date().toISOString(),
    }).select('id, name, phone').single()
    if (p) patients.push(p)
  }
  console.log('  Patients:', patients.length)

  // 2b. Future appointments (next 7 days)
  const futureApts: { patient_idx: number; doctor: typeof drRodriguez; days: number; hour: number; min: number; reason: string; payment: string }[] = [
    // Tomorrow
    { patient_idx: 0, doctor: drRodriguez, days: 1, hour: 8, min: 0, reason: 'Primera vez', payment: 'Particular' },
    { patient_idx: 1, doctor: drRodriguez, days: 1, hour: 8, min: 30, reason: 'Control', payment: 'EPS' },
    { patient_idx: 2, doctor: drRodriguez, days: 1, hour: 9, min: 0, reason: 'Primera vez', payment: 'Particular' },
    { patient_idx: 3, doctor: draMejia, days: 1, hour: 14, min: 0, reason: 'Pediatría primera vez', payment: 'Particular' },
    { patient_idx: 4, doctor: draMejia, days: 1, hour: 14, min: 40, reason: 'Vacunación', payment: 'Particular' },
    // Day after tomorrow
    { patient_idx: 5, doctor: dianaCastano, days: 2, hour: 7, min: 0, reason: 'Evaluación inicial', payment: 'Particular' },
    { patient_idx: 6, doctor: dianaCastano, days: 2, hour: 8, min: 0, reason: 'Sesión de fisioterapia', payment: 'EPS' },
    { patient_idx: 7, doctor: dianaCastano, days: 2, hour: 9, min: 0, reason: 'Sesión de fisioterapia', payment: 'Particular' },
    { patient_idx: 8, doctor: drRodriguez, days: 2, hour: 9, min: 30, reason: 'Control', payment: 'EPS' },
    // 3 days
    { patient_idx: 9, doctor: draMejia, days: 3, hour: 14, min: 0, reason: 'Control pediátrico', payment: 'EPS' },
    { patient_idx: 10, doctor: drRodriguez, days: 3, hour: 10, min: 0, reason: 'Primera vez', payment: 'Particular' },
    // 4 days
    { patient_idx: 11, doctor: dianaCastano, days: 4, hour: 7, min: 0, reason: 'Sesión de fisioterapia', payment: 'Particular' },
    { patient_idx: 12, doctor: dianaCastano, days: 4, hour: 8, min: 30, reason: 'Sesión de fisioterapia', payment: 'EPS' },
    // 5 days
    { patient_idx: 13, doctor: drRodriguez, days: 5, hour: 8, min: 0, reason: 'Control', payment: 'Particular' },
    { patient_idx: 14, doctor: draMejia, days: 5, hour: 15, min: 0, reason: 'Pediatría primera vez', payment: 'Particular' },
    // 6 days
    { patient_idx: 15, doctor: dianaCastano, days: 6, hour: 9, min: 0, reason: 'Evaluación inicial', payment: 'EPS' },
    { patient_idx: 16, doctor: drRodriguez, days: 6, hour: 11, min: 0, reason: 'Primera vez', payment: 'Particular' },
    // 7 days
    { patient_idx: 17, doctor: draMejia, days: 7, hour: 14, min: 0, reason: 'Vacunación', payment: 'Particular' },
  ]

  let futureCount = 0
  for (const apt of futureApts) {
    const p = patients[apt.patient_idx]
    const duration = apt.reason.includes('Evaluación') ? 45 : apt.reason.includes('Pediatría primera') ? 40 : apt.reason === 'Vacunación' ? 15 : apt.reason === 'Control' ? 20 : apt.reason === 'Sesión de fisioterapia' ? 40 : 30
    const startsAt = randomDate(apt.days, apt.hour, apt.min)
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60000).toISOString()
    const confirmed = Math.random() > 0.3

    await db.from('appointments').insert({
      clinic_id: clinicId,
      doctor_id: apt.doctor.id,
      patient_id: p.id,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'confirmed',
      reason: apt.reason,
      source: Math.random() > 0.35 ? 'whatsapp_agent' : 'dashboard',
      payment_type: apt.payment,
      reminder_24h_sent: apt.days <= 2,
      reminder_confirmed: apt.days <= 2 ? (confirmed ? true : null) : false,
    })
    futureCount++
  }
  console.log('  Future appointments:', futureCount)

  // 2c. Past appointments (last 30 days)
  const pastStatuses = [
    'completed', 'completed', 'completed', 'completed', 'completed',
    'completed', 'completed', 'no_show', 'cancelled', 'completed',
    'completed', 'completed', 'no_show', 'completed', 'completed',
    'completed', 'cancelled', 'completed', 'completed', 'no_show',
    'completed', 'completed', 'completed', 'cancelled', 'completed',
    'completed', 'no_show', 'completed', 'completed', 'completed',
    'completed', 'completed', 'completed', 'no_show', 'cancelled',
    'completed', 'completed', 'completed', 'completed', 'completed',
  ]

  let pastCount = 0
  for (let i = 0; i < 40; i++) {
    const daysAgo = Math.floor(i / 2) + 1
    const doctor = i % 3 === 0 ? drRodriguez : i % 3 === 1 ? draMejia : dianaCastano
    const hour = doctor.id === draMejia.id ? 14 + (i % 4) : 7 + (i % 5)
    const p = patients[i % 25]
    const status = pastStatuses[i]
    const reason = doctor.id === drRodriguez.id ? (i % 2 === 0 ? 'Primera vez' : 'Control') : doctor.id === draMejia.id ? 'Control pediátrico' : 'Sesión de fisioterapia'
    const duration = reason === 'Sesión de fisioterapia' ? 40 : reason === 'Control pediátrico' ? 25 : reason === 'Control' ? 20 : 30
    const startsAt = pastDate(daysAgo, hour, (i % 2) * 30)
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60000).toISOString()

    await db.from('appointments').insert({
      clinic_id: clinicId,
      doctor_id: doctor.id,
      patient_id: p.id,
      starts_at: startsAt,
      ends_at: endsAt,
      status,
      reason,
      source: i % 3 === 0 ? 'dashboard' : 'whatsapp_agent',
      payment_type: i % 4 === 0 ? 'EPS' : 'Particular',
      reminder_24h_sent: true,
      reminder_confirmed: status === 'completed' ? true : status === 'no_show' ? false : null,
      cancelled_at: status === 'cancelled' ? new Date(new Date(startsAt).getTime() - 86400000).toISOString() : null,
      cancellation_reason: status === 'cancelled' ? 'Paciente no puede asistir' : null,
    })
    pastCount++
  }
  console.log('  Past appointments:', pastCount)

  // ============================================================
  // PHASE 3: Conversations + Messages
  // ============================================================
  console.log('\n--- Phase 3: Conversations + Messages ---')

  const conversations = [
    // 1. Cita confirmada — flujo completo natural
    { patient: patients[0], messages: [
      { role: 'patient', content: 'Buenas tardes, necesito una cita con medico general' },
      { role: 'agent', content: '¡Hola María Fernanda! Con gusto te ayudo. El Dr. Andrés Rodríguez atiende medicina general de lunes a viernes de 8 AM a 12 PM. ¿Qué día te queda bien?' },
      { role: 'patient', content: 'mañana por la mañana si hay' },
      { role: 'agent', content: 'Mañana tengo disponible a las 8:00 AM y 9:30 AM con el Dr. Rodríguez. ¿Cuál prefieres?' },
      { role: 'patient', content: '8am' },
      { role: 'agent', content: '¿Es consulta de primera vez o control?' },
      { role: 'patient', content: 'primera vez' },
      { role: 'agent', content: '¿Vas como particular o con EPS?' },
      { role: 'patient', content: 'particular' },
      { role: 'agent', content: '✅ Cita confirmada con el Dr. Andrés Rodríguez\n📅 Mañana a las 8:00 AM\n📍 Cra 7 #19-28, Ed. Torres del Otún, Piso 4\n💰 $150.000 COP\n\n¡Te esperamos!' },
    ]},
    // 2. Cita con EPS
    { patient: patients[1], messages: [
      { role: 'patient', content: 'hola quiero pedir cita' },
      { role: 'agent', content: '¡Hola Carlos! Con gusto. ¿Qué especialidad necesitas?' },
      { role: 'patient', content: 'medico general, es un control' },
      { role: 'agent', content: 'Perfecto. El Dr. Andrés Rodríguez tiene disponibilidad mañana a las 8:30 AM y 10:00 AM. ¿Cuál te sirve?' },
      { role: 'patient', content: '830' },
      { role: 'agent', content: '¿Vas como particular o con EPS?' },
      { role: 'patient', content: 'eps coomeva' },
      { role: 'agent', content: '✅ Cita confirmada con el Dr. Andrés Rodríguez\n📅 Mañana a las 8:30 AM\n📍 Cra 7 #19-28, Ed. Torres del Otún, Piso 4\n\nRecuerda traer tu carnet de Coomeva vigente. ¡Te esperamos!' },
    ]},
    // 3. Pediatría
    { patient: patients[3], messages: [
      { role: 'patient', content: 'Buenos dias necesito cita para mi hijo de 4 años' },
      { role: 'agent', content: '¡Hola Jhon! Para tu hijo te puedo agendar con la Dra. Catalina Mejía, pediatra. Atiende lunes, miércoles y viernes de 2 a 6 PM. ¿Qué día te queda bien?' },
      { role: 'patient', content: 'el viernes en la tarde' },
      { role: 'agent', content: 'El viernes tengo a las 2:00 PM y 3:00 PM. ¿Cuál prefieres?' },
      { role: 'patient', content: 'a las 2' },
      { role: 'agent', content: '¿Es primera vez o control?' },
      { role: 'patient', content: 'primera vez' },
      { role: 'agent', content: '✅ Cita confirmada con la Dra. Catalina Mejía\n📅 Viernes a las 2:00 PM\n📍 Cra 7 #19-28, Ed. Torres del Otún, Piso 4\n💰 $180.000 COP\n\n¡Los esperamos!' },
    ]},
    // 4. Fisioterapia
    { patient: patients[5], messages: [
      { role: 'patient', content: 'Hola me mandaron fisioterapia por un dolor de espalda' },
      { role: 'agent', content: '¡Hola Sebastián! Te puedo agendar evaluación inicial con Diana Castaño, fisioterapeuta. Atiende martes a sábado de 7 AM a 1 PM. ¿Qué día te queda bien?' },
      { role: 'patient', content: 'el martes temprano porfa' },
      { role: 'agent', content: 'El martes tengo a las 7:00 AM y 8:00 AM. ¿Cuál prefieres?' },
      { role: 'patient', content: '7' },
      { role: 'agent', content: '✅ Cita confirmada: Evaluación inicial con Diana Castaño\n📅 Martes a las 7:00 AM\n📍 Cra 7 #19-28, Ed. Torres del Otún, Piso 4\n💰 $120.000 COP\n\nTrae ropa cómoda. ¡Te esperamos!' },
    ]},
    // 5. Reagendamiento
    { patient: patients[8], messages: [
      { role: 'patient', content: 'Hola tengo cita mañana pero no puedo ir, puedo cambiarla?' },
      { role: 'agent', content: '¡Hola Daniela! Claro, sin problema. Veo que tienes cita mañana a las 9:30 AM con el Dr. Rodríguez. ¿Para qué día te gustaría reagendarla?' },
      { role: 'patient', content: 'el jueves si hay algo' },
      { role: 'agent', content: 'El jueves tengo disponible a las 10:00 AM y 11:00 AM. ¿Cuál te sirve?' },
      { role: 'patient', content: '10am esta bien' },
      { role: 'agent', content: '✅ Cita reagendada con el Dr. Andrés Rodríguez\n📅 Jueves a las 10:00 AM\n📍 Cra 7 #19-28, Ed. Torres del Otún, Piso 4\n\n¡Listo, te esperamos el jueves!' },
    ]},
    // 6. Reagendamiento 2
    { patient: patients[12], messages: [
      { role: 'patient', content: 'necesito mover mi cita del miercoles' },
      { role: 'agent', content: '¡Hola Camila! Veo tu cita el miércoles con Diana Castaño. ¿Para cuándo te gustaría moverla?' },
      { role: 'patient', content: 'puede ser el sabado?' },
      { role: 'agent', content: 'El sábado hay espacio a las 9:00 AM, 10:00 AM y 11:00 AM. ¿Cuál prefieres?' },
      { role: 'patient', content: '10' },
      { role: 'agent', content: '✅ Cita reagendada: Sesión de fisioterapia con Diana Castaño\n📅 Sábado a las 10:00 AM\n\n¡Nos vemos el sábado!' },
    ]},
    // 7. Cancelación
    { patient: patients[16], messages: [
      { role: 'patient', content: 'hola necesito cancelar la cita de mi hija' },
      { role: 'agent', content: '¡Hola Isabella! Lamento escuchar eso. Veo la cita de vacunación con la Dra. Mejía. ¿Estás segura de que quieres cancelarla? También puedo reagendarla si prefieres.' },
      { role: 'patient', content: 'si cancelar porfa, se enfermó y no podemos ir' },
      { role: 'agent', content: 'Listo, cita cancelada. Espero que tu hija se mejore pronto 🙏 Cuando estén listos para reagendar, escríbeme y con gusto te busco un nuevo horario.' },
    ]},
    // 8. Cancelación 2
    { patient: patients[18], messages: [
      { role: 'patient', content: 'ya no puedo ir a la cita del lunes' },
      { role: 'agent', content: '¡Hola Sofía! Entiendo. ¿Quieres cancelarla o prefieres que la movamos a otro día?' },
      { role: 'patient', content: 'cancelar, despues la vuelvo a pedir' },
      { role: 'agent', content: 'Listo, cita cancelada. Cuando quieras reagendar, escríbeme. ¡Que tengas buen día!' },
    ]},
    // 9. Pregunta de precios
    { patient: patients[20], messages: [
      { role: 'patient', content: 'buenas cuanto vale la consulta?' },
      { role: 'agent', content: '¡Hola Ana María! Te cuento los valores:\n\n👨‍⚕️ Medicina General:\n• Primera vez: $150.000\n• Control: $90.000\n\n👶 Pediatría:\n• Primera vez: $180.000\n• Control: $110.000\n• Vacunación: $80.000\n\n💪 Fisioterapia:\n• Evaluación: $120.000\n• Sesión: $80.000\n\n¿Te gustaría agendar una cita?' },
      { role: 'patient', content: 'gracias! voy a consultar y te escribo' },
      { role: 'agent', content: '¡Con gusto! Cuando estés lista, escríbeme y te agendo. ¡Feliz día!' },
    ]},
    // 10. Escalada a humano
    { patient: patients[22], messages: [
      { role: 'patient', content: 'hola necesito que me envien los resultados de mis examenes de sangre del mes pasado' },
      { role: 'agent', content: 'Hola Juliana. Entiendo que necesitas tus resultados de laboratorio. Lamentablemente yo no tengo acceso a resultados de exámenes, pero voy a comunicarte con alguien del equipo que te puede ayudar. Un momento por favor.' },
      { role: 'patient', content: 'dale gracias' },
      { role: 'agent', content: 'Ya le avisé al equipo del consultorio. Te van a contactar pronto por este mismo chat. Si necesitas algo más, estoy aquí. 🙌' },
    ]},
  ]

  let convCount = 0
  for (const conv of conversations) {
    const { data: c } = await db.from('conversations').insert({
      clinic_id: clinicId,
      patient_id: conv.patient.id,
      whatsapp_phone: conv.patient.phone,
      status: convCount === 9 ? 'escalated' : 'active',
      escalated_at: convCount === 9 ? new Date().toISOString() : null,
      last_message_at: new Date(Date.now() - convCount * 3600000).toISOString(),
    }).select('id').single()

    if (c) {
      for (let j = 0; j < conv.messages.length; j++) {
        await db.from('messages').insert({
          conversation_id: c.id,
          role: conv.messages[j].role === 'agent' ? 'agent' : 'patient',
          content: conv.messages[j].content,
          message_type: 'text',
          created_at: new Date(Date.now() - (conversations.length - convCount) * 3600000 + j * 30000).toISOString(),
        })
      }
      convCount++
    }
  }
  console.log('  Conversations:', convCount)

  // ============================================================
  // PHASE 4: Pending Contacts + Reminders
  // ============================================================
  console.log('\n--- Phase 4: Pending Contacts ---')

  // Get a future appointment for pending contact
  const { data: futApts } = await db.from('appointments')
    .select('id, starts_at, doctor_id, doctors(name)')
    .eq('clinic_id', clinicId)
    .eq('status', 'confirmed')
    .order('starts_at', { ascending: true })
    .limit(3)

  if (futApts?.length) {
    // Pending: reminder failed
    await db.from('pending_contacts').insert({
      clinic_id: clinicId,
      patient_id: patients[2].id,
      appointment_id: futApts[0].id,
      reason_type: 'reminder_failed',
      reason_text: 'Recordatorio 24h no entregado — fuera de ventana',
      patient_name: patients[2].name,
      patient_phone: patients[2].phone,
      doctor_name: ((futApts[0].doctors as unknown as { name: string })?.name ?? ''),
      appointment_date: futApts[0].starts_at,
      consultation_type: 'Primera vez',
    })

    // Pending: cancellation not delivered
    await db.from('pending_contacts').insert({
      clinic_id: clinicId,
      patient_id: patients[7].id,
      appointment_id: futApts[1]?.id ?? futApts[0].id,
      reason_type: 'cancellation_no_delivery',
      reason_text: 'Cita cancelada por bloqueo de agenda — WhatsApp no entregado',
      patient_name: patients[7].name,
      patient_phone: patients[7].phone,
      doctor_name: (futApts[1]?.doctors as unknown as { name: string })?.name ?? ((futApts[0].doctors as unknown as { name: string })?.name ?? ''),
      appointment_date: futApts[1]?.starts_at ?? futApts[0].starts_at,
      consultation_type: 'Control',
    })

    // Resolved: already contacted
    await db.from('pending_contacts').insert({
      clinic_id: clinicId,
      patient_id: patients[10].id,
      appointment_id: futApts[2]?.id ?? futApts[0].id,
      reason_type: 'reminder_failed',
      reason_text: 'Recordatorio 72h no entregado',
      patient_name: patients[10].name,
      patient_phone: patients[10].phone,
      doctor_name: (futApts[2]?.doctors as unknown as { name: string })?.name ?? '',
      appointment_date: futApts[2]?.starts_at ?? futApts[0].starts_at,
      resolved_at: new Date(Date.now() - 3600000).toISOString(),
      resolution_method: 'manual_whatsapp',
    })
  }
  console.log('  Pending contacts: 2 active + 1 resolved')

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n=== SEED COMPLETE ===')
  console.log(`Clinic:    ${CLINIC_NAME} (${clinicId})`)
  console.log(`Login:     ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`Doctors:   3`)
  console.log(`Patients:  30`)
  console.log(`Future:    ${futureCount} appointments`)
  console.log(`Past:      ${pastCount} appointments`)
  console.log(`Convos:    ${convCount}`)
  console.log(`Pending:   3 (2 active, 1 resolved)`)
  console.log('\nURL: https://omuwan.co/login')
}

seed().catch(console.error)
