/**
 * DRY-RUN de recordatorios. NO ENVÍA NADA.
 *
 * Arma los parámetros con las MISMAS funciones que el cron y renderiza el
 * template como lo va a ver la paciente. Ignora el opt-in a propósito: la
 * pregunta es "¿qué saldría si estuviera prendido?".
 *
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/dryrun-recordatorios.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import { toTitleCase } from '@/lib/utils/normalize-name'
import { REMINDER_TEMPLATE_BODY_V2, REMINDER_TEMPLATE_NAME_V2, TEMPLATE_LANGUAGE, REMINDER_BUTTONS } from '@/lib/whatsapp/appointment-templates'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

function render(params: string[]): string {
  return REMINDER_TEMPLATE_BODY_V2.replace(/\{\{(\d)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`)
}

async function ventana(label: string, desdeH: number, hastaH: number, flag: 'reminder_72h_sent' | 'reminder_24h_sent') {
  const { data: clinic } = await supabaseAdmin.from('clinics').select('name, address, city').eq('id', ALGIA).single()
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, patients(name, phone), doctors(name, specialty, title)')
    .eq('clinic_id', ALGIA)
    .in('status', ['confirmed', 'rescheduled'])
    .eq(flag, false)
    .gte('starts_at', new Date(Date.now() + desdeH * 3600_000).toISOString())
    .lte('starts_at', new Date(Date.now() + hastaH * 3600_000).toISOString())
    .order('starts_at')

  const filas = (data ?? []) as unknown as {
    id: string; starts_at: string
    patients: { name: string; phone: string } | null
    doctors: { name: string; specialty: string | null; title: string | null } | null
  }[]

  // Mismo corte que el cron (`if (!patient || !doctor || !clinic) continue`):
  // hay citas futuras sin ficha vinculada y el cron NO les manda nada. Contarlas
  // inflaba el volumen estimado.
  const enviables = filas.filter((f) => f.patients?.phone && f.doctors)
  const sinFicha = filas.length - enviables.length

  console.log(`\n${'═'.repeat(74)}\n${label} — ${enviables.length} mensajes` +
    (sinFicha > 0 ? `   (+${sinFicha} citas sin ficha/teléfono que el cron saltea)` : '') +
    `\n${'═'.repeat(74)}`)
  if (enviables.length === 0) return 0

  const a = enviables[0]
  const p = a.patients!, d = a.doctors!
  // Igual que el cron: sale de doctors.title. Sin dato, sin prefijo.
  const nombreMedico = d.title?.trim() ? `${d.title.trim()} ${toTitleCase(d.name)}` : toTitleCase(d.name)

  // Los params difieren entre ventanas — así están hoy en el cron.
  const params = label.startsWith('72h')
    ? [toTitleCase(p.name), clinic!.name, nombreMedico, formatDateForPatient(a.starts_at), formatTimeForPatient(a.starts_at),
       clinic!.city ? `${clinic!.address}, ${clinic!.city}` : clinic!.address]
    : [toTitleCase(p.name), clinic!.name, nombreMedico, formatDateForPatient(a.starts_at), formatTimeForPatient(a.starts_at),
       clinic!.city ? `${clinic!.address}, ${clinic!.city}` : clinic!.address]

  console.log(`caso real → cita ${a.id.slice(0, 8)} · ${p.phone.slice(0, 6)}***${p.phone.slice(-2)}\n`)
  console.log('┌─ lo que lee la paciente ' + '─'.repeat(46))
  for (const l of render(params).split('\n')) console.log('│ ' + l)
  console.log('│')
  console.log('│ [' + REMINDER_BUTTONS.join('] [') + ']')
  console.log('└' + '─'.repeat(70))
  return enviables.length
}

async function main() {
  console.log(`Template: ${REMINDER_TEMPLATE_NAME_V2}  ·  idioma: ${TEMPLATE_LANGUAGE}`)
  console.log(`Body crudo: ${JSON.stringify(REMINDER_TEMPLATE_BODY_V2)}`)
  const n72 = await ventana('72h (citas entre +71h y +97h)', 71, 97, 'reminder_72h_sent')
  const n24 = await ventana('24h (citas entre +23h y +49h)', 23, 49, 'reminder_24h_sent')
  console.log(`\nTOTAL próximas 24 h: ${n72 + n24} mensajes   (2h queda APAGADA)`)
  console.log('\n⚠️  DRY-RUN — no se envió nada.')
}
main().catch((e) => { console.error(e); process.exit(1) })
