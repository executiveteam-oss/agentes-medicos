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
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
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
import { fetchHistoricoForDocumento, buildHistoricoPostBody, parseHistoricoRow, type HistoricoRow } from '../src/lib/isalud/historico-scraper'
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

// Corrida 2: browse de TODO el histórico por filtro_nombre (substring). Un
// substring común como "A" cubre casi todo; iteramos vocales con dedup global y
// loop-until-dry (una vocal para cuando deja de aportar filas nuevas). filtro_fecha
// no sirve por POST; el eje documento serían 15K requests — esto son ~cientos.
async function scrapeByNombre(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rateMs = parseInt(arg('--rate') ?? '1500', 10)
  const length = parseInt(arg('--length') ?? '500', 10)
  const letters = (arg('--letters') ?? 'A,E,I,O,U').split(',').map((x) => x.trim()).filter(Boolean)

  const { data: integ } = await supa.from('sync_integrations').select('credentials')
    .eq('clinic_id', ALGIA).eq('provider', 'isalud').neq('sync_status', 'disabled').limit(1).maybeSingle()
  const creds = integ!.credentials as ISaludCredentials
  const base = `https://${creds.subdomain}.isalud.co`
  const url = `${base}/historiaclinica.php/agenda/historicoAjax/action`

  const cacheDir = join(homedir(), '.omuwan-cache', 'algia-historico')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const ckptPath = join(cacheDir, 'browse-progress.json')
  const ckpt: Record<string, number | 'done'> = existsSync(ckptPath) ? JSON.parse(readFileSync(ckptPath, 'utf-8')) : {}

  // Set global de ids ya vistos (para dedup + loop-until-dry) — carga lo ya guardado.
  const seen = new Set<number>()
  let from = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_rows').select('isalud_agenda_id').eq('clinic_id', ALGIA).range(from, from + 999)
    const rows = data ?? []
    rows.forEach((r) => seen.add(Number((r as { isalud_agenda_id: number }).isalud_agenda_id)))
    if (rows.length < 1000) break
    from += 1000
  }
  console.log(`[scrape2] browse por nombre — letras=${letters.join(',')} length=${length} rate=${rateMs}ms — ids ya en DB=${seen.size}`)

  const { browser, context } = await launchBrowserAndContext()
  let rowsInserted = 0, errors = 0, requests = 0
  const t0 = Date.now()
  try {
    let page = await loginAndInjectCookies(context, creds)
    for (const letter of letters) {
      if (ckpt[letter] === 'done') { console.log(`  [${letter}] ya completo (checkpoint)`); continue }
      let start = typeof ckpt[letter] === 'number' ? (ckpt[letter] as number) : 0
      let total = Infinity
      let retries = 0
      while (start < total) {
        const body = buildHistoricoPostBody('', { start, length })
        body.filtro_documento = ''; body.filtro_nombre = letter
        try {
          const resp = await page.request.post(url, { form: body, headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 60000 })
          if (!resp.ok()) throw new Error(`status ${resp.status()}`)
          const j = (await resp.json()) as { recordsFiltered?: number; recordsTotal?: number; data?: Array<Record<string, unknown>> }
          requests++; retries = 0
          total = j.recordsFiltered ?? j.recordsTotal ?? 0
          const data = j.data ?? []
          if (data.length === 0) break
          const parsed = data.map(parseHistoricoRow).filter((r): r is HistoricoRow => r !== null)
          const fresh = parsed.filter((r) => !seen.has(r.isalud_agenda_id))
          const uniqueFresh = Array.from(new Map(fresh.map((r) => [r.isalud_agenda_id, r])).values())
          if (uniqueFresh.length > 0) {
            const { error } = await supa.from('isalud_historico_rows').upsert(uniqueFresh.map((r) => ({ clinic_id: ALGIA, ...r })), { onConflict: 'clinic_id,isalud_agenda_id' })
            if (error) throw new Error(`upsert: ${error.message}`)
            uniqueFresh.forEach((r) => seen.add(r.isalud_agenda_id))
            rowsInserted += uniqueFresh.length
          }
          start += length
          ckpt[letter] = start; writeFileSync(ckptPath, JSON.stringify(ckpt))
          if (start % (length * 20) === 0 || start >= total) console.log(`  [${letter}] ${start}/${total} nuevas=${rowsInserted} reqs=${requests} ${Math.round((Date.now() - t0) / 1000)}s`)
        } catch (e) {
          errors++; retries++
          console.log(`  [${letter}] error start=${start} (intento ${retries}): ${e instanceof Error ? e.message : e}`)
          if (retries >= 3) { console.log(`  [${letter}] 3 fallos en start=${start} → avanzo para no trabar`); start += length; retries = 0 }
          else { page = await ensureSession(context, creds, page) }
        }
        await sleep(rateMs)
      }
      ckpt[letter] = 'done'; writeFileSync(ckptPath, JSON.stringify(ckpt))
      console.log(`  [${letter}] COMPLETO`)
    }
  } finally {
    await context.close(); await browser.close()
  }

  console.log('\n════════ REPORTE DE CIERRE — SCRAPE 2 (browse por nombre) ════════')
  console.log(`  requests:                 ${requests}`)
  console.log(`  filas nuevas insertadas:  ${rowsInserted}`)
  console.log(`  errores:                  ${errors}`)
  console.log(`  duración:                 ${Math.round((Date.now() - t0) / 1000)}s`)

  // Verificación de cobertura
  const { count: totalRows } = await supa.from('isalud_historico_rows').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  const distinctSet = new Set<string>()
  let f = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_rows').select('documento').eq('clinic_id', ALGIA).range(f, f + 999)
    const rows = data ?? []
    rows.forEach((r) => distinctSet.add(String((r as { documento: string }).documento)))
    if (rows.length < 1000) break
    f += 1000
  }
  const distinct = distinctSet.size
  const clientesCache = documentosCorrida2().length
  console.log('\n════════ VERIFICACIÓN DE COBERTURA ════════')
  console.log(`  filas totales en isalud_historico_rows: ${totalRows}   (recordsTotal esperado ~56K)`)
  console.log(`  documentos distintos con histórico:     ${distinct}`)
  console.log(`  documentos en cache de clientes:        ${clientesCache}  (~15K)`)
  console.log(`  → si las filas quedan MUY por debajo de ~56K, faltan nombres: agregar vocales/consonantes con --letters`)

  await derive(supa)
}

async function derive(supa: SupabaseClient): Promise<void> {
  console.log('\n[derive] derivando entidad (más reciente) + tratante (consulta)…')
  const { data: docs } = await supa.from('doctors').select('id, name, is_active').eq('clinic_id', ALGIA)
  const activeDocMap = new Map<string, string>()
  ;(docs ?? []).forEach((d) => { const x = d as { id: string; name: string; is_active: boolean }; if (x.is_active) activeDocMap.set(canonize(x.name), x.id) })
  const resolveDoctorId = (profesional: string): string | null => activeDocMap.get(canonize(profesional)) ?? null
  console.log(`[derive] médicos activos para matcheo de tratante: ${activeDocMap.size}`)

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

  // Solo derivamos sobre documentos que son de un paciente (los demás rows del
  // histórico se guardan pero no hay patient que actualizar) — evita 14.5K UPDATE no-op.
  const patientDocs = new Set<string>()
  {
    const { data: pd } = await supa.from('patients').select('document_number').eq('clinic_id', ALGIA).not('document_number', 'is', null)
    ;(pd ?? []).forEach((r) => patientDocs.add(String((r as { document_number: string }).document_number)))
  }
  const toDerive = [...documentos].filter((d) => patientDocs.has(d))
  console.log(`[derive] documentos con filas=${documentos.size}, de pacientes=${toDerive.length}`)

  let withEntidad = 0, withTratante = 0, patientsUpdated = 0
  for (const documento of toDerive) {
    const { data: rowsRaw } = await supa.from('isalud_historico_rows')
      .select('aseguradora, profesional, servicio, procedimiento, fecha, inicio, isalud_agenda_id')
      .eq('clinic_id', ALGIA).eq('documento', documento)
    const rows = (rowsRaw ?? []) as DerivRow[]
    const entidad = deriveEntidad(rows)
    const tratanteId = deriveTratante(rows, resolveDoctorId) // consulta Y médico ACTIVO
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
  console.log(`  con tratante (consulta+médico activo): ${withTratante}`)
  console.log(`  pacientes actualizados:          ${patientsUpdated}`)
  console.log(`  → patients con entidad_isalud:   ${cntEntidad}`)
  console.log(`  → patients con tratante_doctor:  ${cntTratante}`)
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  if (has('--derive')) { await derive(supa); return }
  if (has('--patients-imported')) { await scrape('patients-imported'); return }
  if (has('--all')) { await scrapeByNombre(); return }
  console.error('Especificá un modo: --patients-imported | --all | --derive'); process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
