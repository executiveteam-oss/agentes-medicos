// Lectura pura: ¿qué sabemos de la entrega de lo último que enviamos?
// Cruza messages (rol assistant) con whatsapp_message_status por wamid.
import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: msgs, error } = await db
    .from('messages')
    .select('id, created_at, role, delivery_status, delivery_error, whatsapp_message_id, content')
    .in('role', ['agent', 'staff'])
    .order('created_at', { ascending: false })
    .limit(15)
  if (error) throw error

  console.log('\n=== Últimos 15 mensajes salientes ===')
  for (const m of msgs ?? []) {
    const wamid = m.whatsapp_message_id ? String(m.whatsapp_message_id).slice(-10) : 'SIN-WAMID'
    console.log(
      `${m.created_at}  ${String(m.delivery_status ?? 'null').padEnd(10)}  …${wamid}  ${String(m.content ?? '').slice(0, 45).replace(/\n/g, ' ')}`,
    )
  }

  // Conteo real por estado (count exacto, sin tope de 1000 filas).
  const desde = new Date(Date.now() - 7 * 864e5).toISOString()
  console.log('\n=== whatsapp_message_status últimos 7 días ===')
  for (const estado of ['sent', 'delivered', 'read', 'failed']) {
    const { count } = await db
      .from('whatsapp_message_status')
      .select('wamid', { count: 'exact', head: true })
      .eq('status', estado)
      .gte('updated_at', desde)
    console.log(`  ${estado.padEnd(10)} ${count}`)
  }

  const { data: fallidos } = await db
    .from('whatsapp_message_status')
    .select('updated_at, error_code, error_title, recipient_tail')
    .eq('status', 'failed')
    .gte('updated_at', desde)
    .order('updated_at', { ascending: false })
    .limit(10)
  console.log('\n=== Últimos failed ===')
  for (const f of fallidos ?? []) console.log(`  ${f.updated_at}  code ${f.error_code}  ${f.error_title}  …${f.recipient_tail}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
