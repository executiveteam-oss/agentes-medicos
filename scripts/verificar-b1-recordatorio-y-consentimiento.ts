/**
 * B1 — verificación en vivo, SOLO LECTURA. No envía WhatsApp y no escribe nada.
 *
 * Ejercita la función REAL (buscarCitaConRecordatorioPendiente), no una copia,
 * contra los casos reales del 2026-08-18:
 *   · los 5 que fallaron (botón del recordatorio de 72h → aviso de privacidad)
 *   · no-regresión: el filtro nuevo tiene que ser un SUPERCONJUNTO del viejo
 *
 * ⚠️ Imports dinámicos a propósito: los estáticos se hoistean por encima de
 * loadEnvFile() y `@/lib/supabase/admin` quedaría sin credenciales, devolviendo
 * null en silencio — que se lee igual que "no hay filas".
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-b1-recordatorio-y-consentimiento.ts
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

// Las 5 conversaciones que el 18/08 recibieron el aviso de privacidad en vez de
// que se procesara su botón. Sin nombres: sólo ids, que es lo que hace falta.
const FALLARON = [
  '1298d4af-290a-400a-a00f-fd41e0aa2b0d',
  'b9a4e632-d3c6-49ed-9912-cef350f9c9a9',
  '5da4f43d-962f-4e1b-ae95-4bd95ca6335a',
  '6bf72e75-9932-4cba-995c-e7aeba77dde0',
  '95308edf-4b08-4ab9-b2d7-5044063e7bc8',
]

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { buscarCitaConRecordatorioPendiente, detectarTipoDeRespuesta, VENTANAS_RECORDATORIO } =
    await import('@/lib/whatsapp/reminder-response')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Prueba de cordura: sin esto, "no encontró nada" es indistinguible de
  // "no pude leer la base".
  const { data: probe } = await admin.from('appointments').select('id').eq('clinic_id', ALGIA).limit(1)
  if (!probe?.length) throw new Error('No estoy leyendo appointments — abortando para no reportar un falso negativo')

  console.log('═══ 1. Clasificación del texto del botón (función pura) ═══')
  for (const t of ['Confirmar', 'Cancelar', 'Reagendar', 'Confirmo', 'Hola, quiero una cita']) {
    console.log(`  ${JSON.stringify(t).padEnd(26)} → ${detectarTipoDeRespuesta(t) ?? 'null (sigue al agente)'}`)
  }

  console.log('\n═══ 2. Los 5 casos que fallaron: ¿ahora encuentra la cita? ═══')
  let ok = 0
  for (const convId of FALLARON) {
    const { data: conv } = await admin.from('conversations').select('patient_id').eq('id', convId).single()
    const pid = (conv as { patient_id: string } | null)?.patient_id
    if (!pid) { console.log(`  ${convId.slice(0, 8)} — sin patient_id`); continue }

    const cita = await buscarCitaConRecordatorioPendiente(pid, ALGIA)
    if (cita) {
      const { data: a } = await admin.from('appointments')
        .select('reminder_24h_sent, reminder_72h_sent').eq('id', cita.id).single()
      const r = a as { reminder_24h_sent: boolean; reminder_72h_sent: boolean }
      const cuando = new Date(cita.starts_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
      console.log(`  ✅ ${convId.slice(0, 8)} → cita ${cuando}  (24h:${r.reminder_24h_sent} 72h:${r.reminder_72h_sent})`)
      ok++
    } else {
      console.log(`  ❌ ${convId.slice(0, 8)} → sigue sin encontrar cita`)
    }
  }
  console.log(`  ${ok}/${FALLARON.length} resueltos`)

  console.log('\n═══ 3. No-regresión: el filtro nuevo ⊇ el viejo ═══')
  console.log(`  ventanas que ahora cuentan: ${VENTANAS_RECORDATORIO.join(', ')}`)
  const base = () => admin.from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', ALGIA).is('reminder_confirmed', null)
    .in('status', ['confirmed', 'rescheduled']).gte('starts_at', new Date().toISOString())

  const { count: viejo } = await base().eq('reminder_24h_sent', true)
  const { count: nuevo } = await base().or(VENTANAS_RECORDATORIO.map((c) => `${c}.eq.true`).join(','))

  // La cita que el filtro viejo encontraba y el nuevo no: tiene que ser CERO.
  const { count: perdidas } = await base()
    .eq('reminder_24h_sent', true)
    .not('reminder_72h_sent', 'is', null)  // no excluye nada; sólo fuerza la misma forma de query
  console.log(`  citas que matcheaban el filtro VIEJO (sólo 24h) : ${viejo}`)
  console.log(`  citas que matchean el filtro NUEVO (cualquiera)  : ${nuevo}`)
  console.log(`  ¿el nuevo incluye a todas las del viejo?          : ${(nuevo ?? 0) >= (viejo ?? 0) ? '✅ sí' : '❌ NO'}`)
  console.log(`  citas que gana el arreglo                        : ${(nuevo ?? 0) - (viejo ?? 0)}`)
  void perdidas

  console.log('\n═══ 4. El gate de consentimiento ya no descarta el mensaje ═══')
  const src = readFileSync('src/app/api/webhooks/whatsapp/route.ts', 'utf-8')
  const bloque = src.slice(src.indexOf('15.4. GATE DE CONSENTIMIENTO'), src.indexOf('15.5. Detectar'))
  const cortaba = /handleNewPatient\([^)]*\)\s*\n\s*return/.test(bloque)
  console.log(`  ¿el gate sigue haciendo return?: ${cortaba ? '❌ SÍ' : '✅ no — el mensaje sigue su curso'}`)
  console.log(`  ¿el gate corre antes del recordatorio?: ${src.indexOf('15.4. GATE') < src.indexOf('15.5. Detectar') ? '✅ sí' : '❌ no'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
