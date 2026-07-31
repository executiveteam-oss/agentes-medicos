/**
 * ⏳ MIGRACIÓN ALGIA — extracción del histórico iSalud (un solo uso).
 *
 * Modos:
 *   --patients-imported   corrida 1: cédulas de patients ya importados (489)
 *   --all                 corrida 2: todas las cédulas del cache de clientes
 *   --derive              solo derivar entidad+tratante desde filas ya guardadas
 *   --rate <ms>           rate limit entre cédulas (default 1500)
 *   --limit <n>           procesar máximo n cédulas (para pruebas)
 *
 * Reanudable: saltea cédulas ya OK en isalud_historico_scrape_log; UPSERT de
 * filas por (clinic_id, isalud_agenda_id). Re-login si la sesión rebota.
 * Reporte de cierre con números reales.
 *
 * Run: TZ=America/Bogota ulimit -c 0 && npx tsx scripts/scrape-isalud-historico.ts --patients-imported
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
function loadEnv(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv('.env.production.local'); loadEnv('.env.local')

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BrowserContext, Page } from 'playwright-core'
import { launchBrowserAndContext, loginAndInjectCookies, type ISaludCredentials } from '../src/lib/isalud/adapter'
import { fetchHistoricoForDocumento } from '../src/lib/isalud/historico-scraper'
import { deriveEntidad, deriveTratante, type DerivRow } from '../src/lib/isalud/entidad-tratante-derivation'
import { canonize } from '../src/lib/isalud/name-matcher'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const arg = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined }
const has = (flag: string): boolean => process.argv.includes(flag)

async function documentosCorrida1(supa: SupabaseClient): Promise<string[]> {
  const { data } = await supa.from('patients').select('document_number')
    .eq('clinic_id', ALGIA).not('document_number', 'is', null).neq('document_number', '')
  return Array.from(new Set((data ?? []).map((r) => String((r as { document_number: string }).document_number).trim()).filter(Boolean)))
}

function documentosCorrida2(): string[] {
  const dir = join(homedir(), '.omuwan-cache', 'algia-clientes')
  if (!existsSync(dir)) { console.error(`[scrape] cache de clientes no existe: ${dir}`); return [] }
  const set = new Set<string>()
  for (const f of readdirSync(dir).filter((x) => x.startsWith('batch-') && x.endsWith('.json'))) {
    try {
      const arr = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Array<{ documento?: string }>
      for (const c of arr) { const d = (c.documento ?? '').trim(); if (d) set.add(d) }
    } catch { /* batch corrupto, skip */ }
  }
  return Array.from(set)
}

async function alreadyDone(supa: SupabaseClient): Promise<Set<string>> {
  const done = new Set<string>()
  // paginar por si son muchas
  let from = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_scrape_log').select('documento')
      .eq('clinic_id', ALGIA).eq('ok', true).range(from, from + 999)
    const rows = data ?? []
    rows.forEach((r) => done.add(String((r as { documento: string }).documento)))
    if (rows.length < 1000) break
    from += 1000
  }
  return done
}

async function ensureSession(ctx: BrowserContext, creds: ISaludCredentials, page: Page): Promise<Page> {
  // Prueba barata: pedir el AJAX; si la sesión murió, re-loguear.
  try {
    const resp = await page.request.post(`https://${creds.subdomain}.isalud.co/historiaclinica.php/agenda/historicoAjax/action`,
      { form: { draw: '1', start: '0', length: '1', filtro_documento: '0', filtro_fases: '-1' }, headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 20000 })
    if (resp.ok()) { try { await resp.json(); return page } catch { /* html → sesión caída */ } }
  } catch { /* re-login abajo */ }
  console.log('[scrape] sesión caída — re-login…')
  return loginAndInjectCookies(ctx, creds)
}

async function scrape(mode: 'patients-imported' | 'all'): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rateMs = parseInt(arg('--rate') ?? '1500', 10)
  const limit = arg('--limit') ? parseInt(arg('--limit')!, 10) : Infinity

  const { data: integ } = await supa.from('sync_integrations').select('credentials')
    .eq('clinic_id', ALGIA).eq('provider', 'isalud').neq('sync_status', 'disabled').limit(1).maybeSingle()
  const creds = integ!.credentials as ISaludCredentials
  const base = `https://${creds.subdomain}.isalud.co`

  const all = mode === 'patients-imported' ? await documentosCorrida1(supa) : documentosCorrida2()
  const done = await alreadyDone(supa)
  const pending = all.filter((d) => !done.has(d)).slice(0, limit)
  console.log(`[scrape] modo=${mode} rate=${rateMs}ms — cédulas totales=${all.length}, ya hechas=${done.size}, pendientes a procesar=${pending.length}`)

  const { browser, context } = await launchBrowserAndContext()
  let processed = 0, zero = 0, errors = 0, rowsInserted = 0
  const t0 = Date.now()
  try {
    let page = await loginAndInjectCookies(context, creds)
    for (const documento of pending) {
      processed++
      try {
        const rows = await fetchHistoricoForDocumento(page, base, documento)
        // Dedup por isalud_agenda_id: iSalud puede devolver la misma agenda 2×,
        // y un upsert no admite la misma clave de conflicto dos veces en un lote.
        const unique = Array.from(new Map(rows.map((r) => [r.isalud_agenda_id, r])).values())
        if (unique.length === 0) { zero++ }
        else {
          const payload = unique.map((r) => ({ clinic_id: ALGIA, ...r }))
          const { error } = await supa.from('isalud_historico_rows').upsert(payload, { onConflict: 'clinic_id,isalud_agenda_id' })
          if (error) throw new Error(`upsert: ${error.message}`)
          rowsInserted += unique.length
        }
        await supa.from('isalud_historico_scrape_log').upsert({ clinic_id: ALGIA, documento, row_count: unique.length, ok: true, error: null, scraped_at: new Date().toISOString() }, { onConflict: 'clinic_id,documento' })
      } catch (e) {
        errors++
        const msg = e instanceof Error ? e.message : String(e)
        await supa.from('isalud_historico_scrape_log').upsert({ clinic_id: ALGIA, documento, row_count: 0, ok: false, error: msg.slice(0, 300), scraped_at: new Date().toISOString() }, { onConflict: 'clinic_id,documento' })
        page = await ensureSession(context, creds, page) // recuperar sesión si fue eso
      }
      if (processed % 25 === 0 || processed === pending.length) {
        const secs = Math.round((Date.now() - t0) / 1000)
        console.log(`  [${processed}/${pending.length}] ${secs}s — 0filas=${zero} errores=${errors} filas=${rowsInserted}`)
      }
      await sleep(rateMs)
    }
  } finally {
    await context.close(); await browser.close()
  }

  console.log('\n════════ REPORTE DE CIERRE — SCRAPE ════════')
  console.log(`  cédulas procesadas:      ${processed}`)
  console.log(`  con 0 filas de histórico: ${zero}`)
  console.log(`  con error:                ${errors}`)
  console.log(`  filas insertadas/upsert:  ${rowsInserted}`)
  console.log(`  duración:                 ${Math.round((Date.now() - t0) / 1000)}s`)

  await derive(supa)
}

async function derive(supa: SupabaseClient): Promise<void> {
  console.log('\n[derive] derivando entidad (más reciente) + tratante (consulta)…')
  const { data: docs } = await supa.from('doctors').select('id, name').eq('clinic_id', ALGIA)
  const docMap = new Map<string, string>()
  ;(docs ?? []).forEach((d) => docMap.set(canonize((d as { name: string }).name), (d as { id: string }).id))

  // documentos con filas
  const documentos = new Set<string>()
  let from = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_rows').select('documento').eq('clinic_id', ALGIA).range(from, from + 999)
    const rows = data ?? []
    rows.forEach((r) => documentos.add(String((r as { documento: string }).documento)))
    if (rows.length < 1000) break
    from += 1000
  }

  let withEntidad = 0, withTratante = 0, tratanteUnmatched = 0, patientsUpdated = 0
  for (const documento of documentos) {
    const { data: rowsRaw } = await supa.from('isalud_historico_rows')
      .select('aseguradora, profesional, servicio, procedimiento, fecha, inicio, isalud_agenda_id')
      .eq('clinic_id', ALGIA).eq('documento', documento)
    const rows = (rowsRaw ?? []) as DerivRow[]
    const entidad = deriveEntidad(rows)
    const tratanteName = deriveTratante(rows)
    let tratanteId: string | null = null
    if (tratanteName) { tratanteId = docMap.get(canonize(tratanteName)) ?? null; if (!tratanteId) tratanteUnmatched++ }
    if (entidad) withEntidad++
    if (tratanteId) withTratante++
    const { data: upd } = await supa.from('patients')
      .update({ entidad_isalud: entidad, tratante_doctor_id: tratanteId })
      .eq('clinic_id', ALGIA).eq('document_number', documento).select('id')
    if ((upd ?? []).length > 0) patientsUpdated++
  }

  // Conteo real en patients tras derivar
  const { count: cntEntidad } = await supa.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA).not('entidad_isalud', 'is', null)
  const { count: cntTratante } = await supa.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA).not('tratante_doctor_id', 'is', null)

  console.log('\n════════ REPORTE DE CIERRE — DERIVACIÓN ════════')
  console.log(`  documentos con filas:            ${documentos.size}`)
  console.log(`  con entidad derivada:            ${withEntidad}`)
  console.log(`  con tratante (consulta) derivado: ${withTratante}`)
  console.log(`  tratante sin match a doctor:     ${tratanteUnmatched}`)
  console.log(`  pacientes actualizados:          ${patientsUpdated}`)
  console.log(`  → patients con entidad_isalud:   ${cntEntidad}`)
  console.log(`  → patients con tratante_doctor:  ${cntTratante}`)
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  if (has('--derive')) { await derive(supa); return }
  if (has('--patients-imported')) { await scrape('patients-imported'); return }
  if (has('--all')) { await scrape('all'); return }
  console.error('Especificá un modo: --patients-imported | --all | --derive'); process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
