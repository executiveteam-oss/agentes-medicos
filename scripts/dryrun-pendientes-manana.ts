/**
 * Los recordatorios de MAÑANA que perdieron su ventana. NO ENVÍA NADA.
 * Renderiza con las mismas funciones del cron.
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/dryrun-pendientes-manana.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import { toTitleCase, nombreMedicoParaPaciente } from '@/lib/utils/normalize-name'
import { REMINDER_TEMPLATE_BODY_V2 } from '@/lib/whatsapp/appointment-templates'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const render = (p: string[]) => REMINDER_TEMPLATE_BODY_V2.replace(/\{\{(\d)\}\}/g, (_, n) => p[Number(n) - 1] ?? '')

async function main() {
  const { data: clinic } = await supabaseAdmin.from('clinics').select('name, address, city').eq('id', ALGIA).single()
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, patients(name, phone), doctors(name, gender)')
    .eq('clinic_id', ALGIA).in('status', ['confirmed', 'rescheduled'])
    .eq('reminder_24h_sent', false)
    .gte('starts_at', '2026-08-19 05:00+00').lt('starts_at', '2026-08-20 05:00+00')
    .lt('starts_at', new Date(Date.now() + 23 * 3600_000).toISOString())   // ventana YA pasada
    .order('starts_at')

  const filas = (data ?? []) as unknown as {
    id: string; starts_at: string
    patients: { name: string; phone: string } | null
    doctors: { name: string; gender: string | null } | null
  }[]
  const enviables = filas.filter((f) => f.patients?.phone && f.doctors)

  const direccion = clinic!.city ? `${clinic!.address}, ${clinic!.city}` : clinic!.address
  const porTel = new Map<string, number>()

  console.log(`PENDIENTES DE MAÑANA (ventana ya pasada): ${enviables.length} mensajes\n`)
  for (const a of enviables) {
    const p = a.patients!, d = a.doctors!
    porTel.set(p.phone, (porTel.get(p.phone) ?? 0) + 1)
    const params = [toTitleCase(p.name), clinic!.name, nombreMedicoParaPaciente(d.name, d.gender),
                    formatDateForPatient(a.starts_at), formatTimeForPatient(a.starts_at), direccion]
    console.log(`── ${p.phone.slice(0,6)}***${p.phone.slice(-2)} · cita ${a.id.slice(0,8)}`)
    for (const l of render(params).split('\n')) console.log(`   ${l}`)
    console.log('   [Confirmar] [Reagendar] [Cancelar]\n')
  }
  const dobles = [...porTel.entries()].filter(([, n]) => n > 1)
  console.log(`Números distintos: ${porTel.size}`)
  if (dobles.length) console.log(`⚠️  ${dobles.length} número(s) recibirían MÁS de un mensaje: ${dobles.map(([t, n]) => `${t.slice(0,6)}***${t.slice(-2)} (${n})`).join(', ')}`)
  console.log('\n⚠️  DRY-RUN — no se envió nada.')
}
main().catch((e) => { console.error(e); process.exit(1) })
