// ============================================================
// Seed script: Rich demo data for Omuwan Insights
// Clinic: Los Puchis (e7cc72ca-30d1-4b59-bebc-e340c09f3507)
// Run with: npx tsx scripts/seed-insights-demo.ts
// ============================================================

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const DOC_CAROLINA = 'b97cc7e1-e49b-434e-9475-50e6fe2df545'
const DOC_MARTA = '8b5b8590-4570-46c3-973f-ad2c27524a36'

// Helper: Colombian datetime string from days ago + hour
function daysAgoAt(daysAgo: number, hour: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour + 5, 0, 0, 0) // +5 for UTC offset (Colombia is -5)
  return d.toISOString()
}

function endTime(startsAt: string, durationMin: number): string {
  return new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString()
}

// Get day of week for a daysAgo value (0=Sun, 1=Mon, ... 5=Fri)
function dayOfWeek(daysAgo: number): number {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.getDay()
}

async function main() {
  console.log('🏥 Seeding demo data for Los Puchis...\n')

  // ==================== 1. NEW PATIENTS ====================
  console.log('👥 Creating 25 new patients...')

  const newPatients = [
    // 8 LOYAL patients (3+ visits each) — will get appointments below
    { name: 'Ana Lucía Ospina Restrepo', phone: '+573001112201', eps: null, document_type: 'CC', document_number: '1088300101', date_of_birth: '1985-03-12' },
    { name: 'Miguel Ángel Torres Bedoya', phone: '+573001112202', eps: null, document_type: 'CC', document_number: '1088300102', date_of_birth: '1978-11-25' },
    { name: 'Paula Andrea Gómez Marín', phone: '+573001112203', eps: null, document_type: 'CC', document_number: '1088300103', date_of_birth: '1992-06-18' },
    { name: 'Jorge Enrique Salazar Ruiz', phone: '+573001112204', eps: null, document_type: 'CC', document_number: '1088300104', date_of_birth: '1970-01-30' },
    { name: 'Catalina Mejía Aristizábal', phone: '+573001112205', eps: 'Sura', document_type: 'CC', document_number: '1088300105', date_of_birth: '1988-09-07' },
    { name: 'Fernando Alzate Cardona', phone: '+573001112206', eps: null, document_type: 'CC', document_number: '1088300106', date_of_birth: '1982-04-22' },
    { name: 'Luz Marina Henao Vélez', phone: '+573001112207', eps: 'Compensar', document_type: 'CC', document_number: '1088300107', date_of_birth: '1975-12-01' },
    { name: 'Ricardo Andrés Botero Ossa', phone: '+573001112208', eps: null, document_type: 'CC', document_number: '1088300108', date_of_birth: '1990-07-15' },

    // 6 CHURNED patients (1 visit, >90 days ago, never returned)
    { name: 'Sandra Milena Cano Duque', phone: '+573001112209', eps: null, document_type: 'CC', document_number: '1088300109', date_of_birth: '1983-02-14' },
    { name: 'Alejandro Ríos Montoya', phone: '+573001112210', eps: 'Nueva EPS', document_type: 'CC', document_number: '1088300110', date_of_birth: '1995-08-20' },
    { name: 'Gloria Inés Zapata Rojas', phone: '+573001112211', eps: null, document_type: 'CC', document_number: '1088300111', date_of_birth: '1968-05-03' },
    { name: 'Felipe Arango Castro', phone: '+573001112212', eps: null, document_type: 'CC', document_number: '1088300112', date_of_birth: '1991-10-11' },
    { name: 'Diana Marcela Orozco Gil', phone: '+573001112213', eps: 'Sura', document_type: 'CC', document_number: '1088300113', date_of_birth: '1987-03-28' },
    { name: 'Óscar Iván Quintero Bedoya', phone: '+573001112214', eps: null, document_type: 'CC', document_number: '1088300114', date_of_birth: '1979-11-17' },

    // 5 EPS patients
    { name: 'Marta Lucía Giraldo Henao', phone: '+573001112215', eps: 'Sura', document_type: 'CC', document_number: '1088300115', date_of_birth: '1986-07-09' },
    { name: 'Héctor Fabio Ramírez Marín', phone: '+573001112216', eps: 'Compensar', document_type: 'CC', document_number: '1088300116', date_of_birth: '1973-09-14' },
    { name: 'Yolanda Patricia Arias Mesa', phone: '+573001112217', eps: 'Nueva EPS', document_type: 'CC', document_number: '1088300117', date_of_birth: '1965-12-22' },
    { name: 'Esteban Arboleda López', phone: '+573001112218', eps: 'Sura', document_type: 'CC', document_number: '1088300118', date_of_birth: '1994-04-05' },
    { name: 'Claudia Patricia Suáza Vallejo', phone: '+573001112219', eps: 'Compensar', document_type: 'CC', document_number: '1088300119', date_of_birth: '1980-08-30' },

    // 6 NEW patients (first visit in last 2 weeks)
    { name: 'Juliana Montoya Salazar', phone: '+573001112220', eps: null, document_type: 'CC', document_number: '1088300120', date_of_birth: '1998-01-16' },
    { name: 'Camilo Andrés Duque Ramírez', phone: '+573001112221', eps: null, document_type: 'CC', document_number: '1088300121', date_of_birth: '2000-06-29' },
    { name: 'Sofía Restrepo Castaño', phone: '+573001112222', eps: 'Sura', document_type: 'CC', document_number: '1088300122', date_of_birth: '1996-11-03' },
    { name: 'Tomás Felipe Arias Gómez', phone: '+573001112223', eps: null, document_type: 'CC', document_number: '1088300123', date_of_birth: '1993-03-21' },
    { name: 'Valentina Correa Zapata', phone: '+573001112224', eps: null, document_type: 'CC', document_number: '1088300124', date_of_birth: '1989-07-08' },
    { name: 'Andrés Camilo Mejía Restrepo', phone: '+573001112225', eps: 'Nueva EPS', document_type: 'CC', document_number: '1088300125', date_of_birth: '2001-09-12' },
  ]

  const patientRows = newPatients.map((p) => ({
    clinic_id: CID,
    name: p.name,
    phone: p.phone,
    eps: p.eps,
    document_type: p.document_type,
    document_number: p.document_number,
    date_of_birth: p.date_of_birth,
    total_appointments: 0,
    no_show_count: 0,
    data_consent_at: new Date().toISOString(),
  }))

  const { data: insertedPatients, error: pErr } = await sb.from('patients').insert(patientRows).select('id, name, phone')
  if (pErr) { console.error('Patient insert error:', pErr); return }
  console.log(`  ✅ ${insertedPatients!.length} patients created`)

  // Build patient lookup
  const pMap: Record<string, string> = {}
  for (const p of insertedPatients!) {
    pMap[p.phone] = p.id
  }

  // Also get existing patients
  const { data: existingPatients } = await sb.from('patients').select('id, name, phone').eq('clinic_id', CID)
  for (const p of existingPatients ?? []) {
    if (!pMap[p.phone]) pMap[p.phone] = p.id
  }

  // Categorize new patients by phone
  const loyalIds = newPatients.slice(0, 8).map(p => pMap[p.phone])
  const churnedIds = newPatients.slice(8, 14).map(p => pMap[p.phone])
  const epsIds = newPatients.slice(14, 19).map(p => pMap[p.phone])
  const freshIds = newPatients.slice(19, 25).map(p => pMap[p.phone])

  // ==================== 2. APPOINTMENTS ====================
  console.log('\n📅 Creating ~80 appointments with specific patterns...')

  const appointments: Array<{
    clinic_id: string
    doctor_id: string
    patient_id: string
    starts_at: string
    ends_at: string
    status: string
    payment_type: string
    source: string
    nps_score?: number | null
    invoice_status?: string
    invoice_number?: string | null
    eps_name?: string | null
    glosa_status?: string
    glosa_value?: number | null
    cancelled_at?: string | null
  }> = []

  // Helper to pick random element
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
  const doctors = [DOC_CAROLINA, DOC_MARTA]

  // --- A) LOYAL patients: 3-5 visits each, spread over last 90 days ---
  for (let i = 0; i < loyalIds.length; i++) {
    const pid = loyalIds[i]
    const numVisits = 3 + (i % 3) // 3, 4, 5, 3, 4, 5, 3, 4
    for (let v = 0; v < numVisits; v++) {
      const daysAgo = 10 + v * 22 + Math.floor(Math.random() * 5) // spread across months
      const hour = pick([8, 9, 10, 11, 14, 15, 16])
      const starts = daysAgoAt(daysAgo, hour)
      const payType = i < 5 ? 'Particular' : (i === 5 ? 'EPS' : 'Particular')
      appointments.push({
        clinic_id: CID,
        doctor_id: pick(doctors),
        patient_id: pid,
        starts_at: starts,
        ends_at: endTime(starts, 30),
        status: 'completed',
        payment_type: payType,
        source: 'whatsapp_agent',
        invoice_status: v === 0 && i < 4 ? 'pendiente' : 'pagada', // some unbilled
        invoice_number: v === 0 && i < 4 ? null : `FAC-${2026}${String(i).padStart(3, '0')}`,
        eps_name: payType === 'EPS' ? 'Sura' : null,
      })
    }
  }

  // --- B) CHURNED patients: exactly 1 visit, 95-120 days ago ---
  for (let i = 0; i < churnedIds.length; i++) {
    const daysAgo = 95 + i * 5 // 95, 100, 105, 110, 115, 120
    const hour = pick([9, 10, 11, 14, 15])
    const starts = daysAgoAt(daysAgo, hour)
    appointments.push({
      clinic_id: CID,
      doctor_id: pick(doctors),
      patient_id: churnedIds[i],
      starts_at: starts,
      ends_at: endTime(starts, 30),
      status: 'completed',
      payment_type: i === 1 ? 'EPS' : 'Particular',
      source: 'whatsapp_agent',
      invoice_status: 'pagada',
      eps_name: i === 1 ? 'Nueva EPS' : null,
    })
  }

  // --- C) EPS patients: 2-3 visits, some glosadas ---
  for (let i = 0; i < epsIds.length; i++) {
    const numVisits = 2 + (i % 2) // 2, 3, 2, 3, 2
    for (let v = 0; v < numVisits; v++) {
      const daysAgo = 15 + v * 25 + Math.floor(Math.random() * 7)
      const hour = pick([8, 9, 10, 14, 15])
      const starts = daysAgoAt(daysAgo, hour)
      const isGlosada = i < 3 && v === 0 // 3 glosadas
      appointments.push({
        clinic_id: CID,
        doctor_id: pick(doctors),
        patient_id: epsIds[i],
        starts_at: starts,
        ends_at: endTime(starts, 30),
        status: 'completed',
        payment_type: 'EPS',
        source: 'whatsapp_agent',
        invoice_status: isGlosada ? 'glosada' : 'en_tramite',
        eps_name: newPatients[14 + i].eps,
        glosa_status: isGlosada ? 'pending' : 'none',
        glosa_value: isGlosada ? pick([80000, 95000, 120000]) : 0,
      })
    }
  }

  // --- D) FRESH patients: 1 visit in last 14 days ---
  for (let i = 0; i < freshIds.length; i++) {
    const daysAgo = 1 + i * 2 // 1, 3, 5, 7, 9, 11 days ago
    const hour = pick([9, 10, 11, 14, 15, 16])
    const starts = daysAgoAt(daysAgo, hour)
    appointments.push({
      clinic_id: CID,
      doctor_id: pick(doctors),
      patient_id: freshIds[i],
      starts_at: starts,
      ends_at: endTime(starts, 30),
      status: 'completed',
      payment_type: i === 2 ? 'EPS' : (i === 5 ? 'EPS' : 'Particular'),
      source: 'whatsapp_agent',
      invoice_status: 'pagada',
      eps_name: i === 2 ? 'Sura' : (i === 5 ? 'Nueva EPS' : null),
    })
  }

  // --- E) NO-SHOW PATTERN appointments ---
  // Mondays (35% no-show), Fridays afternoon (30%), others (10-12%)
  // Fill in remaining slots to reach ~80 new appointments total
  const currentAptCount = appointments.length
  const targetNew = 80
  const remaining = targetNew - currentAptCount

  for (let i = 0; i < remaining; i++) {
    // Pick a random day in the last 90 days
    const daysAgo = 2 + Math.floor(Math.random() * 88)
    const dow = dayOfWeek(daysAgo) // 0=Sun, 1=Mon, 5=Fri

    // Skip Sundays
    if (dow === 0) continue

    const isMorning = Math.random() > 0.4 // 60% morning bias
    const hour = isMorning ? pick([7, 8, 9, 10]) : pick([14, 15, 16])
    const starts = daysAgoAt(daysAgo, hour)

    // Determine status based on day/time pattern
    let status: string
    const rand = Math.random()
    if (dow === 1) { // Monday
      status = rand < 0.35 ? 'no_show' : 'completed'
    } else if (dow === 5 && hour >= 14) { // Friday afternoon
      status = rand < 0.30 ? 'no_show' : 'completed'
    } else {
      status = rand < 0.11 ? 'no_show' : (rand < 0.16 ? 'cancelled' : 'completed')
    }

    // Pick a random existing patient
    const allPatientIds = Object.values(pMap)
    const patientId = pick(allPatientIds)

    const payRand = Math.random()
    const paymentType = payRand < 0.6 ? 'Particular' : (payRand < 0.9 ? 'EPS' : 'Póliza')

    appointments.push({
      clinic_id: CID,
      doctor_id: pick(doctors),
      patient_id: patientId,
      starts_at: starts,
      ends_at: endTime(starts, 30),
      status,
      payment_type: paymentType,
      source: pick(['whatsapp_agent', 'dashboard', 'manual']),
      invoice_status: status === 'completed' ? (Math.random() < 0.15 ? 'pendiente' : 'pagada') : 'pendiente',
      invoice_number: status === 'completed' && Math.random() > 0.15 ? `FAC-${2026}${String(100 + i).padStart(4, '0')}` : null,
      eps_name: paymentType === 'EPS' ? pick(['Sura', 'Compensar', 'Nueva EPS', 'Sanitas']) : null,
      cancelled_at: status === 'cancelled' ? daysAgoAt(daysAgo + 1, 10) : null,
    })
  }

  // --- F) NPS scores: add to 8 specific appointments ---
  // 6 with nps 6-9, 2 with nps 4
  const npsScores = [4, 4, 6, 7, 7, 8, 8, 9]
  let npsIdx = 0
  for (const apt of appointments) {
    if (apt.status === 'completed' && npsIdx < npsScores.length) {
      apt.nps_score = npsScores[npsIdx]
      npsIdx++
    }
  }

  // Ensure glosa_status default for all appointments
  for (const apt of appointments) {
    if (!apt.glosa_status) apt.glosa_status = 'none'
    if (apt.glosa_value === undefined) apt.glosa_value = 0
  }

  // Insert appointments
  const { data: insertedApts, error: aErr } = await sb.from('appointments').insert(appointments).select('id')
  if (aErr) { console.error('Appointment insert error:', aErr); return }
  console.log(`  ✅ ${insertedApts!.length} appointments created`)

  // ==================== 3. CARTERA ENTRIES ====================
  console.log('\n💳 Creating 4 new cartera entries...')

  const carteraEntries = [
    {
      clinic_id: CID,
      patient_id: epsIds[1], // Héctor Fabio — Compensar
      amount: 180000,
      days_overdue: 38,
      treatment: 'Consulta especializada ginecología',
      payment_type: 'EPS',
      collection_attempts: 2,
      status: 'pendiente',
      notes: 'EPS Compensar — radicación enviada, sin respuesta',
    },
    {
      clinic_id: CID,
      patient_id: loyalIds[2], // Paula Andrea — Particular
      amount: 95000,
      days_overdue: 52,
      treatment: 'Control prenatal mes 6',
      payment_type: 'Particular',
      collection_attempts: 3,
      status: 'pendiente',
      notes: 'Paciente promete pagar cada semana, no cumple',
    },
    {
      clinic_id: CID,
      patient_id: epsIds[0], // Marta Lucía — Sura glosada
      amount: 240000,
      days_overdue: 15,
      treatment: 'Ecografía + valoración',
      payment_type: 'EPS',
      collection_attempts: 1,
      status: 'pendiente',
      notes: 'Glosada por EPS Sura — falta autorización previa',
    },
    {
      clinic_id: CID,
      patient_id: freshIds[0], // Juliana — Particular
      amount: 75000,
      days_overdue: 8,
      treatment: 'Consulta general primera vez',
      payment_type: 'Particular',
      collection_attempts: 0,
      status: 'pendiente',
    },
  ]

  const { error: cErr } = await sb.from('cartera').insert(carteraEntries)
  if (cErr) { console.error('Cartera insert error:', cErr); return }
  console.log('  ✅ 4 cartera entries created')

  // ==================== 4. UPDATE PATIENT STATS ====================
  console.log('\n📊 Updating patient appointment counts...')

  // Get all appointments for clinic to recount
  const { data: allApts } = await sb.from('appointments')
    .select('patient_id, status')
    .eq('clinic_id', CID)

  const patientStats: Record<string, { total: number; noShows: number }> = {}
  for (const a of allApts ?? []) {
    if (!a.patient_id) continue
    if (!patientStats[a.patient_id]) patientStats[a.patient_id] = { total: 0, noShows: 0 }
    if (['completed', 'no_show', 'confirmed', 'rescheduled'].includes(a.status)) {
      patientStats[a.patient_id].total++
    }
    if (a.status === 'no_show') {
      patientStats[a.patient_id].noShows++
    }
  }

  for (const [pid, stats] of Object.entries(patientStats)) {
    await sb.from('patients').update({
      total_appointments: stats.total,
      no_show_count: stats.noShows,
    }).eq('id', pid)
  }
  console.log(`  ✅ Updated stats for ${Object.keys(patientStats).length} patients`)

  // ==================== 5. ADD WAITLIST ENTRIES ====================
  console.log('\n⏰ Adding waitlist entries...')
  const waitlistEntries = [
    {
      clinic_id: CID,
      patient_id: churnedIds[0],
      patient_name: newPatients[8].name,
      patient_phone: newPatients[8].phone,
      preferred_date: daysAgoAt(-3, 9), // 3 days from now
      preferred_time_slot: 'mañana',
      status: 'waiting',
      source: 'whatsapp',
      priority: 'normal',
    },
    {
      clinic_id: CID,
      patient_id: churnedIds[2],
      patient_name: newPatients[10].name,
      patient_phone: newPatients[10].phone,
      preferred_date: daysAgoAt(-5, 14),
      preferred_time_slot: 'tarde',
      status: 'waiting',
      source: 'whatsapp',
      priority: 'high',
    },
  ]

  const { error: wErr } = await sb.from('waitlist').insert(waitlistEntries)
  if (wErr) console.error('Waitlist insert error:', wErr)
  else console.log('  ✅ 2 waitlist entries created')

  // ==================== SUMMARY ====================
  console.log('\n' + '='.repeat(50))
  console.log('✅ SEED COMPLETE')

  // Recount final stats
  const { count: totalApts } = await sb.from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
  const { count: totalPatients } = await sb.from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
  const { count: totalCartera } = await sb.from('cartera')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)

  // Status breakdown
  const { data: statusData } = await sb.from('appointments')
    .select('status')
    .eq('clinic_id', CID)
  const statusCounts: Record<string, number> = {}
  statusData?.forEach(a => statusCounts[a.status] = (statusCounts[a.status] || 0) + 1)

  console.log(`\n  Patients: ${totalPatients}`)
  console.log(`  Appointments: ${totalApts}`)
  console.log(`  Statuses: ${JSON.stringify(statusCounts)}`)
  console.log(`  Cartera: ${totalCartera}`)

  const completedNS = (statusCounts['completed'] || 0) + (statusCounts['no_show'] || 0)
  const nsRate = completedNS > 0 ? Math.round(((statusCounts['no_show'] || 0) / completedNS) * 100) : 0
  console.log(`  No-show rate: ${nsRate}%`)
  console.log('')
}

main().catch(console.error)
