import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)
const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'

async function verify() {
  // Appointment invoices
  const { data: aptInvs } = await sb.from('appointments')
    .select('invoice_number, collection_status, payment_type, eps_name, glosa_status, glosa_reason, glosa_value, invoice_amount')
    .eq('clinic_id', CID)
    .not('invoice_number', 'is', null)
    .like('invoice_number', 'FE-2026-1%')

  console.log('=== APPOINTMENT INVOICES (FE-2026-1xx) ===')
  const aptByStatus: Record<string, typeof aptInvs> = {}
  for (const a of aptInvs ?? []) {
    const s = a.collection_status ?? 'unknown'
    if (!aptByStatus[s]) aptByStatus[s] = []
    aptByStatus[s]!.push(a)
  }
  for (const [status, items] of Object.entries(aptByStatus)) {
    console.log(`  ${status}: ${items!.length}`)
    for (const i of items!) {
      const glosaInfo = i.glosa_status !== 'none' ? ` | glosa: ${i.glosa_reason} $${i.glosa_value}` : ''
      console.log(`    ${i.invoice_number} | ${i.payment_type}${i.eps_name ? '/' + i.eps_name : ''}${glosaInfo}`)
    }
  }

  // Standalone invoices
  const { data: standInvs } = await sb.from('invoices')
    .select('invoice_number, collection_status, payment_type, eps_name, invoice_amount, observations')
    .eq('clinic_id', CID)
    .like('invoice_number', 'FE-2026-2%')

  console.log('\n=== STANDALONE INVOICES (FE-2026-2xx) ===')
  for (const inv of standInvs ?? []) {
    const obs = inv.observations ? ` | ${inv.observations.slice(0, 50)}` : ''
    console.log(`  ${inv.invoice_number} | ${inv.collection_status} | ${inv.payment_type}${inv.eps_name ? '/' + inv.eps_name : ''} | $${(inv.invoice_amount ?? 0).toLocaleString('es-CO')}${obs}`)
  }

  // EPS risk summary
  console.log('\n=== EPS RISK TABLE ===')
  const { data: epsApts } = await sb.from('appointments')
    .select('eps_name, collection_status, glosa_value')
    .eq('clinic_id', CID).eq('payment_type', 'EPS').not('invoice_number', 'is', null)
  const { data: epsInvs } = await sb.from('invoices')
    .select('eps_name, collection_status')
    .eq('clinic_id', CID).eq('payment_type', 'EPS')

  const epsStats: Record<string, { total: number; glosada: number; vencida: number; glosaTotal: number }> = {}
  for (const item of [...(epsApts ?? []), ...(epsInvs ?? [])]) {
    const name = (item as { eps_name: string | null }).eps_name ?? 'N/A'
    if (!epsStats[name]) epsStats[name] = { total: 0, glosada: 0, vencida: 0, glosaTotal: 0 }
    epsStats[name].total++
    if (item.collection_status === 'glosada') {
      epsStats[name].glosada++
      epsStats[name].glosaTotal += ((item as { glosa_value?: number }).glosa_value ?? 0)
    }
    if (item.collection_status === 'vencida') epsStats[name].vencida++
  }
  for (const [eps, s] of Object.entries(epsStats)) {
    const rate = s.total > 0 ? Math.round(s.glosada / s.total * 100) : 0
    console.log(`  ${eps}: ${s.total} facturas, glosa rate: ${rate}%, vencidas: ${s.vencida}, glosa total: $${s.glosaTotal.toLocaleString('es-CO')}`)
  }
}

verify().catch(console.error)
