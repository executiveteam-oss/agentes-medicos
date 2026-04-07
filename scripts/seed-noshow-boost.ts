import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const DOC_CAROLINA = 'b97cc7e1-e49b-434e-9475-50e6fe2df545'
const DOC_MARTA = '8b5b8590-4570-46c3-973f-ad2c27524a36'

function daysAgoAt(daysAgo: number, hour: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour + 5, 0, 0, 0)
  return d.toISOString()
}

function endTime(starts: string): string {
  return new Date(new Date(starts).getTime() + 30 * 60000).toISOString()
}

function dayOfWeek(daysAgo: number): number {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.getDay()
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

async function main() {
  console.log('Adding targeted no-show appointments...\n')

  // Get all patient IDs
  const { data: patients } = await sb.from('patients')
    .select('id')
    .eq('clinic_id', CID)
  const patientIds = patients?.map(p => p.id) ?? []

  const noShowApts: Array<Record<string, unknown>> = []

  // Find Mondays and Friday afternoons in last 90 days and add no-shows
  for (let daysAgo = 3; daysAgo < 85; daysAgo++) {
    const dow = dayOfWeek(daysAgo)

    // Monday no-shows (add 1-2 per Monday)
    if (dow === 1) {
      const count = Math.random() < 0.5 ? 2 : 1
      for (let i = 0; i < count; i++) {
        const hour = pick([8, 9, 10, 14, 15])
        const starts = daysAgoAt(daysAgo, hour)
        noShowApts.push({
          clinic_id: CID,
          doctor_id: pick([DOC_CAROLINA, DOC_MARTA]),
          patient_id: pick(patientIds),
          starts_at: starts,
          ends_at: endTime(starts),
          status: 'no_show',
          payment_type: pick(['Particular', 'EPS', 'Particular']),
          source: 'whatsapp_agent',
          glosa_status: 'none',
          glosa_value: 0,
          invoice_status: 'pendiente',
        })
      }
    }

    // Friday afternoon no-shows (add 1 per Friday)
    if (dow === 5) {
      const hour = pick([14, 15, 16])
      const starts = daysAgoAt(daysAgo, hour)
      noShowApts.push({
        clinic_id: CID,
        doctor_id: pick([DOC_CAROLINA, DOC_MARTA]),
        patient_id: pick(patientIds),
        starts_at: starts,
        ends_at: endTime(starts),
        status: 'no_show',
        payment_type: 'Particular',
        source: 'whatsapp_agent',
        glosa_status: 'none',
        glosa_value: 0,
        invoice_status: 'pendiente',
      })
    }
  }

  console.log(`  Adding ${noShowApts.length} targeted no-show appointments...`)
  const { error } = await sb.from('appointments').insert(noShowApts)
  if (error) { console.error('Error:', error); return }

  // Also fix the unbilled issue - update most completed apts to have invoice_number
  console.log('\n  Fixing unbilled appointments...')
  const { data: unbilled } = await sb.from('appointments')
    .select('id')
    .eq('clinic_id', CID)
    .eq('status', 'completed')
    .is('invoice_number', null)

  // Keep 12 unbilled, fix the rest
  const toFix = (unbilled ?? []).slice(12)
  for (const apt of toFix) {
    await sb.from('appointments').update({
      invoice_number: `FAC-2026${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      invoice_status: 'pagada',
    }).eq('id', apt.id)
  }
  console.log(`  Fixed ${toFix.length} invoices, kept 12 unbilled`)

  // Update patient no_show_count
  console.log('\n  Updating patient stats...')
  const { data: allApts } = await sb.from('appointments')
    .select('patient_id, status')
    .eq('clinic_id', CID)

  const stats: Record<string, { total: number; noShows: number }> = {}
  for (const a of allApts ?? []) {
    if (!a.patient_id) continue
    if (!stats[a.patient_id]) stats[a.patient_id] = { total: 0, noShows: 0 }
    if (['completed', 'no_show', 'confirmed', 'rescheduled'].includes(a.status)) stats[a.patient_id].total++
    if (a.status === 'no_show') stats[a.patient_id].noShows++
  }
  for (const [pid, s] of Object.entries(stats)) {
    await sb.from('patients').update({
      total_appointments: s.total,
      no_show_count: s.noShows,
    }).eq('id', pid)
  }

  // Verify final state
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: final } = await sb.from('appointments')
    .select('status, starts_at, invoice_number, invoice_status')
    .eq('clinic_id', CID)
    .gte('starts_at', ninetyDaysAgo)
    .in('status', ['completed', 'no_show', 'cancelled', 'confirmed', 'rescheduled'])

  const cns = final?.filter(a => a.status === 'completed' || a.status === 'no_show') ?? []
  const nsCount = cns.filter(a => a.status === 'no_show').length
  console.log(`\n  Final no-show rate: ${nsCount}/${cns.length} = ${Math.round(nsCount / cns.length * 100)}%`)

  const unbilledFinal = final?.filter(a =>
    a.status === 'completed' && a.invoice_number === null
  )
  console.log(`  Unbilled: ${unbilledFinal?.length}`)

  // Day breakdown
  const dayNames = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
  const dayNS: Record<string, number> = {}
  const dayT: Record<string, number> = {}
  for (const a of cns) {
    const d = new Date(a.starts_at)
    const dow = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    const name = dayNames[dow]
    dayT[name] = (dayT[name] || 0) + 1
    if (a.status === 'no_show') dayNS[name] = (dayNS[name] || 0) + 1
  }
  console.log('\n  No-show by day:')
  for (const d of dayNames) {
    if (dayT[d]) console.log(`    ${d}: ${dayNS[d] || 0}/${dayT[d]} = ${Math.round(((dayNS[d] || 0) / dayT[d]) * 100)}%`)
  }

  console.log('\n✅ Done')
}

main().catch(console.error)
