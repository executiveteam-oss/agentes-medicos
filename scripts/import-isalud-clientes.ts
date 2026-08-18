/**
 * ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
 *
 * Orquesta el import de pacientes desde iSalud /cliente → patients de Omuwan.
 *
 * Flujo:
 *   1. Carga env (.env.local)
 *   2. Lee credenciales iSalud desde sync_integrations (Algia)
 *   3. Login Playwright + cookies
 *   4. Scrape de /cliente paginado con checkpoint
 *   5. Carga nombres de appointments.reason (Algia) + indexa
 *   6. Filtra clientes que NO matchean nombre (descarta los 14k inactivos)
 *   7. Para cada cliente filtrado, matchea contra patients existentes
 *   8. DRY-RUN: imprime conteos + lista casos ambiguos
 *   9. Si --apply: INSERT/UPDATE pacientes reales + audit_log
 *
 * Run dry-run (default, NO inserta):
 *   TZ=America/Bogota npx tsx scripts/import-isalud-clientes.ts
 *
 * Run apply (SOLO tras revisar dry-run):
 *   TZ=America/Bogota npx tsx scripts/import-isalud-clientes.ts --apply
 *
 * Otros flags:
 *   --fresh        : ignora checkpoint, scrape de cero (BORRA ~/.omuwan-cache/algia-clientes/)
 *   --skip-scrape  : usa checkpoint existente sin volver a scrapear (solo matchea)
 */

// Forzar NODE_ENV=development antes de importar el adapter.
// El adapter usa @sparticuz/chromium (binario Linux Lambda) si NODE_ENV !== 'development'
// — esa ruta NO es ejecutable en macOS y falla con ENOEXEC.
// Este script siempre corre local; nunca en Vercel.
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Carga archivos .env sin dependencia externa.
// Solo setea vars que NO existen ya en process.env (no overwrite).
// Por eso el ORDEN importa: el primero gana.
function loadEnvFile(path: string): boolean {
  if (!existsSync(path)) return false
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
  return true
}

// Orden de prioridad (el primero gana porque loadEnvFile NO sobreescribe):
//   1. .env.production.local (creds de prod para scripts de migración)
//   2. .env.local             (dev / Supabase local)
//   3. .env                   (defaults compartidos)
const envSources: string[] = []
if (loadEnvFile('.env.production.local')) envSources.push('.env.production.local')
if (loadEnvFile('.env.local')) envSources.push('.env.local')
if (loadEnvFile('.env')) envSources.push('.env')

import {
  canonize,
  matchNames,
  indexByFirstAndSecondToken,
  findCandidates,
  type NameMatchType,
} from '../src/lib/isalud/name-matcher'
import {
  matchClienteToPatient,
  type ExistingPatientLite,
  type PatientMatchResult,
} from '../src/lib/isalud/patient-matcher'
import {
  launchBrowserAndContext,
  loginAndInjectCookies,
  type ISaludCredentials,
} from '../src/lib/isalud/adapter'
import {
  scrapeClientes,
  type ISaludCliente,
} from '../src/lib/isalud/clientes-scraper'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidos')
  console.error(`Sources leídos: ${envSources.join(', ') || '(ninguno)'}`)
  console.error('Crear .env.production.local con las creds de producción.')
  process.exit(1)
}

// Sanity check: warning si URL parece dev/local pero la intención es prod
if (SUPABASE_URL.includes('127.0.0.1') || SUPABASE_URL.includes('localhost')) {
  console.warn('⚠️  NEXT_PUBLIC_SUPABASE_URL apunta a LOCAL:', SUPABASE_URL)
  console.warn('    Si esperabas producción, creá .env.production.local con la URL de prod.')
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FRESH = args.includes('--fresh')
const SKIP_SCRAPE = args.includes('--skip-scrape')

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface CasoAmbiguo {
  cliente: ISaludCliente
  type: NameMatchType
  candidates: Array<{ nombre: string; confidence: number; type: NameMatchType }>
}

interface MatchedCliente {
  cliente: ISaludCliente
  matchedApptName: string
  nameMatchType: NameMatchType
  nameConfidence: number
  patientMatch: PatientMatchResult
}

async function loadCredentials(): Promise<ISaludCredentials> {
  const { data, error } = await supa
    .from('sync_integrations')
    .select('credentials')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('provider', 'isalud')
    .neq('sync_status', 'disabled')
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(
      `No pude cargar credenciales iSalud Algia desde ${SUPABASE_URL}: ${error.message}`,
    )
  }
  if (!data) {
    throw new Error(
      `No hay sync_integrations activo para Algia en ${SUPABASE_URL} (clinic_id=${ALGIA_CLINIC_ID})`,
    )
  }
  const c = data.credentials as { subdomain: string; username: string; password: string }
  return { subdomain: c.subdomain, username: c.username, password: c.password }
}

async function loadAppointmentNames(): Promise<string[]> {
  const { data, error } = await supa
    .from('appointments')
    .select('reason')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('source', 'isalud')
    .not('reason', 'is', null)
    .neq('reason', 'Bloqueo iSalud')

  if (error) {
    throw new Error(
      `loadAppointmentNames falló contra ${SUPABASE_URL}: ${error.message}`,
    )
  }
  if (!data || data.length === 0) {
    // Distinguimos: data=null = error semantico, data=[] = OK pero realmente no hay
    throw new Error(
      `loadAppointmentNames devolvió 0 filas contra ${SUPABASE_URL}. ` +
        `Esperábamos ~1127 citas iSalud para Algia. Verificá que la URL sea de PROD.`,
    )
  }

  const distinct = new Set<string>()
  for (const row of data) {
    const r = (row.reason ?? '').trim()
    if (r) distinct.add(r)
  }
  return Array.from(distinct)
}

async function loadExistingPatients(): Promise<ExistingPatientLite[]> {
  const { data, error } = await supa
    .from('patients')
    .select('id, document_number, phone, name')
    .eq('clinic_id', ALGIA_CLINIC_ID)

  if (error) {
    throw new Error(
      `loadExistingPatients falló contra ${SUPABASE_URL}: ${error.message}`,
    )
  }
  // data=[] aquí SÍ es válido (Algia podría tener 0 pacientes Omuwan al arrancar)
  return (data ?? []) as ExistingPatientLite[]
}

function mask(s: string, keep: number = 4): string {
  if (!s || s.length <= keep) return '***'
  return s.slice(0, keep) + '***'
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  IMPORT iSalud Clientes → Omuwan patients (Algia)')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Modo: ${APPLY ? '🔴 APPLY (escribe a DB)' : '🟢 DRY-RUN (lectura)'}`)
  console.log(`  Fresh scrape: ${FRESH}`)
  console.log(`  Skip scrape: ${SKIP_SCRAPE}`)
  console.log(`  Timestamp: ${new Date().toISOString()}`)
  console.log('')

  // Limpiar cache si --fresh
  const cacheDir = join(homedir(), '.omuwan-cache', 'algia-clientes')
  if (FRESH && existsSync(cacheDir)) {
    console.log(`  [INFO] --fresh: borrando ${cacheDir}`)
    rmSync(cacheDir, { recursive: true, force: true })
  }

  // 1. Cargar appointments.reason de Algia + indexar
  console.log('═══ 1. Cargando nombres de appointments.reason ═══')
  const apptNames = await loadAppointmentNames()
  console.log(`  ${apptNames.length} nombres distintos`)
  const apptIndex = indexByFirstAndSecondToken(apptNames)
  console.log(`  Índice: ${apptIndex.byFirst.size} buckets por primer token, ${apptIndex.bySecond.size} por segundo`)
  console.log('')

  // 2. Cargar pacientes Omuwan existentes
  console.log('═══ 2. Cargando pacientes existentes (Omuwan) ═══')
  const existing = await loadExistingPatients()
  const withCedula = existing.filter((p) => p.document_number).length
  console.log(`  ${existing.length} pacientes Omuwan, ${withCedula} con cédula`)
  console.log('')

  // 3. Scrape /cliente (o load checkpoint)
  let clientes: ISaludCliente[] = []
  if (SKIP_SCRAPE) {
    console.log('═══ 3. SKIP scrape — usando checkpoint existente ═══')
    // Re-load directamente del cacheDir
    const { readdirSync, readFileSync } = await import('fs')
    if (!existsSync(cacheDir)) {
      console.error(`  ERROR: --skip-scrape pero no hay checkpoint en ${cacheDir}`)
      process.exit(1)
    }
    const files = readdirSync(cacheDir).filter((f) => f.startsWith('batch-')).sort()
    for (const f of files) {
      const content = readFileSync(join(cacheDir, f), 'utf-8')
      clientes.push(...(JSON.parse(content) as ISaludCliente[]))
    }
    console.log(`  ${clientes.length} clientes cargados de checkpoint`)
  } else {
    console.log('═══ 3. Scrape /cliente (Playwright) ═══')
    const credentials = await loadCredentials()
    console.log(`  Subdomain: ${credentials.subdomain}, user: ${mask(credentials.username, 3)}`)
    const { browser, context } = await launchBrowserAndContext()
    try {
      const page = await loginAndInjectCookies(context, credentials)
      const result = await scrapeClientes(page, credentials, { cacheDir })
      clientes = result.clientes
      console.log(`  Scrapeados: ${clientes.length} | pageSize: ${result.pageSize} | duración: ${Math.round(result.durationMs / 1000)}s`)
      if (result.errorsPages.length > 0) {
        console.warn(`  ⚠ ${result.errorsPages.length} páginas con error: ${result.errorsPages.slice(0, 10).join(', ')}${result.errorsPages.length > 10 ? '...' : ''}`)
      }
    } finally {
      await context.close()
      await browser.close()
    }
  }
  console.log('')

  // 4. Filtro por name match
  console.log('═══ 4. Filtro por name match (contra appointments.reason) ═══')
  const matchedClientes: MatchedCliente[] = []
  const casosAmbiguos: CasoAmbiguo[] = []
  const matchedApptNames = new Set<string>()

  const stats = {
    exact: 0, subset_strict: 0, subset_loose: 0,
    partial_first_last: 0, no_match: 0, multi_match: 0,
  }

  for (const cliente of clientes) {
    const candidates = findCandidates(cliente.nombre, apptIndex)
    if (candidates.length === 0) {
      stats.no_match++
      continue
    }

    // Evaluar todos los candidatos
    const scored = candidates.map((apptName) => ({
      apptName,
      match: matchNames(cliente.nombre, apptName),
    }))
    // Mejor candidato
    scored.sort((a, b) => b.match.confidence - a.match.confidence)
    const best = scored[0]

    if (best.match.type === 'no_match') {
      stats.no_match++
      continue
    }

    // ¿Hay múltiples candidatos con misma confidence alta?
    const topConfidence = best.match.confidence
    const tops = scored.filter((s) => s.match.confidence === topConfidence)
    if (tops.length > 1 && topConfidence >= 0.95) {
      // Multi-match ambiguo
      stats.multi_match++
      casosAmbiguos.push({
        cliente,
        type: 'subset_strict',  // ambiguo en este tier
        candidates: tops.map((t) => ({
          nombre: t.apptName,
          confidence: t.match.confidence,
          type: t.match.type,
        })),
      })
      continue
    }

    // Aceptar o mandar a revisión según tipo
    switch (best.match.type) {
      case 'exact':
      case 'subset_strict': {
        // Auto-match (confidence >= 0.95)
        stats[best.match.type]++
        const patientMatch = matchClienteToPatient(cliente, existing)
        matchedClientes.push({
          cliente,
          matchedApptName: best.apptName,
          nameMatchType: best.match.type,
          nameConfidence: best.match.confidence,
          patientMatch,
        })
        matchedApptNames.add(best.apptName)
        break
      }
      case 'subset_loose':
      case 'partial_first_last': {
        // Revisión manual
        stats[best.match.type]++
        casosAmbiguos.push({
          cliente,
          type: best.match.type,
          candidates: scored.slice(0, 3).map((t) => ({
            nombre: t.apptName,
            confidence: t.match.confidence,
            type: t.match.type,
          })),
        })
        break
      }
    }
  }

  console.log(`  Clientes scrapeados:        ${clientes.length}`)
  console.log(`  ✅ exact match:              ${stats.exact}`)
  console.log(`  ✅ subset_strict (auto):     ${stats.subset_strict}`)
  console.log(`  🟡 subset_loose (revisar):   ${stats.subset_loose}`)
  console.log(`  🔴 partial_first_last:       ${stats.partial_first_last}`)
  console.log(`  ⚠ multi-match ambiguo:      ${stats.multi_match}`)
  console.log(`  ❌ no_match (descarte):      ${stats.no_match}`)
  console.log('')

  // 5. Nombres en appointments sin match en iSalud
  const apptNamesSinMatch = apptNames.filter((n) => !matchedApptNames.has(n))
  console.log(`  Nombres en appointments.reason SIN match en iSalud: ${apptNamesSinMatch.length}/${apptNames.length}`)
  if (apptNamesSinMatch.length > 0 && apptNamesSinMatch.length <= 20) {
    console.log('  Listado:')
    for (const n of apptNamesSinMatch) {
      console.log(`    - "${canonize(n)}"`)
    }
  }
  console.log('')

  // 6. Acciones planeadas sobre matchedClientes
  console.log('═══ 5. Acciones planeadas (sobre auto-match) ═══')
  const planActions = {
    insert: 0,
    match_by_cedula: 0,
    match_by_phone: 0,
    skip_name_empty: 0,
    skip_cedula_invalid: 0,
    skip_phone_invalid: 0,
  }
  for (const m of matchedClientes) {
    planActions[m.patientMatch.type]++
  }
  console.log(`  INSERT nuevo:                ${planActions.insert}`)
  console.log(`  UPDATE match cédula:         ${planActions.match_by_cedula}`)
  console.log(`  UPDATE match phone:          ${planActions.match_by_phone}`)
  console.log(`  Skip nombre vacío:           ${planActions.skip_name_empty}`)
  console.log(`  Skip cédula inválida:        ${planActions.skip_cedula_invalid}`)
  console.log(`  Skip phone inválido:         ${planActions.skip_phone_invalid}`)
  console.log('')

  // 7. Listado completo de casos ambiguos para revisión
  if (casosAmbiguos.length > 0) {
    console.log('═══ 6. CASOS AMBIGUOS PARA REVISIÓN MANUAL ═══')
    let idx = 1
    for (const caso of casosAmbiguos) {
      console.log(`\n  [${idx}] ${caso.type}`)
      console.log(`      iSalud: "${caso.cliente.nombre}" (cédula ${caso.cliente.documento}, tel ${caso.cliente.telefono})`)
      console.log(`      Candidatos en appointments:`)
      for (const c of caso.candidates) {
        console.log(`        - "${c.nombre}" (${c.type}, conf=${c.confidence})`)
      }
      idx++
    }
    console.log('')
  }

  // 8. APPLY o stop
  if (!APPLY) {
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('  DRY-RUN completo. NO se escribió nada en DB.')
    console.log(`  Para aplicar de verdad: agregar --apply al comando`)
    console.log(`  Cache: ${cacheDir}`)
    console.log('═══════════════════════════════════════════════════════════════')
    return
  }

  // ====== APPLY ======
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  🔴 APPLY MODE — escribiendo a DB...')
  console.log('═══════════════════════════════════════════════════════════════')

  let inserted = 0
  let updatedCedula = 0
  let updatedPhone = 0
  let errors: string[] = []

  for (const m of matchedClientes) {
    try {
      if (m.patientMatch.type === 'insert') {
        const { error } = await supa.from('patients').insert({
          clinic_id: ALGIA_CLINIC_ID,
          name: m.cliente.nombre,
          phone: m.patientMatch.normalized_phone,
          document_type: 'CC',
          document_number: m.cliente.documento,
          data_consent_at: null,  // el agente lo pide
        })
        if (error) { errors.push(`INSERT ${m.cliente.documento}: ${error.message}`); continue }
        inserted++
      } else if (m.patientMatch.type === 'match_by_cedula') {
        // Solo update si el phone cambió
        const { error } = await supa.from('patients')
          .update({ phone: m.patientMatch.normalized_phone, updated_at: new Date().toISOString() })
          .eq('id', m.patientMatch.existing_patient_id!)
        if (error) { errors.push(`UPDATE cedula ${m.cliente.documento}: ${error.message}`); continue }
        updatedCedula++
      } else if (m.patientMatch.type === 'match_by_phone') {
        const { error } = await supa.from('patients')
          .update({ document_number: m.cliente.documento, document_type: 'CC', updated_at: new Date().toISOString() })
          .eq('id', m.patientMatch.existing_patient_id!)
        if (error) { errors.push(`UPDATE phone ${m.cliente.documento}: ${error.message}`); continue }
        updatedPhone++
      }
    } catch (err) {
      errors.push(`${m.cliente.documento}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Audit log resumido
  await supa.from('audit_log').insert({
    clinic_id: ALGIA_CLINIC_ID,
    action: 'patients_imported_from_isalud',
    actor_type: 'system',
    details: {
      inserted, updatedCedula, updatedPhone, errors_count: errors.length,
      total_matched_clientes: matchedClientes.length,
      total_scrapeados: clientes.length,
      timestamp: new Date().toISOString(),
    },
  })

  console.log('')
  console.log('  Resultado APPLY:')
  console.log(`    INSERT:        ${inserted}`)
  console.log(`    UPDATE cédula: ${updatedCedula}`)
  console.log(`    UPDATE phone:  ${updatedPhone}`)
  console.log(`    Errores:       ${errors.length}`)
  if (errors.length > 0 && errors.length <= 20) {
    console.log('  Errores:')
    for (const e of errors) console.log(`    - ${e}`)
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
