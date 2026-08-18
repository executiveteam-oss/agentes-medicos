/**
 * ¿Está APROBADO en Meta el template que usan los recordatorios?
 * Solo lectura contra Graph API. No imprime el token.
 *
 * Run: npx tsx --env-file=.env.production.local scripts/check-template-meta.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { REMINDER_TEMPLATE_NAME_V2, REMINDER_TEMPLATE_BODY_V2, TEMPLATE_LANGUAGE } from '@/lib/whatsapp/appointment-templates'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const G = 'https://graph.facebook.com/v21.0'

async function main() {
  const { data: c } = await supabaseAdmin
    .from('clinics').select('whatsapp_phone_id, whatsapp_access_token').eq('id', ALGIA).single()
  const phoneId = c?.whatsapp_phone_id as string
  const token = c?.whatsapp_access_token as string
  if (!phoneId || !token) { console.error('Sin credenciales'); process.exit(1) }
  const H = { Authorization: `Bearer ${token}` }

  const r1 = await fetch(`${G}/${phoneId}?fields=display_phone_number,quality_rating,verified_name`, { headers: H })
  const d1 = await r1.json()
  if (d1.error) { console.error('Meta (phone):', d1.error.message); process.exit(1) }
  console.log(`número     : ${d1.display_phone_number ?? '?'}  (${d1.verified_name ?? '—'})`)
  console.log(`calidad    : ${d1.quality_rating ?? '—'}`)

  // El WABA no cuelga del phone_number_id en v21; viene del env.
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
  console.log(`WABA       : ${waba ?? '(no resuelto por token)'}\n`)
  if (!waba) { console.error('No pude resolver el WABA con este token.'); process.exit(1) }

  const r2 = await fetch(`${G}/${waba}/message_templates?limit=100`, { headers: H })
  const d2 = await r2.json()
  if (d2.error) { console.error('Meta:', d2.error.message); process.exit(1) }

  console.log('TEMPLATES DE LA CUENTA:')
  for (const t of d2.data ?? []) {
    const marca = t.name === REMINDER_TEMPLATE_NAME_V2 ? ' ⬅ el de recordatorios' : ''
    console.log(`  ${String(t.status).padEnd(10)} ${String(t.language).padEnd(6)} ${t.name}${marca}`)
  }

  const t = (d2.data ?? []).find((x: { name: string; language: string }) =>
    x.name === REMINDER_TEMPLATE_NAME_V2 && x.language === TEMPLATE_LANGUAGE)

  console.log(`\n─── ${REMINDER_TEMPLATE_NAME_V2} (${TEMPLATE_LANGUAGE}) ───`)
  if (!t) { console.log('❌ NO EXISTE en la cuenta con ese nombre+idioma. Los envíos fallarían.'); return }
  console.log(`estado    : ${t.status}   ${t.status === 'APPROVED' ? '✅' : '🔴'}`)
  console.log(`categoría : ${t.category}`)
  const body = (t.components ?? []).find((x: { type: string }) => x.type === 'BODY')
  const btns = (t.components ?? []).find((x: { type: string }) => x.type === 'BUTTONS')
  console.log(`botones   : ${btns ? btns.buttons.map((b: { text: string }) => b.text).join(' · ') : '(ninguno)'}`)
  const igual = body?.text === REMINDER_TEMPLATE_BODY_V2
  console.log(`\nbody en Meta vs. el del repo: ${igual ? '✅ idénticos' : '❌ DIFIEREN'}`)
  if (!igual) {
    console.log(`  Meta : ${JSON.stringify(body?.text)}`)
    console.log(`  repo : ${JSON.stringify(REMINDER_TEMPLATE_BODY_V2)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
