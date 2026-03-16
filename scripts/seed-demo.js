#!/usr/bin/env node

// ============================================================
// Seed de datos demo para la clínica asociada a
// jlondonoechavarria@gmail.com
//
// Uso: node scripts/seed-demo.js
// Requiere: .env.local con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
// ============================================================

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')
const crypto = require('crypto')

// --- Cargar .env.local manualmente ---
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// --- Helpers ---
const uuid = () => crypto.randomUUID()

/** Fecha en UTC para una fecha COT (UTC-5). daysOffset desde hoy, hour en hora colombiana */
function cotDate(daysOffset, hour, minute = 0) {
  const now = new Date()
  // Fecha actual en COT
  const cot = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const base = new Date(cot.getFullYear(), cot.getMonth(), cot.getDate())
  base.setDate(base.getDate() + daysOffset)
  base.setHours(hour, minute, 0, 0)
  // Convertir COT → UTC (sumar 5 horas)
  return new Date(base.getTime() + 5 * 60 * 60 * 1000).toISOString()
}

function formatCOP(n) {
  return '$' + n.toLocaleString('es-CO') + ' COP'
}

// --- Datos colombianos realistas ---
const PATIENT_DATA = [
  { name: 'María Camila Rodríguez Ospina', phone: '+573124567890', eps: 'Sura', doc: '1017234567', dob: '1990-03-15' },
  { name: 'Juan David Gómez Velásquez', phone: '+573015678901', eps: 'Nueva EPS', doc: '1020345678', dob: '1985-07-22' },
  { name: 'Valentina Herrera Montoya', phone: '+573176789012', eps: 'Compensar', doc: '1035456789', dob: '1995-11-08' },
  { name: 'Santiago Mejía Restrepo', phone: '+573207890123', eps: 'Sanitas', doc: '1012567890', dob: '1988-01-30' },
  { name: 'Laura Sofía Pérez Cardona', phone: '+573148901234', eps: 'Particular', doc: '1028678901', dob: '1992-06-12' },
  { name: 'Andrés Felipe Muñoz Arias', phone: '+573169012345', eps: 'Sura', doc: '1041789012', dob: '1983-09-25' },
  { name: 'Daniela Castaño Jaramillo', phone: '+573110123456', eps: 'Nueva EPS', doc: '1054890123', dob: '1997-04-18' },
  { name: 'Carlos Alberto López Duque', phone: '+573021234567', eps: 'Sanitas', doc: '1067901234', dob: '1979-12-03' },
  { name: 'Isabella García Betancur', phone: '+573182345678', eps: 'Compensar', doc: '1080012345', dob: '2000-08-27' },
  { name: 'Diego Alejandro Ríos Salazar', phone: '+573053456789', eps: 'Sura', doc: '1093123456', dob: '1991-02-14' },
  { name: 'Natalia Rendón Echavarría', phone: '+573194567890', eps: 'Particular', doc: '1016234567', dob: '1986-10-09' },
  { name: 'Sebastián Arango Zuluaga', phone: '+573065678901', eps: 'Nueva EPS', doc: '1029345678', dob: '1993-05-21' },
  { name: 'Mariana Álvarez Correa', phone: '+573136789012', eps: 'Sanitas', doc: '1042456789', dob: '1998-01-07' },
  { name: 'Julián Esteban Ochoa Giraldo', phone: '+573077890123', eps: 'Sura', doc: '1055567890', dob: '1982-07-16' },
  { name: 'Camila Andrea Vargas Henao', phone: '+573148901235', eps: 'Compensar', doc: '1068678901', dob: '1994-11-30' },
]

const REASONS = [
  'Consulta general', 'Valoración inicial', 'Control prenatal',
  'Chequeo pediátrico', 'Dolor de cabeza', 'Control de presión',
  'Revisión ginecológica', 'Citología', 'Control de crecimiento',
  'Control post-operatorio', 'Exámenes de laboratorio', 'Certificado médico',
]

const PAYMENT_TYPES = ['Particular', 'EPS', 'Póliza', 'ARL']
const INVOICE_STATUSES = ['emitida', 'pendiente', 'vencida']

// --- Main ---
async function main() {
  console.log('Buscando clínica para jlondonoechavarria@gmail.com...\n')

  // 1. Buscar el auth user
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers()
  if (usersErr) throw usersErr

  const authUser = users.find((u) => u.email === 'jlondonoechavarria@gmail.com')
  if (!authUser) {
    console.error('No se encontró el usuario jlondonoechavarria@gmail.com en auth.users')
    process.exit(1)
  }
  console.log(`  Auth user: ${authUser.id}`)

  // 2. Buscar clinic_user para obtener clinic_id
  const { data: clinicUser, error: cuErr } = await supabase
    .from('clinic_users')
    .select('clinic_id')
    .eq('auth_user_id', authUser.id)
    .single()
  if (cuErr) throw cuErr

  const clinicId = clinicUser.clinic_id
  console.log(`  Clinic ID: ${clinicId}`)

  // 3. Buscar o crear el doctor de la clínica
  let { data: doctors, error: docErr } = await supabase
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .limit(1)
  if (docErr) throw docErr

  let doctorId
  if (!doctors || doctors.length === 0) {
    console.log('  No hay doctor activo — creando doctor demo...')
    const newDoctor = {
      id: uuid(),
      clinic_id: clinicId,
      name: 'Dra. Carolina Montoya',
      specialty: 'Medicina General',
      phone: '+573009876543',
      email: 'carolina@lospuchis.com',
      is_active: true,
      working_hours: {
        monday:    { start: '08:00', end: '18:00', active: true },
        tuesday:   { start: '08:00', end: '18:00', active: true },
        wednesday: { start: '08:00', end: '18:00', active: true },
        thursday:  { start: '08:00', end: '18:00', active: true },
        friday:    { start: '08:00', end: '16:00', active: true },
        saturday:  { start: '09:00', end: '13:00', active: true },
        sunday:    { start: '00:00', end: '00:00', active: false },
      },
    }
    const { error: newDocErr } = await supabase.from('doctors').insert(newDoctor)
    if (newDocErr) throw newDocErr
    doctorId = newDoctor.id
    console.log(`  Doctor creado: Dra. Carolina Montoya (${doctorId})`)
  } else {
    doctorId = doctors[0].id
    console.log(`  Doctor: ${doctors[0].name} (${doctorId})`)
  }
  console.log()

  // ========================
  // PACIENTES (15)
  // ========================
  console.log('Insertando 15 pacientes...')
  const patientIds = PATIENT_DATA.map(() => uuid())
  const patients = PATIENT_DATA.map((p, i) => ({
    id: patientIds[i],
    clinic_id: clinicId,
    name: p.name,
    phone: p.phone,
    document_type: 'CC',
    document_number: p.doc,
    date_of_birth: p.dob,
    eps: p.eps,
    procedure_entity: p.eps === 'Particular' ? 'Particular' : 'EPS',
    no_show_count: 0,
    total_appointments: 0,
    data_consent_at: new Date().toISOString(),
  }))

  const { error: patErr } = await supabase.from('patients').insert(patients)
  if (patErr) {
    if (patErr.code === '23505') {
      console.log('  Algunos pacientes ya existen, continuando...')
    } else {
      throw patErr
    }
  } else {
    console.log('  15 pacientes insertados')
  }

  // Re-fetch patient IDs in case some already existed
  const { data: allPatients } = await supabase
    .from('patients')
    .select('id, name, phone')
    .eq('clinic_id', clinicId)

  const patientMap = new Map()
  for (const p of allPatients) {
    patientMap.set(p.phone, { id: p.id, name: p.name })
  }

  // Map by our seed data order
  const seedPatientIds = PATIENT_DATA.map((p) => patientMap.get(p.phone)?.id).filter(Boolean)

  // ========================
  // CITAS (60)
  // ========================
  console.log('\nInsertando 60 citas...')
  const appointments = []
  const appointmentIds = []
  let noShowCount = 0
  let cancelledCount = 0
  let pendingCount = 0

  // Helper: pick random element
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  // --- Citas pasadas (últimos 3 meses): 52 citas ---
  for (let i = 0; i < 52; i++) {
    const id = uuid()
    appointmentIds.push(id)
    const daysAgo = Math.floor(Math.random() * 90) + 1 // 1-90 días atrás
    const hour = 8 + Math.floor(Math.random() * 9) // 8 AM - 5 PM COT
    const minute = pick([0, 30])
    const patientId = pick(seedPatientIds)
    const paymentType = pick(PAYMENT_TYPES)

    let status
    let invoiceStatus
    if (noShowCount < 12 && Math.random() < 0.25) {
      status = 'no_show'
      noShowCount++
      invoiceStatus = 'pendiente'
    } else if (cancelledCount < 5 && Math.random() < 0.12) {
      status = 'cancelled'
      cancelledCount++
      invoiceStatus = 'pendiente'
    } else {
      status = 'completed'
      invoiceStatus = pick(['emitida', 'emitida', 'emitida', 'pendiente'])
    }

    appointments.push({
      id,
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patientId,
      starts_at: cotDate(-daysAgo, hour, minute),
      ends_at: cotDate(-daysAgo, hour, minute + 30),
      status,
      reason: pick(REASONS),
      source: pick(['whatsapp_agent', 'whatsapp_agent', 'dashboard', 'manual']),
      payment_type: paymentType,
      invoice_status: invoiceStatus,
      outstanding_balance: status === 'no_show' ? pick([80000, 120000, 0]) : 0,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: status === 'completed',
      cancelled_at: status === 'cancelled' ? cotDate(-daysAgo + 1, 10) : null,
      cancellation_reason: status === 'cancelled' ? pick(['Paciente canceló', 'Reagendó', 'Motivo personal']) : null,
    })
  }

  // Rellenar si faltan no-shows
  while (noShowCount < 12) {
    const idx = appointments.findIndex((a) => a.status === 'completed')
    if (idx === -1) break
    appointments[idx].status = 'no_show'
    appointments[idx].invoice_status = 'pendiente'
    appointments[idx].outstanding_balance = pick([80000, 120000, 150000])
    appointments[idx].confirmation_received = false
    noShowCount++
  }

  // Rellenar si faltan canceladas
  while (cancelledCount < 5) {
    const idx = appointments.findIndex((a, i) => a.status === 'completed' && i > cancelledCount)
    if (idx === -1) break
    appointments[idx].status = 'cancelled'
    appointments[idx].invoice_status = 'pendiente'
    appointments[idx].cancelled_at = new Date().toISOString()
    appointments[idx].cancellation_reason = 'Paciente canceló'
    cancelledCount++
  }

  // --- Citas pendientes (hoy y mañana): 8 citas ---
  const pendingHours = [
    { day: 0, hour: 9, min: 0 },
    { day: 0, hour: 10, min: 30 },
    { day: 0, hour: 14, min: 0 },
    { day: 0, hour: 15, min: 30 },
    { day: 1, hour: 8, min: 30 },
    { day: 1, hour: 10, min: 0 },
    { day: 1, hour: 11, min: 30 },
    { day: 1, hour: 14, min: 0 },
  ]

  for (const slot of pendingHours) {
    const id = uuid()
    appointmentIds.push(id)
    appointments.push({
      id,
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: seedPatientIds[pendingCount % seedPatientIds.length],
      starts_at: cotDate(slot.day, slot.hour, slot.min),
      ends_at: cotDate(slot.day, slot.hour, slot.min + 30),
      status: 'confirmed',
      reason: pick(REASONS),
      source: pick(['whatsapp_agent', 'dashboard']),
      payment_type: pick(PAYMENT_TYPES),
      invoice_status: 'pendiente',
      outstanding_balance: 0,
      reminder_24h_sent: slot.day === 0,
      reminder_2h_sent: false,
      confirmation_received: false,
    })
    pendingCount++
  }

  const { error: apptErr } = await supabase.from('appointments').insert(appointments)
  if (apptErr) throw apptErr
  console.log(`  ${appointments.length} citas insertadas (${noShowCount} no-show, ${cancelledCount} canceladas, ${pendingCount} pendientes)`)

  // Update patient stats
  for (const pid of seedPatientIds) {
    const total = appointments.filter((a) => a.patient_id === pid).length
    const noShows = appointments.filter((a) => a.patient_id === pid && a.status === 'no_show').length
    await supabase
      .from('patients')
      .update({
        total_appointments: total,
        no_show_count: noShows,
        no_show_probability: total > 0 ? Math.round((noShows / total) * 100) / 100 : 0,
      })
      .eq('id', pid)
  }
  console.log('  Estadísticas de pacientes actualizadas')

  // ========================
  // CARTERA (6 entradas)
  // ========================
  console.log('\nInsertando 6 entradas de cartera...')
  const carteraData = [
    { days: 5, amount: 80000, treatment: 'Consulta general', payment: 'Particular' },
    { days: 12, amount: 150000, treatment: 'Ecografía obstétrica', payment: 'EPS' },
    { days: 18, amount: 120000, treatment: 'Control prenatal', payment: 'Póliza' },
    { days: 31, amount: 250000, treatment: 'Chequeo pediátrico + vacunas', payment: 'EPS' },
    { days: 45, amount: 350000, treatment: 'Citología + exámenes', payment: 'Particular' },
    { days: 52, amount: 500000, treatment: 'Valoración ginecológica completa', payment: 'ARL' },
  ]

  const carteraEntries = carteraData.map((c, i) => ({
    id: uuid(),
    clinic_id: clinicId,
    patient_id: seedPatientIds[i % seedPatientIds.length],
    appointment_id: appointmentIds[i] || null,
    amount: c.amount,
    days_overdue: c.days,
    treatment: c.treatment,
    payment_type: c.payment,
    collection_attempts: c.days > 30 ? Math.floor(c.days / 15) : c.days > 10 ? 1 : 0,
    last_collection_at: c.days > 10 ? cotDate(-Math.floor(c.days / 2), 10) : null,
    status: 'pendiente',
    notes: c.days > 30 ? 'Paciente indica que paga la próxima semana' : null,
  }))

  const { error: cartErr } = await supabase.from('cartera').insert(carteraEntries)
  if (cartErr) throw cartErr
  console.log(`  6 entradas de cartera insertadas (${formatCOP(carteraData.reduce((s, c) => s + c.amount, 0))} total)`)

  // ========================
  // LISTA DE ESPERA (4 pacientes)
  // ========================
  console.log('\nInsertando 4 entradas de lista de espera...')
  const today = new Date()
  const nextWeek = (d) => {
    const dt = new Date(today)
    dt.setDate(dt.getDate() + d)
    return dt.toISOString().slice(0, 10)
  }

  const waitlistEntries = [
    {
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[3],
      doctor_id: doctorId,
      preferred_dates: [nextWeek(2), nextWeek(3), nextWeek(4)],
      preferred_time: 'morning',
      reason: 'Dolor abdominal persistente',
      status: 'waiting',
    },
    {
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[7],
      doctor_id: doctorId,
      preferred_dates: [nextWeek(5), nextWeek(6)],
      preferred_time: 'afternoon',
      reason: 'Control prenatal mes 7',
      status: 'waiting',
    },
    {
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[10],
      doctor_id: doctorId,
      preferred_dates: [nextWeek(1), nextWeek(2)],
      preferred_time: 'any',
      reason: 'Chequeo ginecológico anual',
      status: 'notified',
      notified_at: cotDate(-1, 14),
    },
    {
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[13],
      doctor_id: doctorId,
      preferred_dates: [nextWeek(3), nextWeek(7)],
      preferred_time: 'morning',
      reason: 'Vacunas niño 2 años',
      status: 'waiting',
    },
  ]

  const { error: waitErr } = await supabase.from('waitlist').insert(waitlistEntries)
  if (waitErr) throw waitErr
  console.log('  4 entradas de lista de espera insertadas')

  // ========================
  // CONVERSACIONES (5 con mensajes)
  // ========================
  console.log('\nInsertando 5 conversaciones con mensajes...')

  const conversations = [
    {
      // Conversación 1: Agendar cita exitosa
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[0],
      whatsapp_phone: PATIENT_DATA[0].phone,
      status: 'resolved',
      messages: [
        { role: 'patient', content: 'Buenas tardes, quiero pedir una cita por favor' },
        { role: 'agent', content: '¡Hola María Camila! Con gusto te ayudo a agendar tu cita. ¿Con qué especialidad la necesitas?' },
        { role: 'patient', content: 'Es para una consulta general, me he sentido mal últimamente' },
        { role: 'agent', content: '¡Perfecto! Tenemos disponibilidad mañana a las 9:00 AM o a las 2:00 PM con la Dra. Carolina Montoya. ¿Cuál te queda mejor?' },
        { role: 'patient', content: 'A las 2 de la tarde me sirve' },
        { role: 'agent', content: 'Listo, te confirmo:\n\n✅ Cita agendada:\n📅 Mañana\n🕐 2:00 PM\n👩\u200d⚕️ Dra. Carolina Montoya\n📍 Los Puchis\n\nSi necesitas cambiar algo, escríbeme. ¡Nos vemos!' },
        { role: 'patient', content: 'Muchas gracias!' },
      ],
    },
    {
      // Conversación 2: Preguntas frecuentes
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[2],
      whatsapp_phone: PATIENT_DATA[2].phone,
      status: 'resolved',
      messages: [
        { role: 'patient', content: 'Hola, ¿cuánto cuesta una consulta?' },
        { role: 'agent', content: '¡Hola Valentina! La consulta de medicina general tiene un costo de $80.000 COP. ¿Te gustaría agendar una?' },
        { role: 'patient', content: '¿Y aceptan EPS?' },
        { role: 'agent', content: 'Sí, trabajamos con Sura, Compensar, Nueva EPS y Sanitas. También atendemos consulta particular.' },
        { role: 'patient', content: '¿Qué especialidades manejan?' },
        { role: 'agent', content: 'Manejamos Medicina General, Ginecología y Pediatría. ¿Te gustaría agendar cita con alguna especialidad?' },
        { role: 'patient', content: 'Gracias, lo voy a pensar' },
        { role: 'agent', content: 'Con gusto, quedo atenta por si te decides. ¡Que tengas buen día!' },
      ],
    },
    {
      // Conversación 3: Cancelación de cita
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[5],
      whatsapp_phone: PATIENT_DATA[5].phone,
      status: 'resolved',
      messages: [
        { role: 'patient', content: 'Hola necesito cancelar mi cita de mañana' },
        { role: 'agent', content: '¡Hola Andrés! Veo que tienes una cita mañana a las 10:30 AM para control de presión. ¿Estás seguro de que deseas cancelarla?' },
        { role: 'patient', content: 'Si, me salió un viaje de trabajo' },
        { role: 'agent', content: 'Entendido, ya cancelé tu cita. ¿Te gustaría reagendarla para otro día?' },
        { role: 'patient', content: 'Si, para la otra semana si hay espacio' },
        { role: 'agent', content: 'La próxima semana tenemos disponible el martes a las 9:00 AM o el jueves a las 3:00 PM. ¿Cuál prefieres?' },
        { role: 'patient', content: 'El jueves a las 3' },
        { role: 'agent', content: '✅ Cita reagendada:\n📅 Jueves\n🕐 3:00 PM\n👩\u200d⚕️ Dra. Carolina Montoya\n📍 Los Puchis\n\n¡Listo! Ahí te esperamos.' },
      ],
    },
    {
      // Conversación 4: Escalamiento a humano
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[8],
      whatsapp_phone: PATIENT_DATA[8].phone,
      status: 'escalated',
      escalated_to: 'Dra. Carolina Montoya',
      escalated_at: cotDate(-2, 16),
      messages: [
        { role: 'patient', content: 'Hola, estoy embarazada y tengo un sangrado leve, estoy muy asustada' },
        { role: 'agent', content: '¡Hola Isabella! Entiendo tu preocupación. ¿Cuántas semanas de embarazo tienes? Si el sangrado es abundante o tienes dolor fuerte, ve a urgencias de inmediato.' },
        { role: 'patient', content: 'Tengo 12 semanas y el sangrado es poquito pero necesito hablar con la doctora' },
        { role: 'agent', content: 'Entiendo. Voy a comunicar tu caso a la Dra. Montoya para que te contacte lo antes posible. Mientras tanto, reposa y si el sangrado aumenta, ve a urgencias.' },
        { role: 'staff', content: 'Isabella, soy la Dra. Montoya. Puedo atenderte hoy a las 5:00 PM como urgencia. ¿Puedes venir?' },
        { role: 'patient', content: 'Si doctora, muchas gracias, ya salgo para allá' },
      ],
    },
    {
      // Conversación 5: Activa — paciente preguntando por chequeo pediátrico
      id: uuid(),
      clinic_id: clinicId,
      patient_id: seedPatientIds[11],
      whatsapp_phone: PATIENT_DATA[11].phone,
      status: 'active',
      messages: [
        { role: 'patient', content: 'Buenas, necesito una cita de pediatría para mi hijo de 3 años' },
        { role: 'agent', content: '¡Hola Sebastián! Claro, con gusto. ¿Es para un control de crecimiento o tiene algún síntoma específico?' },
        { role: 'patient', content: 'Es para el control de los 3 años y las vacunas que le faltan' },
        { role: 'agent', content: 'Perfecto, el control pediátrico incluye revisión de crecimiento y desarrollo. Lo consulto con el consultorio para confirmar disponibilidad de vacunas. ¿Qué día te queda mejor?' },
      ],
    },
  ]

  for (const conv of conversations) {
    const { messages, ...convData } = conv
    convData.last_message_at = cotDate(-Math.floor(Math.random() * 10), 14)

    const { error: convErr } = await supabase.from('conversations').insert(convData)
    if (convErr) throw convErr

    const msgs = messages.map((m, i) => ({
      id: uuid(),
      conversation_id: conv.id,
      role: m.role,
      content: m.content,
      message_type: 'text',
      // Esparcir mensajes con 1-3 minutos entre cada uno
      created_at: new Date(Date.now() - (messages.length - i) * 90000).toISOString(),
    }))

    const { error: msgErr } = await supabase.from('messages').insert(msgs)
    if (msgErr) throw msgErr
  }

  console.log('  5 conversaciones insertadas con mensajes')

  // ========================
  // RESUMEN
  // ========================
  console.log('\n========================================')
  console.log('  SEED COMPLETADO')
  console.log('========================================')
  console.log(`  Clínica:         ${clinicId}`)
  console.log(`  Pacientes:       15`)
  console.log(`  Citas:           ${appointments.length}`)
  console.log(`    - Completadas: ${appointments.filter((a) => a.status === 'completed').length}`)
  console.log(`    - No-show:     ${noShowCount}`)
  console.log(`    - Canceladas:  ${cancelledCount}`)
  console.log(`    - Pendientes:  ${pendingCount}`)
  console.log(`  Cartera:         6 (${formatCOP(carteraData.reduce((s, c) => s + c.amount, 0))})`)
  console.log(`  Lista espera:    4`)
  console.log(`  Conversaciones:  5`)
  console.log('========================================\n')
}

main().catch((err) => {
  console.error('\nError:', err.message || err)
  process.exit(1)
})
