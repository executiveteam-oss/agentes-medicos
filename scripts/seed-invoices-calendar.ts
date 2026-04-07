// ============================================================
// Seed: Invoices + Calendar data for Los Puchis
// Run with: npx tsx scripts/seed-invoices-calendar.ts
// ============================================================

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const DOC_CAROLINA = 'b97cc7e1-e49b-434e-9475-50e6fe2df545'
const DOC_MARTA = '8b5b8590-4570-46c3-973f-ad2c27524a36'
const DOCTORS = [DOC_CAROLINA, DOC_MARTA]

// Patient IDs from the DB
const PATIENTS = [
  '8381fd0c-4d76-42de-a606-60703aa872ac', // María Camila Rodríguez
  'b17fd651-3536-4c6d-ae14-f97b9a1d1031', // Mariana Álvarez
  '6f94f36b-b559-4bcc-8f17-6154d86c6b51', // Julián Esteban Ochoa
  'bb9c9101-b9b9-4b3c-b69b-0dbc6dbed8cb', // Diego Alejandro Ríos
  '478af1c5-6b04-42d7-8c45-02581fecaba5', // Juan David Gómez
  '922f3e66-7dff-4d89-bb47-596673316289', // Isabella García
  '3b26855a-883f-4ad5-91d5-8be7cd3273d9', // Carlos Alberto López
  '7a9fbd03-e751-466e-a1df-b5e990076e57', // Daniela Castaño
  'a12722fd-cba3-42e0-bcef-e2905a731f33', // Santiago Mejía
  'a86ca09f-3529-4b4b-94a1-9e10ca8d735d', // Sebastián Arango
  'e2a41002-f5f8-403e-8d85-763155ccc9b7', // Andrés Felipe Muñoz
  '14c2a908-f679-432a-aff0-f31a5e8a9e23', // Laura Sofía Pérez
  '91834a66-5146-4dd9-a8af-aa29a98202ee', // Natalia Rendón
  'c86ae845-d0e6-4660-90a1-02ff1b74fd60', // Camila Andrea Vargas
  '25e48f4b-9eb3-40da-950e-81de1cf53bf9', // Ana Lucía Ospina
  '45c95fe4-1bc2-4719-90b7-71b6bf950cde', // Miguel Ángel Torres
  'b0b03036-4814-4beb-bce5-e553b4a45c41', // Paula Andrea Gómez
  'aad4cc42-085e-44b8-94e9-77bdbdef43f0', // Jorge Enrique Salazar
  '3aaa2f1f-f199-45fe-ab91-68a537318485', // Catalina Mejía
  'dd48ecee-516d-4821-a98f-eb50490f672d', // Fernando Alzate
  'a1b25eef-e530-4c40-a36e-6fa584e977c7', // Luz Marina Henao
  '615e4b1b-7c69-4200-a773-3a79a4d6e0ce', // Ricardo Andrés Botero
  '2728c473-4402-483d-9646-bf8996f4e2de', // Marta Lucía Giraldo
  '45b975c9-3659-495a-8516-0261c73f44f7', // Héctor Fabio Ramírez
  'eedb83d5-3adf-49a6-ad4d-9c3b35b46cd2', // Juliana Montoya
  'dacf9bd5-24e9-46a2-99ae-2e19ef9d7303', // Sofía Restrepo
  'ac601469-5df4-4823-a5ca-8de17128c195', // Tomás Felipe Arias
  '4f141841-33f1-4d4c-b51e-8ba3dc6e3f5f', // Valentina Correa
  '9cd830bd-8f80-471b-a1e4-af911146b986', // Andrés Camilo Mejía
]

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

function daysAgoDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function futureAt(daysAhead: number, hour: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(hour + 5, 0, 0, 0) // +5 for UTC (Colombia is -5)
  return d.toISOString()
}

function todayAt(hour: number): string {
  const d = new Date()
  d.setHours(hour + 5, 0, 0, 0)
  return d.toISOString()
}

function endTime(starts: string): string {
  return new Date(new Date(starts).getTime() + 30 * 60000).toISOString()
}

function futureDow(daysAhead: number): number {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.getDay()
}

async function main() {
  console.log('🏥 Seeding invoices + calendar for Los Puchis...\n')

  // ==================== 1. INVOICES ====================
  console.log('📄 Creating 15 standalone invoices...')

  const invoices = [
    // 5 COBRADA (paid, last 60 days)
    {
      clinic_id: CID, patient_id: PATIENTS[0], invoice_number: 'FE-2026-001',
      invoice_date: daysAgoDate(5), invoice_amount: 120000,
      payment_type: 'Particular', collection_status: 'cobrada',
      observations: 'Consulta general — pagado en efectivo',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[1], invoice_number: 'FE-2026-002',
      invoice_date: daysAgoDate(12), invoice_amount: 180000,
      payment_type: 'Particular', collection_status: 'cobrada',
      observations: 'Ecografía obstétrica — transferencia Nequi',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[2], invoice_number: 'FE-2026-003',
      invoice_date: daysAgoDate(22), invoice_amount: 95000,
      payment_type: 'Particular', collection_status: 'cobrada',
      observations: 'Control prenatal — efectivo',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[3], invoice_number: 'FE-2026-004',
      invoice_date: daysAgoDate(35), invoice_amount: 250000,
      payment_type: 'EPS', eps_name: 'Sura', collection_status: 'cobrada',
      observations: 'Valoración ginecológica + exámenes — EPS pagó',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[4], invoice_number: 'FE-2026-005',
      invoice_date: daysAgoDate(48), invoice_amount: 80000,
      payment_type: 'EPS', eps_name: 'Nueva EPS', collection_status: 'cobrada',
      observations: 'Consulta general — cobrado a EPS',
    },

    // 4 EN_TRAMITE (EPS, 15-40 days, waiting)
    {
      clinic_id: CID, patient_id: PATIENTS[5], invoice_number: 'FE-2026-006',
      invoice_date: daysAgoDate(15), invoice_amount: 180000,
      payment_type: 'EPS', eps_name: 'Compensar', collection_status: 'en_tramite',
      observations: 'Radicada el ' + daysAgoDate(14) + ' — pendiente respuesta EPS',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[6], invoice_number: 'FE-2026-007',
      invoice_date: daysAgoDate(22), invoice_amount: 320000,
      payment_type: 'EPS', eps_name: 'Sura', collection_status: 'en_tramite',
      observations: 'Procedimiento ginecológico — en trámite con Sura',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[7], invoice_number: 'FE-2026-008',
      invoice_date: daysAgoDate(30), invoice_amount: 150000,
      payment_type: 'EPS', eps_name: 'Nueva EPS', collection_status: 'en_tramite',
      observations: 'Ecografía — radicada, esperando pago',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[8], invoice_number: 'FE-2026-009',
      invoice_date: daysAgoDate(38), invoice_amount: 200000,
      payment_type: 'EPS', eps_name: 'Compensar', collection_status: 'en_tramite',
      observations: 'Control + exámenes — en trámite Compensar',
    },

    // 3 GLOSADA (EPS objected)
    {
      clinic_id: CID, patient_id: PATIENTS[9], invoice_number: 'FE-2026-010',
      invoice_date: daysAgoDate(28), invoice_amount: 280000,
      payment_type: 'EPS', eps_name: 'Sura', collection_status: 'glosada',
      observations: 'GLOSADA por Sura — Motivo: Tarifa superior a la pactada. Glosa: $120.000. Notificación: ' + daysAgoDate(12) + '. Estado: pendiente de respuesta.',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[10], invoice_number: 'FE-2026-011',
      invoice_date: daysAgoDate(35), invoice_amount: 350000,
      payment_type: 'EPS', eps_name: 'Compensar', collection_status: 'glosada',
      observations: 'GLOSADA por Compensar — Motivo: Falta autorización previa. Glosa: $350.000 (total). Notificación: ' + daysAgoDate(18) + '. Se requiere reenviar autorización.',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[11], invoice_number: 'FE-2026-012',
      invoice_date: daysAgoDate(42), invoice_amount: 190000,
      payment_type: 'EPS', eps_name: 'Nueva EPS', collection_status: 'glosada',
      observations: 'GLOSADA por Nueva EPS — Motivo: Falta autorización previa. Glosa: $95.000. Notificación: ' + daysAgoDate(15) + '. Estado: pendiente.',
    },

    // 2 VENCIDA (overdue >60 days)
    {
      clinic_id: CID, patient_id: PATIENTS[12], invoice_number: 'FE-2026-013',
      invoice_date: daysAgoDate(72), invoice_amount: 240000,
      payment_type: 'EPS', eps_name: 'Compensar', collection_status: 'vencida',
      observations: 'Vencida — múltiples intentos de cobro sin respuesta de Compensar',
    },
    {
      clinic_id: CID, patient_id: PATIENTS[13], invoice_number: 'FE-2026-014',
      invoice_date: daysAgoDate(85), invoice_amount: 160000,
      payment_type: 'Particular', collection_status: 'vencida',
      observations: 'Vencida — paciente no responde llamadas ni WhatsApp desde hace 2 meses',
    },

    // 1 PENDIENTE
    {
      clinic_id: CID, patient_id: PATIENTS[14], invoice_number: 'FE-2026-015',
      invoice_date: daysAgoDate(3), invoice_amount: 120000,
      payment_type: 'Particular', collection_status: 'pendiente',
      observations: 'Consulta reciente — pendiente de cobro',
    },
  ]

  const { data: invData, error: invErr } = await sb.from('invoices').insert(invoices).select('id, invoice_number')
  if (invErr) { console.error('Invoice insert error:', invErr); return }
  console.log(`  ✅ ${invData!.length} invoices created`)

  // Summary
  const statusCount: Record<string, number> = {}
  invoices.forEach(i => { statusCount[i.collection_status] = (statusCount[i.collection_status] || 0) + 1 })
  console.log('  Statuses:', JSON.stringify(statusCount))
  const totalAmount = invoices.reduce((s, i) => s + i.invoice_amount, 0)
  console.log(`  Total invoiced: $${totalAmount.toLocaleString('es-CO')} COP`)

  // ==================== 2. CALENDAR — Future appointments ====================
  console.log('\n📅 Creating future appointments (next 14 days)...')

  const futureApts: Array<Record<string, unknown>> = []

  // a) TODAY: 3 special appointments
  // 1 confirmed (morning, hasn't happened yet — say 3pm COT = 20:00 UTC)
  const todayConfirmed = todayAt(15)
  futureApts.push({
    clinic_id: CID, doctor_id: DOC_CAROLINA, patient_id: PATIENTS[15],
    starts_at: todayConfirmed, ends_at: endTime(todayConfirmed),
    status: 'confirmed', payment_type: 'Particular', source: 'whatsapp_agent',
    glosa_status: 'none', glosa_value: 0,
  })

  // 1 confirmed (afternoon, pending)
  const todayPending = todayAt(16)
  futureApts.push({
    clinic_id: CID, doctor_id: DOC_MARTA, patient_id: PATIENTS[16],
    starts_at: todayPending, ends_at: endTime(todayPending),
    status: 'confirmed', payment_type: 'EPS', eps_name: 'Sura', source: 'dashboard',
    glosa_status: 'none', glosa_value: 0,
  })

  // 1 no-show (earlier this morning — 8am COT = 13:00 UTC)
  const todayNoShow = todayAt(8)
  futureApts.push({
    clinic_id: CID, doctor_id: DOC_CAROLINA, patient_id: PATIENTS[17],
    starts_at: todayNoShow, ends_at: endTime(todayNoShow),
    status: 'no_show', payment_type: 'Particular', source: 'whatsapp_agent',
    glosa_status: 'none', glosa_value: 0,
  })

  // b) NEXT 14 DAYS: ~35 appointments with patterns
  // Tue/Thu: 6-7 per day (busy), Mon/Wed/Fri: 3-4 (lighter), Sat: 2
  const morningHours = [7, 8, 9, 10, 11]
  const afternoonHours = [13, 14, 15, 16]
  let aptCount = 0
  let usedPatientIdx = 18 // start cycling through remaining patients

  for (let day = 1; day <= 14; day++) {
    const dow = futureDow(day)
    if (dow === 0) continue // skip Sunday

    let slotsForDay: number
    if (dow === 2 || dow === 4) { // Tue, Thu — busy
      slotsForDay = 6 + (Math.random() < 0.5 ? 1 : 0) // 6-7
    } else if (dow === 6) { // Saturday — light
      slotsForDay = 2
    } else { // Mon, Wed, Fri
      slotsForDay = 3 + (Math.random() < 0.5 ? 1 : 0) // 3-4
    }

    // Distribute: ~60% morning, 40% afternoon
    const morningCount = Math.ceil(slotsForDay * 0.6)
    const afternoonCount = slotsForDay - morningCount

    // Morning slots
    const usedMorning = new Set<number>()
    for (let i = 0; i < morningCount; i++) {
      let hour: number
      do { hour = pick(morningHours) } while (usedMorning.has(hour))
      usedMorning.add(hour)

      const patientId = PATIENTS[usedPatientIdx % PATIENTS.length]
      usedPatientIdx++
      const isEps = Math.random() < 0.3
      const starts = futureAt(day, hour)

      futureApts.push({
        clinic_id: CID,
        doctor_id: pick(DOCTORS),
        patient_id: patientId,
        starts_at: starts,
        ends_at: endTime(starts),
        status: 'confirmed',
        payment_type: isEps ? 'EPS' : 'Particular',
        eps_name: isEps ? pick(['Sura', 'Compensar', 'Nueva EPS']) : null,
        source: pick(['whatsapp_agent', 'dashboard', 'manual']),
        glosa_status: 'none',
        glosa_value: 0,
      })
      aptCount++
    }

    // Afternoon slots
    const usedAfternoon = new Set<number>()
    for (let i = 0; i < afternoonCount; i++) {
      let hour: number
      do { hour = pick(afternoonHours) } while (usedAfternoon.has(hour))
      usedAfternoon.add(hour)

      const patientId = PATIENTS[usedPatientIdx % PATIENTS.length]
      usedPatientIdx++
      const isEps = Math.random() < 0.3
      const starts = futureAt(day, hour)

      futureApts.push({
        clinic_id: CID,
        doctor_id: pick(DOCTORS),
        patient_id: patientId,
        starts_at: starts,
        ends_at: endTime(starts),
        status: 'confirmed',
        payment_type: isEps ? 'EPS' : 'Particular',
        eps_name: isEps ? pick(['Sura', 'Compensar', 'Nueva EPS']) : null,
        source: pick(['whatsapp_agent', 'dashboard']),
        glosa_status: 'none',
        glosa_value: 0,
      })
      aptCount++
    }
  }

  const { data: aptData, error: aptErr } = await sb.from('appointments').insert(futureApts).select('id')
  if (aptErr) { console.error('Appointment insert error:', aptErr); return }
  console.log(`  ✅ ${aptData!.length} appointments created (3 today + ${aptCount} future)`)

  // Day-by-day breakdown
  const dayCounts: Record<string, number> = {}
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  for (const apt of futureApts) {
    const d = new Date(apt.starts_at as string)
    const colDate = new Date(d.getTime() - 5 * 60 * 60 * 1000)
    const label = dayNames[colDate.getDay()] + ' ' + colDate.toISOString().slice(5, 10)
    dayCounts[label] = (dayCounts[label] || 0) + 1
  }
  console.log('  By day:')
  Object.entries(dayCounts).forEach(([k, v]) => console.log(`    ${k}: ${v} citas`))

  // ==================== 3. WAITLIST ====================
  console.log('\n⏰ Adding 2 waitlist entries...')

  const waitlist = [
    {
      clinic_id: CID,
      patient_id: PATIENTS[20],
      preferred_dates: [futureAt(2, 0).slice(0, 10), futureAt(4, 0).slice(0, 10)],
      preferred_time: 'mañana',
      reason: 'Control prenatal urgente',
      status: 'waiting',
      priority: 'high',
      source: 'whatsapp',
      consultation_type_name: 'Control prenatal',
    },
    {
      clinic_id: CID,
      patient_id: PATIENTS[22],
      preferred_dates: [futureAt(3, 0).slice(0, 10)],
      preferred_time: 'tarde',
      reason: 'Ecografía de seguimiento',
      status: 'waiting',
      priority: 'normal',
      source: 'whatsapp',
      consultation_type_name: 'Ecografía',
    },
  ]

  const { error: wlErr } = await sb.from('waitlist').insert(waitlist)
  if (wlErr) console.error('  Waitlist error:', wlErr)
  else console.log('  ✅ 2 waitlist entries created')

  // ==================== SUMMARY ====================
  console.log('\n' + '='.repeat(50))
  console.log('✅ SEED COMPLETE — SUMMARY')
  console.log('='.repeat(50))

  const { count: totalInvoices } = await sb.from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
  const { count: totalFuture } = await sb.from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
    .gte('starts_at', new Date().toISOString().slice(0, 10))
  const { count: totalWaitlist } = await sb.from('waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
    .eq('status', 'waiting')

  console.log(`\n  Invoices: ${totalInvoices}`)
  console.log(`  Future/today appointments: ${totalFuture}`)
  console.log(`  Waitlist (waiting): ${totalWaitlist}`)

  // Invoice financial summary
  const epsInTramite = invoices.filter(i => i.collection_status === 'en_tramite').reduce((s, i) => s + i.invoice_amount, 0)
  const glosadaTotal = invoices.filter(i => i.collection_status === 'glosada').reduce((s, i) => s + i.invoice_amount, 0)
  const vencidaTotal = invoices.filter(i => i.collection_status === 'vencida').reduce((s, i) => s + i.invoice_amount, 0)
  console.log(`\n  Invoice breakdown:`)
  console.log(`    Cobradas: $${invoices.filter(i => i.collection_status === 'cobrada').reduce((s, i) => s + i.invoice_amount, 0).toLocaleString('es-CO')}`)
  console.log(`    En trámite EPS: $${epsInTramite.toLocaleString('es-CO')}`)
  console.log(`    Glosadas: $${glosadaTotal.toLocaleString('es-CO')}`)
  console.log(`    Vencidas: $${vencidaTotal.toLocaleString('es-CO')}`)
  console.log(`    Pendiente: $120.000`)
  console.log('')
}

main().catch(console.error)
