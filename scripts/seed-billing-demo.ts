import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  console.log('💰 Seeding billing demo data for Los Puchis...\n')

  // ========================================
  // PART 1: Update 15 completed appointments
  // ========================================

  // Get completed appointments without invoice data
  const { data: completedApts } = await sb
    .from('appointments')
    .select('id, starts_at, patient_id')
    .eq('clinic_id', CID)
    .eq('status', 'completed')
    .is('invoice_number', null)
    .order('starts_at', { ascending: false })
    .limit(20)

  if (!completedApts || completedApts.length < 15) {
    // Fallback: get any completed appointments (even with invoice)
    const { data: allCompleted } = await sb
      .from('appointments')
      .select('id, starts_at, patient_id')
      .eq('clinic_id', CID)
      .eq('status', 'completed')
      .order('starts_at', { ascending: false })
      .limit(20)

    if (!allCompleted || allCompleted.length < 15) {
      console.error(`Only ${allCompleted?.length ?? 0} completed appointments found, need 15`)
      return
    }
    completedApts!.push(...allCompleted.slice(0, 20 - completedApts!.length))
  }

  const apts = completedApts!.slice(0, 15)
  let invoiceCounter = 100

  // --- 6 cobradas (Particular + Póliza) ---
  console.log('📋 Updating 6 appointments → cobrada (Particular/Póliza)...')
  const cobradas = apts.slice(0, 6)
  for (let i = 0; i < cobradas.length; i++) {
    const apt = cobradas[i]
    invoiceCounter++
    const paymentType = i < 4 ? 'Particular' : 'Póliza'
    const { error } = await sb
      .from('appointments')
      .update({
        invoice_number: `FE-2026-${String(invoiceCounter).padStart(3, '0')}`,
        invoice_date: daysAgo(Math.floor(Math.random() * 28) + 2),
        invoice_amount: 120000,
        invoice_status: 'emitida',
        collection_status: 'cobrada',
        payment_type: paymentType,
        outstanding_balance: 0,
      })
      .eq('id', apt.id)
    if (error) console.error(`  Error apt ${apt.id}:`, error.message)
  }
  console.log(`  ✅ 6 cobradas updated (FE-2026-101 to FE-2026-106)`)

  // --- 4 en_tramite (EPS) ---
  console.log('📋 Updating 4 appointments → en_tramite (EPS)...')
  const enTramite = apts.slice(6, 10)
  const epsNames = ['Sura', 'Compensar', 'Nueva EPS', 'Sura']
  for (let i = 0; i < enTramite.length; i++) {
    const apt = enTramite[i]
    invoiceCounter++
    const daysBack = 15 + Math.floor(Math.random() * 25) // 15-40 days ago
    const { error } = await sb
      .from('appointments')
      .update({
        invoice_number: `FE-2026-${String(invoiceCounter).padStart(3, '0')}`,
        invoice_date: daysAgo(daysBack),
        invoice_amount: 120000,
        invoice_status: 'emitida',
        collection_status: 'en_tramite',
        payment_type: 'EPS',
        eps_name: epsNames[i],
        eps_value: 102000, // 85% of 120k
        patient_copago: 18000,
        invoice_radication_date: daysAgo(daysBack - 2),
        outstanding_balance: 102000,
        glosa_status: 'none',
        glosa_value: 0,
      })
      .eq('id', apt.id)
    if (error) console.error(`  Error apt ${apt.id}:`, error.message)
  }
  console.log(`  ✅ 4 en_tramite updated (FE-2026-107 to FE-2026-110)`)

  // --- 3 glosadas (EPS) ---
  console.log('📋 Updating 3 appointments → glosada (EPS)...')
  const glosadas = apts.slice(10, 13)
  const glosaReasons = [
    'Tarifa superior a la pactada',
    'Falta autorización previa',
    'Tarifa superior a la pactada',
  ]
  const glosaAmounts = [65000, 48000, 72000]
  const glosaEps = ['Sura', 'Compensar', 'Nueva EPS']
  for (let i = 0; i < glosadas.length; i++) {
    const apt = glosadas[i]
    invoiceCounter++
    const daysBack = 20 + Math.floor(Math.random() * 15) // 20-35 days ago
    const notifDays = 10 + Math.floor(Math.random() * 10) // 10-20 days ago
    const { error } = await sb
      .from('appointments')
      .update({
        invoice_number: `FE-2026-${String(invoiceCounter).padStart(3, '0')}`,
        invoice_date: daysAgo(daysBack),
        invoice_amount: 120000,
        invoice_status: 'emitida',
        collection_status: 'glosada',
        payment_type: 'EPS',
        eps_name: glosaEps[i],
        eps_value: 102000,
        patient_copago: 18000,
        glosa_reason: glosaReasons[i],
        glosa_amount: glosaAmounts[i],
        glosa_notification_date: daysAgo(notifDays),
        glosa_status: 'pending',
        glosa_value: glosaAmounts[i],
        outstanding_balance: 102000,
      })
      .eq('id', apt.id)
    if (error) console.error(`  Error apt ${apt.id}:`, error.message)
  }
  console.log(`  ✅ 3 glosadas updated (FE-2026-111 to FE-2026-113)`)

  // --- 2 vencidas (EPS) ---
  console.log('📋 Updating 2 appointments → vencida (EPS)...')
  const vencidas = apts.slice(13, 15)
  const vencidaEps = ['Nueva EPS', 'Compensar']
  for (let i = 0; i < vencidas.length; i++) {
    const apt = vencidas[i]
    invoiceCounter++
    const daysBack = 65 + Math.floor(Math.random() * 15) // 65-80 days ago
    const { error } = await sb
      .from('appointments')
      .update({
        invoice_number: `FE-2026-${String(invoiceCounter).padStart(3, '0')}`,
        invoice_date: daysAgo(daysBack),
        invoice_amount: 120000,
        invoice_status: 'emitida',
        collection_status: 'vencida',
        payment_type: 'EPS',
        eps_name: vencidaEps[i],
        eps_value: 102000,
        patient_copago: 18000,
        outstanding_balance: 102000,
        glosa_status: 'none',
        glosa_value: 0,
      })
      .eq('id', apt.id)
    if (error) console.error(`  Error apt ${apt.id}:`, error.message)
  }
  console.log(`  ✅ 2 vencidas updated (FE-2026-114 to FE-2026-115)`)

  // ========================================
  // PART 2: Insert 8 standalone invoices
  // ========================================
  console.log('\n📄 Inserting 8 standalone invoices...')

  // Get patient IDs
  const { data: patients } = await sb
    .from('patients')
    .select('id')
    .eq('clinic_id', CID)
    .limit(10)
  const pIds = patients?.map(p => p.id) ?? []
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

  const standaloneInvoices = [
    // 3 cobradas - Particular
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-201',
      invoice_date: daysAgo(3),
      invoice_amount: 120000,
      payment_type: 'Particular',
      collection_status: 'cobrada',
    },
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-202',
      invoice_date: daysAgo(8),
      invoice_amount: 180000,
      payment_type: 'Particular',
      collection_status: 'cobrada',
    },
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-203',
      invoice_date: daysAgo(15),
      invoice_amount: 95000,
      payment_type: 'Particular',
      collection_status: 'cobrada',
    },
    // 2 en_tramite - EPS
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-204',
      invoice_date: daysAgo(12),
      invoice_amount: 240000,
      payment_type: 'EPS',
      eps_name: 'Sura',
      collection_status: 'en_tramite',
    },
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-205',
      invoice_date: daysAgo(22),
      invoice_amount: 160000,
      payment_type: 'EPS',
      eps_name: 'Compensar',
      collection_status: 'en_tramite',
    },
    // 2 glosadas - EPS
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-206',
      invoice_date: daysAgo(25),
      invoice_amount: 200000,
      payment_type: 'EPS',
      eps_name: 'Sura',
      collection_status: 'glosada',
      observations: 'Glosa: Documentación incompleta — $60.000 COP — Notificada ' + daysAgo(10),
    },
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-207',
      invoice_date: daysAgo(18),
      invoice_amount: 140000,
      payment_type: 'EPS',
      eps_name: 'Compensar',
      collection_status: 'glosada',
      observations: 'Glosa: Documentación incompleta — $45.000 COP — Notificada ' + daysAgo(8),
    },
    // 1 vencida - EPS
    {
      clinic_id: CID,
      patient_id: pick(pIds),
      invoice_number: 'FE-2026-208',
      invoice_date: daysAgo(70),
      invoice_amount: 310000,
      payment_type: 'EPS',
      eps_name: 'Nueva EPS',
      collection_status: 'vencida',
    },
  ]

  const { error: invError } = await sb.from('invoices').insert(standaloneInvoices)
  if (invError) {
    console.error('  Error inserting invoices:', invError.message)
  } else {
    console.log('  ✅ 8 standalone invoices created (FE-2026-201 to FE-2026-208)')
  }

  // ========================================
  // PART 3: Verify EPS data for risk table
  // ========================================
  console.log('\n📊 Verifying EPS data...')

  // Appointments with EPS
  const { data: epsApts } = await sb
    .from('appointments')
    .select('eps_name, collection_status, glosa_status, invoice_number')
    .eq('clinic_id', CID)
    .eq('payment_type', 'EPS')
    .not('invoice_number', 'is', null)

  // Standalone invoices with EPS
  const { data: epsInvs } = await sb
    .from('invoices')
    .select('eps_name, collection_status, invoice_number')
    .eq('clinic_id', CID)
    .eq('payment_type', 'EPS')

  const epsStats: Record<string, { total: number; enTramite: number; glosada: number; vencida: number; cobrada: number }> = {}

  for (const item of [...(epsApts ?? []), ...(epsInvs ?? [])]) {
    const name = item.eps_name ?? 'Sin EPS'
    if (!epsStats[name]) epsStats[name] = { total: 0, enTramite: 0, glosada: 0, vencida: 0, cobrada: 0 }
    epsStats[name].total++
    if (item.collection_status === 'en_tramite') epsStats[name].enTramite++
    if (item.collection_status === 'glosada') epsStats[name].glosada++
    if (item.collection_status === 'vencida') epsStats[name].vencida++
    if (item.collection_status === 'cobrada') epsStats[name].cobrada++
  }

  console.log('\n  EPS Risk Summary:')
  for (const [eps, stats] of Object.entries(epsStats)) {
    const glosaRate = stats.total > 0 ? Math.round((stats.glosada / stats.total) * 100) : 0
    console.log(`    ${eps}: ${stats.total} facturas — cobrada:${stats.cobrada} tramite:${stats.enTramite} glosada:${stats.glosada}(${glosaRate}%) vencida:${stats.vencida}`)
  }

  // Overall summary
  const { data: allAptInvoices } = await sb
    .from('appointments')
    .select('collection_status, invoice_amount')
    .eq('clinic_id', CID)
    .not('invoice_number', 'is', null)

  const { data: allStandaloneInvs } = await sb
    .from('invoices')
    .select('collection_status, invoice_amount')
    .eq('clinic_id', CID)

  const allItems = [...(allAptInvoices ?? []), ...(allStandaloneInvs ?? [])]
  const statusCounts: Record<string, { count: number; total: number }> = {}
  for (const item of allItems) {
    const s = item.collection_status ?? 'pendiente'
    if (!statusCounts[s]) statusCounts[s] = { count: 0, total: 0 }
    statusCounts[s].count++
    statusCounts[s].total += item.invoice_amount ?? 0
  }

  console.log('\n==================================================')
  console.log('✅ BILLING DEMO SEED COMPLETE — SUMMARY')
  console.log('==================================================')
  console.log(`\n  Appointments updated: 15`)
  console.log(`  Standalone invoices: 8`)
  console.log(`  Total invoiced items: ${allItems.length}`)
  console.log(`\n  By collection status:`)
  for (const [status, data] of Object.entries(statusCounts).sort()) {
    console.log(`    ${status}: ${data.count} facturas — $${data.total.toLocaleString('es-CO')} COP`)
  }

  const totalBilled = allItems.reduce((s, i) => s + (i.invoice_amount ?? 0), 0)
  console.log(`\n  Total facturado: $${totalBilled.toLocaleString('es-CO')} COP`)
}

main().catch(console.error)
