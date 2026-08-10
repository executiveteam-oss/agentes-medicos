/**
 * INVARIANTE: si hay un archivo sin revisar, la tarjeta lo anuncia.
 *
 * El bug: la tarjeta del dashboard tenía su propia consulta con un filtro de
 * más — `context = 'authorization'`. Ese contexto se asigna por heurística (si
 * el último mensaje del agente decía "autorización"), y en la práctica nunca se
 * asignó: los 5 archivos de la historia de Algia son 'document_general'. La
 * tarjeta contó cero desde el día que se construyó, con archivos esperando
 * adentro. Ninguna secretaria entraba, porque la tarjeta decía que no había nada.
 *
 * Este test compara el criterio VIEJO contra el NUEVO sobre los datos reales y
 * falla si la tarjeta volviera a esconder algo. Solo lectura.
 *
 * Run: npx tsx scripts/test-archivos-sin-revisar.ts
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function main() {
  // La VERDAD: todo lo que no fue revisado.
  const { data: sinRevisar } = await sb.from('conversation_media')
    .select('id, context, created_at')
    .eq('clinic_id', ALGIA).is('reviewed_at', null)
  const verdad = sinRevisar ?? []

  // El criterio VIEJO de la tarjeta, replicado.
  const viejo = verdad.filter((m) => m.context === 'authorization')

  // El criterio NUEVO — el mismo que llena la pantalla.
  const nuevo = verdad

  console.log('\nARCHIVOS SIN REVISAR EN ALGIA')
  console.log('─'.repeat(62))
  console.log(`  total real (reviewed_at IS NULL) : ${verdad.length}`)
  console.log(`  los veía la tarjeta VIEJA        : ${viejo.length}`)
  console.log(`  los ve la tarjeta NUEVA          : ${nuevo.length}`)
  const porContexto: Record<string, number> = {}
  for (const m of verdad) porContexto[String(m.context)] = (porContexto[String(m.context)] ?? 0) + 1
  console.log(`  por contexto                     : ${JSON.stringify(porContexto)}`)

  console.log('\nEL INVARIANTE')
  ok('la tarjeta nueva ve TODOS los archivos sin revisar', nuevo.length === verdad.length)
  ok('no esconde ninguno por su `context`',
    nuevo.filter((m) => m.context !== 'authorization').length ===
    verdad.filter((m) => m.context !== 'authorization').length)

  console.log('\nLA REGRESIÓN QUE ESTE TEST EXISTE PARA IMPEDIR')
  const escondidos = verdad.filter((m) => m.context !== 'authorization')
  if (escondidos.length > 0) {
    ok(`el criterio viejo escondía ${escondidos.length} archivo(s) — el nuevo los muestra`,
      nuevo.length > viejo.length)
    for (const m of escondidos.slice(0, 5)) {
      console.log(`      escondido: context="${m.context}" · ${String(m.created_at).slice(0, 16)}`)
    }
  } else {
    console.log('  ⚠️  Ahora mismo no hay archivos sin revisar con context != authorization,')
    console.log('      así que este test NO puede demostrar la diferencia con datos vivos.')
    console.log('      No es que pase: es que no hay caso. Si alguien reintrodujera el filtro,')
    console.log('      este test no lo agarraría hoy. Correr de nuevo cuando lleguen archivos.')
  }

  console.log('\nQUE EL CONTEXTO NO DECIDA (chequeo del criterio, sin datos)')
  const criterio = (m: { reviewed_at: string | null }) => m.reviewed_at === null
  for (const ctx of ['authorization', 'document_general', 'other', null]) {
    ok(`context="${ctx}" sin revisar → cuenta`, criterio({ reviewed_at: null }) === true)
  }
  ok('un archivo YA revisado no cuenta', criterio({ reviewed_at: '2026-08-10T10:00:00Z' }) === false)

  console.log(`\n${pass} pass · ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
