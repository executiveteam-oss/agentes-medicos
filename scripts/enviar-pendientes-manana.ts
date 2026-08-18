/**
 * ENVÍO PUNTUAL de los recordatorios de mañana que perdieron su ventana.
 *
 * Por qué existe: el opt-in del padrón se prendió a media mañana del 18/08 y
 * la ventana de 24h de esas citas ya había pasado. El cron NO las va a tomar
 * nunca — su ventana es fija (±1h alrededor de las 24h).
 *
 * ⚠️ USO ÚNICO. Repite la lógica del cron (template, params, flags, tabla
 * reminders) en vez de invocarla, porque esa lógica está encerrada en la
 * ventana temporal. Si esto se necesita otra vez, lo correcto es extraer la
 * función de envío del cron y llamarla con un rango como parámetro — no
 * volver a copiar.
 *
 * Envía de a uno con pausa y CORTA al primer 131042.
 *
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/enviar-pendientes-manana.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppTemplate, getClinicCreds } from '@/lib/whatsapp/client'
import { REMINDER_TEMPLATE_NAME_V2, TEMPLATE_LANGUAGE } from '@/lib/whatsapp/appointment-templates'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import { toTitleCase, nombreMedicoParaPaciente } from '@/lib/utils/normalize-name'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DRY = process.env.DRY_RUN === '1'

async function main() {
  const { data: clinic } = await supabaseAdmin.from('clinics').select('name, address, city').eq('id', ALGIA).single()
  const creds = await getClinicCreds(ALGIA)
  if (!creds) { console.error('Sin credenciales WhatsApp'); process.exit(1) }
  const direccion = clinic!.city ? `${clinic!.address}, ${clinic!.city}` : clinic!.address

  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, clinic_id, patients(name, phone, proactive_contact_opt_in), doctors(name, gender)')
    .eq('clinic_id', ALGIA).in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .eq('reminder_24h_sent', false)
    .gte('starts_at', '2026-08-19 05:00+00').lt('starts_at', '2026-08-20 05:00+00')
    .lt('starts_at', new Date(Date.now() + 23 * 3600_000).toISOString())
    .order('starts_at')

  const filas = (data ?? []) as unknown as {
    id: string; starts_at: string
    patients: { name: string; phone: string; proactive_contact_opt_in: boolean } | null
    doctors: { name: string; gender: string | null } | null
  }[]
  const enviables = filas.filter((f) => f.patients?.phone && f.patients.proactive_contact_opt_in === true && f.doctors)

  console.log(`A enviar: ${enviables.length}\n`)
  let ok = 0, fallidos = 0
  for (const a of enviables) {
    const p = a.patients!, d = a.doctors!
    const tel = `${p.phone.slice(0, 6)}***${p.phone.slice(-2)}`
    if (DRY) {
      console.log(`  [DRY] ${tel} · ${toTitleCase(p.name).slice(0, 26)} · ${formatDateForPatient(a.starts_at)} ${formatTimeForPatient(a.starts_at)}`)
      continue
    }
    const r = await sendWhatsAppTemplate(
      p.phone.replace('+', ''), REMINDER_TEMPLATE_NAME_V2, TEMPLATE_LANGUAGE,
      [toTitleCase(p.name), clinic!.name, nombreMedicoParaPaciente(d.name, d.gender),
       formatDateForPatient(a.starts_at), formatTimeForPatient(a.starts_at), direccion],
      null, creds, { clinicId: ALGIA, sendType: 'reminder' },
    )

    if (r.ok) {
      ok++
      // Igual que el cron: los flags SOLO si el envío salió bien.
      await supabaseAdmin.from('appointments')
        .update({ reminder_24h_sent: true, reminder_confirmed: null }).eq('id', a.id)
      await supabaseAdmin.from('reminders').insert({
        appointment_id: a.id, type: '24h', scheduled_for: a.starts_at,
        sent_at: new Date().toISOString(), status: 'sent',
      })
      console.log(`  ✅ ${tel} · ${toTitleCase(p.name).slice(0, 24)} · wamid ${(r.messageId ?? '—').slice(-12)}`)
    } else {
      fallidos++
      console.log(`  ❌ ${tel} · code ${r.errorCode ?? '?'} · ${r.error ?? ''}`)
      if (r.errorCode === 131042) {
        console.error('\n🛑 131042 (Business eligibility payment issue) — CORTANDO. No se envía nada más.')
        break
      }
    }
    await new Promise((res) => setTimeout(res, 1200))
  }
  console.log(`\n═══ enviados: ${ok} · fallidos: ${fallidos} ═══`)
}
main().catch((e) => { console.error(e); process.exit(1) })
