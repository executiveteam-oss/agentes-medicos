/**
 * Compara lo que la paciente REALMENTE recibió después del deploy del contrato
 * de salida contra lo que habría recibido antes.
 *
 * No hay que adivinar nada: el webhook audita `contrato_salida_descarto` con los
 * bloques que el contrato dejó afuera, así que el mensaje viejo se reconstruye
 * exacto = bloques descartados + mensaje enviado, unidos con '\n\n'.
 * Un turno sin fila de auditoría es un turno donde viejo y nuevo coinciden.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sombra/comparar-hoy.mts [--desde <epoch_ms>] [--limite N]
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const a = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i+1]) : d }
const DESDE = new Date(a('--desde', 1787337206492)).toISOString()
const LIM = a('--limite', 40)
const hora = (s: string) => new Date(s).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })

const { data: convs } = await db.from('conversations').select('id, patients(name)').eq('clinic_id', ALGIA)
const nombre = new Map((convs ?? []).map((c) => [c.id as string, ((c.patients as unknown as {name?:string}|null)?.name) ?? '?']))

const { data: msgs } = await db.from('messages')
  .select('id, conversation_id, role, content, created_at, delivery_status')
  .in('conversation_id', (convs ?? []).map((c) => c.id as string))
  .gte('created_at', DESDE).order('created_at', { ascending: true }).limit(2000)
const lista = (msgs ?? []) as Array<Record<string, unknown>>
const agente = lista.filter((m) => m.role === 'agent').slice(0, LIM)

const { data: audit } = await db.from('audit_log')
  .select('target_id, details, created_at').eq('clinic_id', ALGIA)
  .eq('action', 'contrato_salida_descarto').gte('created_at', DESDE)
  .order('created_at', { ascending: true })

console.log(`\n═══ CONVERSACIONES REALES DESPUÉS DEL DEPLOY (desde ${hora(DESDE)}) ═══`)
console.log(`turnos del agente: ${agente.length}  ·  turnos donde el contrato descartó algo: ${(audit ?? []).length}\n`)

let cambiaron = 0
for (const m of agente) {
  // La fila de auditoría se escribe justo antes de guardar el mensaje.
  const fila = (audit ?? []).find((x) =>
    x.target_id === m.conversation_id &&
    Math.abs(new Date(m.created_at as string).getTime() - new Date(x.created_at as string).getTime()) < 30_000)
  const enviado = m.content as string
  const previo = lista.filter((x) => x.conversation_id === m.conversation_id && x.role === 'patient'
      && new Date(x.created_at as string) < new Date(m.created_at as string)).pop()
  console.log('─'.repeat(72))
  console.log(`${hora(m.created_at as string)} · ${nombre.get(m.conversation_id as string)} · entrega=${m.delivery_status ?? '—'}`)
  if (previo) console.log(`  PACIENTE : ${String(previo.content).slice(0, 160).replace(/\n/g, ' | ')}`)
  if (!fila) { console.log(`  = SIN CAMBIO (el contrato no descartó nada)`); console.log(`  ENVIADO  : ${enviado.slice(0,300).replace(/\n/g,' | ')}`); continue }
  cambiaron++
  const d = fila.details as { origen: string; descartados: number; bloques: string[] }
  console.log(`  ⚠ CAMBIÓ — regla: ${d.origen} · descartó ${d.descartados} bloque(s)`)
  console.log(`  ANTES habría recibido, ADEMÁS:`)
  for (const b of d.bloques) console.log(`      ✂ ${b.slice(0, 260).replace(/\n/g, ' | ')}`)
  console.log(`  RECIBIÓ  : ${enviado.slice(0, 400).replace(/\n/g, ' | ')}`)
}
console.log('─'.repeat(72))
console.log(`\n${cambiaron} de ${agente.length} turnos habrían salido distintos antes del deploy.\n`)
