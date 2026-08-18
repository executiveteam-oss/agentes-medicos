import { existsSync, readFileSync } from 'fs'
import { createHmac } from 'crypto'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const URL = 'https://omuwan.co/api/webhooks/whatsapp'
const TESTER = process.env.SMOKE_TESTER_PHONE ?? ''

async function main() {
  if (!TESTER) { console.error('falta SMOKE_TESTER_PHONE'); process.exit(1) }
  const { createClient } = await import('@supabase/supabase-js')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: c } = await supa.from('clinics').select('whatsapp_phone_id, whatsapp_app_secret').eq('id', ALGIA).single()
  const phoneId = c!.whatsapp_phone_id as string, appSecret = c!.whatsapp_app_secret as string

  async function send(text: string, tag: string) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '3245820722', phone_number_id: phoneId },
      contacts: [{ profile: { name: 'Smoke Esc' }, wa_id: TESTER }],
      messages: [{ from: TESTER, id: `wamid.SMOKEESC_${tag}`, timestamp: '1784668000', type: 'text', text: { body: text } }],
    } }] }] })
    const sig = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex')
    const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body })
    console.log(`[${tag}] "${text}" -> HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 3500))
  }
  await send('hola', 'CONSENT')                    // consentimiento (sin LLM)
  await send('quiero una colposcopia', 'COLPO')    // debe escalar DETERMINISTA (sin LLM)
  await send('quiero una cita de fisioterapia', 'BOOK')  // caso normal → llega a Haiku

  await new Promise((r) => setTimeout(r, 2000))
  const { data: conv } = await supa.from('conversations').select('id, status').eq('clinic_id', ALGIA).eq('whatsapp_phone', `+${TESTER}`).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (conv) {
    const { data: msgs } = await supa.from('messages').select('role, content').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(6)
    console.log('\nÚltimos mensajes:')
    for (const m of (msgs ?? []).reverse()) console.log(`  [${m.role}] ${String(m.content).slice(0, 130)}`)
    console.log('\nstatus conv:', conv.status, '| conv_id a limpiar:', conv.id)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
