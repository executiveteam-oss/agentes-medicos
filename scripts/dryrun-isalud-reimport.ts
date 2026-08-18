/**
 * DRY-RUN del re-import de la agenda de iSalud. NO ESCRIBE NADA.
 *
 * Scrapea iSalud igual que el cron (mismo adapter, mismo horizonte) y compara
 * contra la base, respondiendo lo único que importa antes de aplicar:
 *
 *   · cuántas filas se insertarían y cuántas se actualizarían
 *   · cuántas quedarían con la hora VIEJA (el UPDATE no toca starts_at)
 *   · cuántas chocarían exacto con la constraint → caerían a blocked_external
 *   · cuántas SOLAPARÍAN sin chocar → dos citas en el mismo cupo, en silencio
 *
 * Ese último es el que la constraint no ve: UNIQUE (doctor_id, starts_at) compara
 * el inicio EXACTO. Una cita de iSalud a las 10:15 contra una de Omuwan de
 * 10:00 a 10:30 entra sin ruido y quedan las dos.
 *
 * Run: NODE_ENV=development TZ=America/Bogota npx tsx scripts/dryrun-isalud-reimport.ts
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { scrapeISalud, type ISaludAdmision } from '../src/lib/isalud/adapter'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

interface FilaDB {
  id: string; doctor_id: string; starts_at: string; ends_at: string
  status: string; external_his_id: string | null; external_source: string | null
}

/** Réplica EXACTA del cálculo de sync-agent.ts. Si divergen, este dry-run miente. */
function tiempos(adm: ISaludAdmision): { inicio: Date; fin: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(adm.fecha)) return null
  if (!adm.hora_inicial?.includes(':')) return null
  const [h, m] = adm.hora_inicial.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  const inicio = new Date(`${adm.fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`)
  let fin: Date
  if (adm.hora_final?.includes(':')) {
    const [eh, em] = adm.hora_final.split(':').map(Number)
    fin = !isNaN(eh) && !isNaN(em)
      ? new Date(`${adm.fecha}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00-05:00`)
      : new Date(inicio.getTime() + 30 * 60_000)
  } else {
    fin = new Date(inicio.getTime() + 30 * 60_000)
  }
  return { inicio, fin }
}

const cot = (d: Date | string) =>
  new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

async function main() {
  console.log('╔' + '═'.repeat(66) + '╗')
  console.log('║  DRY-RUN re-import iSalud — NO ESCRIBE NADA' + ' '.repeat(23) + '║')
  console.log('╚' + '═'.repeat(66) + '╝\n')

  const { data: integ } = await sb.from('sync_integrations')
    .select('credentials, config').eq('clinic_id', ALGIA).eq('provider', 'isalud').maybeSingle()
  if (!integ) { console.error('No hay integración iSalud para Algia.'); process.exit(1) }
  const creds = integ.credentials as { subdomain: string; username: string; password: string }
  const dias = (integ.config as { dias_adelante?: number })?.dias_adelante ?? 60

  console.log(`Scrapeando ${creds.subdomain} · horizonte ${dias} días…`)
  const t0 = Date.now()
  const res = await scrapeISalud(creds, { diasAdelante: dias })
  console.log(`Scrape terminado en ${Math.round((Date.now() - t0) / 1000)}s`)
  console.log(`  admisiones: ${res.admisiones.length} · profesionales: ${res.profesionales.length} · errores: ${res.errors.length}`)
  for (const e of res.errors.slice(0, 5)) console.log(`    ⚠️  ${e}`)

  // ---- estado actual de la base ----
  const filas: FilaDB[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data } = await sb.from('appointments')
      .select('id, doctor_id, starts_at, ends_at, status, external_his_id, external_source')
      .eq('clinic_id', ALGIA).range(desde, desde + 999)
    if (!data?.length) break
    filas.push(...(data as FilaDB[]))
    if (data.length < 1000) break
  }
  const porExt = new Map(filas.filter(f => f.external_his_id).map(f => [f.external_his_id as string, f]))
  console.log(`\nBase: ${filas.length} citas de Algia (${porExt.size} con external_his_id)\n`)

  // ---- mapeo de profesional → doctor_id (para calcular colisiones) ----
  const { data: maps } = await sb.from('doctor_external_mappings')
    .select('doctor_id, external_name').eq('clinic_id', ALGIA).eq('provider', 'isalud')
  const doctorDe = new Map((maps ?? []).map(m => [m.external_name as string, m.doctor_id as string]))

  // ---- clasificar cada admisión ----
  const nuevas: { adm: ISaludAdmision; inicio: Date; fin: Date; doctorId: string | null }[] = []
  const existentes: { adm: ISaludAdmision; inicio: Date; fila: FilaDB }[] = []
  let sinFecha = 0, sinMapeo = 0

  for (const adm of res.admisiones) {
    const t = tiempos(adm)
    if (!t) { sinFecha++; continue }
    const extId = `isalud-${adm.id}-${adm.fecha}`
    const fila = porExt.get(extId)
    if (fila) existentes.push({ adm, inicio: t.inicio, fila })
    else {
      const doctorId = doctorDe.get(adm.profesional_nombre) ?? null
      if (!doctorId) sinMapeo++
      nuevas.push({ adm, inicio: t.inicio, fin: t.fin, doctorId })
    }
  }

  console.log('─'.repeat(68))
  console.log('QUÉ HARÍA EL IMPORT')
  console.log('─'.repeat(68))
  console.log(`  UPDATE (ya existen por external_his_id): ${existentes.length}`)
  console.log(`  INSERT (nuevas):                         ${nuevas.length}`)
  console.log(`  descartadas por fecha/hora inválida:     ${sinFecha}`)
  if (sinMapeo) console.log(`  ⚠️  nuevas sin mapeo de médico (crearían doctor): ${sinMapeo}`)

  // ---- las que NO se van a arreglar ----
  const desfasadas = existentes.filter(e => new Date(e.fila.starts_at).getTime() !== e.inicio.getTime())
  const desfasadasFuturas = desfasadas.filter(e => new Date(e.fila.starts_at) > new Date())
  console.log('\n' + '─'.repeat(68))
  console.log('LO QUE EL RE-IMPORT **NO** ARREGLA')
  console.log('─'.repeat(68))
  console.log(`  Citas cuya hora cambió en iSalud: ${desfasadas.length} (${desfasadasFuturas.length} futuras)`)
  console.log(`  El UPDATE no toca starts_at/ends_at → quedan con la hora vieja.`)
  for (const e of desfasadasFuturas.slice(0, 12)) {
    console.log(`    ${(e.adm.nombre_paciente || '(bloqueo)').slice(0, 22).padEnd(22)} ` +
                `Omuwan ${cot(e.fila.starts_at)}  →  iSalud ${cot(e.inicio)}`)
  }

  // ---- colisiones de las nuevas ----
  const activas = filas.filter(f => ['confirmed', 'rescheduled'].includes(f.status))
  let choqueExacto = 0
  const solapes: { adm: ISaludAdmision; inicio: Date; fin: Date; contra: FilaDB }[] = []

  for (const n of nuevas) {
    if (!n.doctorId) continue
    const mismoMedico = activas.filter(f => f.doctor_id === n.doctorId)
    if (mismoMedico.some(f => new Date(f.starts_at).getTime() === n.inicio.getTime())) { choqueExacto++; continue }
    for (const f of mismoMedico) {
      const fi = new Date(f.starts_at).getTime(), ff = new Date(f.ends_at).getTime()
      if (n.inicio.getTime() < ff && fi < n.fin.getTime()) solapes.push({ ...n, contra: f })
    }
  }
  const solapesOmuwan = solapes.filter(s => s.contra.external_source !== 'isalud')

  console.log('\n' + '─'.repeat(68))
  console.log('COLISIONES DE LAS NUEVAS')
  console.log('─'.repeat(68))
  console.log(`  Choque EXACTO (constraint lo atrapa → cae a blocked_external): ${choqueExacto}`)
  console.log(`  SOLAPAMIENTO sin choque (entra en silencio, dos en el cupo):    ${solapes.length}`)
  console.log(`      …contra una cita de OMUWAN (agente/dashboard/manual):      ${solapesOmuwan.length}`)
  for (const s of solapesOmuwan.slice(0, 15)) {
    console.log(`    ${(s.adm.nombre_paciente || '(bloqueo)').slice(0, 20).padEnd(20)} ` +
                `iSalud ${cot(s.inicio)}-${cot(s.fin).slice(-5)}  vs  Omuwan ${cot(s.contra.starts_at)}-${cot(s.contra.ends_at).slice(-5)}`)
  }

  console.log('\n' + '═'.repeat(68))
  console.log('NADA DE ESTO SE ESCRIBIÓ. Dry-run solamente.')
  console.log('═'.repeat(68))
}

main().catch(e => { console.error('FALLÓ:', e instanceof Error ? e.stack : e); process.exit(1) })
