import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

async function main() {
  const { data } = await sb.from('appointments')
    .select('status, starts_at, payment_type, nps_score, invoice_status, invoice_number')
    .eq('clinic_id', CID)
    .gte('starts_at', ninetyDaysAgo)
    .in('status', ['completed', 'no_show', 'cancelled', 'confirmed', 'rescheduled'])

  const st: Record<string, number> = {}
  data?.forEach(a => { st[a.status] = (st[a.status] || 0) + 1 })
  console.log('Last 90d appointments:', data?.length)
  console.log('Statuses:', JSON.stringify(st))

  const cns = data?.filter(a => a.status === 'completed' || a.status === 'no_show') ?? []
  const ns = cns.filter(a => a.status === 'no_show')
  console.log('No-show rate (90d):', Math.round(ns.length / cns.length * 100) + '%')

  // Day of week breakdown
  const dayNames = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
  const dayNS: Record<string, number> = {}
  const dayTotal: Record<string, number> = {}
  for (const a of cns) {
    const d = new Date(a.starts_at)
    const dow = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    const name = dayNames[dow]
    dayTotal[name] = (dayTotal[name] || 0) + 1
    if (a.status === 'no_show') dayNS[name] = (dayNS[name] || 0) + 1
  }
  console.log('\nNo-show by day:')
  for (const d of dayNames) {
    if (dayTotal[d]) {
      console.log(`  ${d}: ${dayNS[d] || 0}/${dayTotal[d]} = ${Math.round(((dayNS[d] || 0) / dayTotal[d]) * 100)}%`)
    }
  }

  // Payment type breakdown
  const payTypes: Record<string, number> = {}
  data?.forEach(a => { payTypes[a.payment_type] = (payTypes[a.payment_type] || 0) + 1 })
  console.log('\nPayment types:', JSON.stringify(payTypes))

  // Unbilled
  const unbilled = data?.filter(a =>
    a.status === 'completed' && (a.invoice_number === null || a.invoice_status === 'pendiente')
  )
  console.log('Unbilled completed:', unbilled?.length)

  // NPS
  const nps = data?.filter(a => a.nps_score != null)
  console.log('\nNPS scores:', nps?.map(a => a.nps_score))

  // Patients
  const { data: patients } = await sb.from('patients')
    .select('id, name, total_appointments')
    .eq('clinic_id', CID)
    .gte('total_appointments', 1)
  const withMultiple = patients?.filter(p => p.total_appointments >= 2).length
  console.log('\nPatients with 1+ apts:', patients?.length)
  console.log('Patients with 2+ apts:', withMultiple)
  console.log('Return rate:', Math.round((withMultiple || 0) / (patients?.length || 1) * 100) + '%')

  // Cartera
  const { data: cartera } = await sb.from('cartera')
    .select('amount, days_overdue')
    .eq('clinic_id', CID)
    .eq('status', 'pendiente')
  const total = cartera?.reduce((s, c) => s + c.amount, 0)
  console.log('\nCartera total:', total)
  console.log('Cartera entries:', cartera?.length)
  cartera?.forEach(c => console.log(`  $${c.amount} — ${c.days_overdue} days overdue`))
}

main().catch(console.error)
