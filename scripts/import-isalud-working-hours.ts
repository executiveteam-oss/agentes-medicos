/**
 * ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
 *
 * ⚠ HERRAMIENTA DE DIAGNÓSTICO — NO USAR PARA POBLAR PRODUCCIÓN
 * ════════════════════════════════════════════════════════════════════
 *
 * En 2026-06-10 se decidió ABANDONAR el auto-populate de horarios
 * desde iSalud. La fuente /disponibilidad subestima el horario laboral
 * real del médico (captura solo slots configurados para agendamiento
 * web). El cruce con las citas iSalud confirmó:
 *
 *   - JOSÉ DUVÁN: 243 citas reales 07–16 en mié/jue, pero /disponibilidad
 *     solo capturó 07–11 → con esa fuente se hubieran perdido ~121 citas
 *   - JORGE DARIO: 10 citas reales en lunes, pero /disponibilidad lo
 *     marcaba INACTIVO
 *
 * Decisión: los working_hours se configuran a mano desde el dashboard.
 *
 * Este script queda como DIAGNÓSTICO: corrél en dry-run para ver el
 * cruce iSalud-vs-realidad, pero NO --apply en producción.
 *
 * Detalle en CLAUDE.md, sesión 2026-06-10.
 * ════════════════════════════════════════════════════════════════════
 *
 * One-shot import de working_hours desde iSalud /disponibilidad.
 *
 * Default: DRY-RUN (preview, NO escribe en DB).
 * --apply: APPLY (UPDATEs reales en doctors.working_hours).
 *
 * Política (por día, en médicos con working_hours default):
 *   - confidence='high' → poblar con el patrón derivado (>=2 fechas con slots)
 *   - confidence='none' → INACTIVAR (cero slots en 4 semanas = evidencia real de
 *     que el médico no atiende ese día)
 *   - confidence='low'  → PRESERVAR DEFAULT (1 sola fecha es ruido, no señal —
 *     no afirma ni que atiende ni que no. Honestidad = "no sé" → dejar el
 *     placeholder existente, Lady configura a mano. Reportado prominentemente.)
 *
 * Resto:
 *   - Médicos con working_hours editado (LINA, DANIELA, etc.) → NO TOCAR
 *   - Médicos sin slots con confidence='high' en NINGÚN día → NO TOCAR
 *   - Matching de nombres: normalizado (lowercase + sin tildes) para evitar
 *     orphans por escritura inconsistente
 *
 * Run:
 *   NODE_ENV=development TZ=America/Bogota npx tsx scripts/import-isalud-working-hours.ts \
 *     --clinic <uuid> [--apply]
 */

import { createClient } from '@supabase/supabase-js'
import {
  launchBrowserAndContext,
  loginAndInjectCookies,
  scrapeProfesionales,
  type ISaludCredentials,
  type ISaludProfesional,
} from '../src/lib/isalud/adapter'
import {
  deriveWeeklyPattern,
  isDefaultWorkingHours,
  ALL_WEEKDAYS,
  type WeekdayKey,
  type DerivationResult,
} from '../src/lib/isalud/working-hours-derivation'
import type { WorkingBlock } from '../src/types/database'

// --- Tipos del script ---

interface Args {
  clinic?: string
  apply: boolean
  help: boolean
}

type WorkingHoursStorage = Record<WeekdayKey, { active: boolean; blocks: WorkingBlock[] }>

interface DoctorMapping {
  doctor_id: string
  external_name: string
  external_name_normalized: string
  doctor_name: string
  working_hours_current: unknown
}

type DoctorAction =
  | {
      type: 'populated'
      doctor: DoctorMapping
      slots: number
      result: DerivationResult
      newWh: WorkingHoursStorage
      lowDays: WeekdayKey[]
      noneDays: WeekdayKey[]
    }
  | { type: 'skip_custom'; doctor: DoctorMapping }
  | {
      type: 'skip_insufficient'
      doctor: DoctorMapping
      slots: number
      result: DerivationResult
    }
  | { type: 'orphan'; profesional: ISaludProfesional }
  | { type: 'not_in_scrape'; doctor: DoctorMapping }

// --- Args ---

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clinic') args.clinic = argv[++i]
    else if (argv[i] === '--apply') args.apply = true
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true
  }
  return args
}

// --- Banners ---

const PREVIEW_BANNER = `
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   📋  MODO PREVIEW (dry-run) — NO se escribirá nada en la DB         ║
║                                                                      ║
║   Para aplicar los cambios mostrados, re-ejecutá con --apply         ║
║                                                                      ║
║   ⚠  Este import deriva working_hours de los slots configurados      ║
║      en iSalud (/disponibilidad). Es un PUNTO DE PARTIDA, no la      ║
║      verdad final. Lady debe validar contra la realidad de cada      ║
║      médico antes de pasar a producción.                             ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`

const APPLY_BANNER = `
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ⚡  MODO APPLY — se actualizará doctors.working_hours en la DB     ║
║                                                                      ║
║   ⚠  Este import deriva working_hours de los slots configurados      ║
║      en iSalud (/disponibilidad). Es un PUNTO DE PARTIDA, no la      ║
║      verdad final. Lady debe validar contra la realidad de cada      ║
║      médico antes de pasar a producción.                             ║
║                                                                      ║
║   📜 El estado previo de cada doctor se loguea como [PREV] antes     ║
║      del UPDATE para permitir reversión manual si algo sale mal.     ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`

const HELP_MSG = `
Importa working_hours desde iSalud /disponibilidad. One-shot, manual.

USO:
  NODE_ENV=development TZ=America/Bogota npx tsx scripts/import-isalud-working-hours.ts \\
    --clinic <uuid> [--apply]

MODOS:
  (sin flags) → DRY-RUN (preview, NO escribe en DB)  ← DEFAULT SEGURO
  --apply    → APPLY (UPDATEs reales en doctors.working_hours)

ARGUMENTOS:
  --clinic <uuid>   Obligatorio. ID de la clínica a importar.
  --apply           Opcional. Escribe cambios a DB. Default es preview.
  --help, -h        Muestra esta ayuda y termina.

LÓGICA:
  - Médicos con working_hours default (L-V 08-18 + S 08-13)
      → poblar SOLO los días con confidence='high' (>=2 fechas con slots)
      → días con confidence='low' o 'none' quedan INACTIVOS en el nuevo WH
        (NO heredan el default activo — Lady los configura a mano)
  - Médicos con working_hours editado (split-shift, días off, etc.)
      → SKIP CUSTOM, no se tocan
  - Médicos sin días con confidence='high'
      → SKIP INSUFFICIENT, no se tocan
  - Profesionales en iSalud sin mapping en DB
      → ORPHAN (reporte visible, no se tocan)
  - Médicos en DB sin slots en este scrape
      → NOT IN SCRAPE (reporte)

MATCHING:
  Nombres se normalizan (lowercase + sin tildes + whitespace colapsado)
  para evitar orphans por inconsistencias de escritura.

DESPUÉS DE CORRER:
  - Revisar el reporte
  - Validar cada cambio contra la realidad del médico
  - Configurar manualmente los días "low" / "none" que no se poblaron
  - Para revertir un UPDATE: usar el [PREV] del log + UPDATE SQL manual
`

// --- Name normalization ---

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Valor default canónico por día (mismo que `buildDefaultWorkingHours` en sync-agent.ts).
 * Usado para preservar el placeholder en días con confidence='low'.
 */
function canonicalDefaultForDay(day: WeekdayKey): { active: boolean; blocks: WorkingBlock[] } {
  if (day === 'sunday') return { active: false, blocks: [] }
  if (day === 'saturday') return { active: true, blocks: [{ start: '08:00', end: '13:00' }] }
  return { active: true, blocks: [{ start: '08:00', end: '18:00' }] } // mon-fri
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP_MSG)
    process.exit(0)
  }

  if (!args.clinic) {
    console.error('\nERROR: --clinic <uuid> es obligatorio.\n')
    console.error('Ver: npx tsx scripts/import-isalud-working-hours.ts --help\n')
    process.exit(1)
  }

  // Banner ANTES de tocar nada — para que el modo sea inequívoco desde el primer scroll
  console.log(args.apply ? APPLY_BANNER : PREVIEW_BANNER)
  console.log(`Clinic ID: ${args.clinic}`)
  console.log(`Modo:      ${args.apply ? 'APPLY' : 'PREVIEW (dry-run)'}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`TZ:        ${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`)
  console.log(`NODE_ENV:  ${process.env.NODE_ENV}`)
  console.log('')

  // Env check
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) {
    console.error('ERROR: faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en env')
    process.exit(1)
  }
  const admin = createClient(supaUrl, supaKey)

  // --- 1. Cargar creds + doctors + mappings ---

  console.log('--- Cargando integración, doctores y mappings ---')
  const { data: integ } = await admin
    .from('sync_integrations')
    .select('credentials, sync_status')
    .eq('clinic_id', args.clinic)
    .eq('provider', 'isalud')
    .maybeSingle()

  if (!integ?.credentials) {
    console.error(`ERROR: no hay integración iSalud para clinic ${args.clinic}`)
    process.exit(1)
  }
  const creds = (integ as { credentials: ISaludCredentials }).credentials
  const integStatus = (integ as { sync_status: string }).sync_status
  console.log(`  Subdomain:   ${creds.subdomain}`)
  console.log(`  sync_status: ${integStatus}`)

  const { data: doctorsRaw } = await admin
    .from('doctors')
    .select('id, name, working_hours, is_active')
    .eq('clinic_id', args.clinic)
    .eq('is_active', true)

  const doctors = (doctorsRaw ?? []) as Array<{ id: string; name: string; working_hours: unknown }>

  const { data: mappingsRaw } = await admin
    .from('doctor_external_mappings')
    .select('doctor_id, external_name')
    .eq('clinic_id', args.clinic)
    .eq('provider', 'isalud')

  const mappings = (mappingsRaw ?? []) as Array<{ doctor_id: string; external_name: string }>

  const doctorsById = new Map<string, { id: string; name: string; working_hours: unknown }>()
  for (const d of doctors) doctorsById.set(d.id, d)

  // Lookup por nombre normalizado → DoctorMapping
  const mappingsByNorm = new Map<string, DoctorMapping>()
  for (const m of mappings) {
    const doc = doctorsById.get(m.doctor_id)
    if (!doc) continue
    const norm = normalizeName(m.external_name)
    mappingsByNorm.set(norm, {
      doctor_id: m.doctor_id,
      external_name: m.external_name,
      external_name_normalized: norm,
      doctor_name: doc.name,
      working_hours_current: doc.working_hours,
    })
  }

  console.log(`  Doctores activos: ${doctors.length}`)
  console.log(`  Mappings iSalud:  ${mappings.length}`)
  console.log('')

  // --- 2. Scrape /disponibilidad ---

  console.log('--- Scrape /disponibilidad ---')
  const tScrape = Date.now()
  const { browser, context } = await launchBrowserAndContext()

  let profesionales: ISaludProfesional[]
  try {
    const page = await loginAndInjectCookies(context, creds)
    profesionales = await scrapeProfesionales(page, creds)
  } catch (err) {
    console.error(`ERROR durante scrape: ${err instanceof Error ? err.message : err}`)
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    process.exit(1)
  }
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  console.log(`  Profesionales scrapeados: ${profesionales.length}`)
  console.log(`  Duración: ${((Date.now() - tScrape) / 1000).toFixed(1)}s`)
  console.log('')

  // --- 3. Decidir acción por profesional + descubrir orphans + not_in_scrape ---

  console.log('--- Derivando patrones + decidiendo acciones ---')
  const actions: DoctorAction[] = []
  const seenMappingNorm = new Set<string>()

  for (const prof of profesionales) {
    const norm = normalizeName(prof.nombre)
    const mapping = mappingsByNorm.get(norm)

    if (!mapping) {
      actions.push({ type: 'orphan', profesional: prof })
      continue
    }

    seenMappingNorm.add(norm)

    // ¿Tiene working_hours custom (≠ default)? → no tocar
    if (!isDefaultWorkingHours(mapping.working_hours_current)) {
      actions.push({ type: 'skip_custom', doctor: mapping })
      continue
    }

    // Derivar patrón
    const result = deriveWeeklyPattern(prof.slots)

    // ¿Algún día con confidence='high'?
    const highDays = ALL_WEEKDAYS.filter((d) => result.derived[d].confidence === 'high')
    if (highDays.length === 0) {
      actions.push({ type: 'skip_insufficient', doctor: mapping, slots: prof.slots.length, result })
      continue
    }

    // Construir new WH:
    //   high → derivado
    //   none → INACTIVAR (ausencia total = evidencia de no atiende)
    //   low  → preservar el DEFAULT canónico del día (1 fecha = ruido, no señal)
    const newWh = {} as WorkingHoursStorage
    const lowDays: WeekdayKey[] = []
    const noneDays: WeekdayKey[] = []
    for (const day of ALL_WEEKDAYS) {
      const d = result.derived[day]
      if (d.confidence === 'high') {
        newWh[day] = { active: d.active, blocks: d.blocks }
      } else if (d.confidence === 'none') {
        newWh[day] = { active: false, blocks: [] }
        noneDays.push(day)
      } else {
        // low: preservar default canónico (el médico ya tiene default, mantenemos el placeholder)
        newWh[day] = canonicalDefaultForDay(day)
        lowDays.push(day)
      }
    }

    actions.push({
      type: 'populated',
      doctor: mapping,
      slots: prof.slots.length,
      result,
      newWh,
      lowDays,
      noneDays,
    })
  }

  // Doctores en DB con mapping pero sin slots en scrape
  for (const [norm, mapping] of mappingsByNorm.entries()) {
    if (!seenMappingNorm.has(norm)) {
      actions.push({ type: 'not_in_scrape', doctor: mapping })
    }
  }

  console.log(`  Acciones decididas: ${actions.length}`)
  console.log('')

  // --- 4. Imprimir reporte ---

  printReport(actions, profesionales, args.apply)

  // --- 5. Si --apply, ejecutar UPDATEs ---

  if (args.apply) {
    console.log('--- Ejecutando UPDATEs ---')
    let okCount = 0
    let failCount = 0

    for (const a of actions) {
      if (a.type !== 'populated') continue

      console.log('')
      console.log(`[PREV] doctor_id=${a.doctor.doctor_id}  name="${a.doctor.doctor_name}"`)
      console.log(`       working_hours=${JSON.stringify(a.doctor.working_hours_current)}`)
      console.log(`[NEW]  working_hours=${JSON.stringify(a.newWh)}`)

      const { error } = await admin
        .from('doctors')
        .update({ working_hours: a.newWh as unknown as Record<string, unknown> })
        .eq('id', a.doctor.doctor_id)

      if (error) {
        console.log(`       ❌ UPDATE FAILED: ${error.message}`)
        failCount++
      } else {
        console.log(`       ✅ UPDATE OK`)
        okCount++
      }
    }

    console.log('')
    console.log(`UPDATEs aplicados: ${okCount} OK · ${failCount} fallaron`)
    console.log('')
    console.log(APPLY_BANNER)
  } else {
    console.log(PREVIEW_BANNER)
    console.log('Para aplicar los cambios mostrados arriba, re-ejecutá con --apply\n')
  }
}

// --- Reporte ---

function printReport(actions: DoctorAction[], allProf: ISaludProfesional[], applyMode: boolean): void {
  const populated = actions.filter((a): a is Extract<DoctorAction, { type: 'populated' }> => a.type === 'populated')
  const skipCustom = actions.filter((a): a is Extract<DoctorAction, { type: 'skip_custom' }> => a.type === 'skip_custom')
  const skipInsuff = actions.filter(
    (a): a is Extract<DoctorAction, { type: 'skip_insufficient' }> => a.type === 'skip_insufficient',
  )
  const orphans = actions.filter((a): a is Extract<DoctorAction, { type: 'orphan' }> => a.type === 'orphan')
  const notInScrape = actions.filter(
    (a): a is Extract<DoctorAction, { type: 'not_in_scrape' }> => a.type === 'not_in_scrape',
  )

  console.log('═════════════════════════════════════════════════════════════════════')
  console.log(`  REPORTE — ${applyMode ? 'APPLY (los cambios SE APLICARÁN)' : 'PREVIEW (no se aplica nada)'}`)
  console.log('═════════════════════════════════════════════════════════════════════')
  console.log('')

  // ---- POPULATED ----
  console.log(`✅ POPULATED (${populated.length}) — médicos con default que ${applyMode ? 'SE ACTUALIZAN' : 'SE ACTUALIZARÍAN'}:`)
  if (populated.length === 0) console.log('  (ninguno)')
  for (const a of populated) {
    console.log('')
    console.log(`  ◆ ${a.doctor.doctor_name} (${a.doctor.doctor_id.slice(0, 8)}...)`)
    console.log(`    Source: ${a.slots} slots · rango ${a.result.dateRange?.from ?? '?'} → ${a.result.dateRange?.to ?? '?'}`)
    console.log(`    Día        | Resolución`)
    console.log(`    -----------+----------------------------------------------------------------`)
    for (const day of ALL_WEEKDAYS) {
      const d = a.result.derived[day]
      let tag: string
      let resolution: string
      if (d.confidence === 'high') {
        tag = '✅ HIGH '
        const blocksStr = d.blocks.length === 0 ? '(inactivo)' : d.blocks.map((b) => `${b.start}–${b.end}`).join(' + ')
        resolution = `POBLADO: ${blocksStr}  (dates=${d.sourceDatesCount})`
      } else if (d.confidence === 'none') {
        tag = ' · NONE '
        resolution = `INACTIVAR (cero slots en 4 semanas)`
      } else {
        tag = '🔧 LOW  '
        const derivedHint = d.blocks.map((b) => `${b.start}–${b.end}`).join(' + ')
        resolution = `PRESERVAR DEFAULT (1 fecha = ruido; iSalud hint: ${derivedHint})`
      }
      console.log(`    ${day.padEnd(10)} | ${tag} ${resolution}`)
    }
    if (a.lowDays.length > 0) {
      console.log('')
      console.log(`    🔧 REVISIÓN MANUAL — Lady debe configurar estos días para ${a.doctor.doctor_name}:`)
      for (const day of a.lowDays) {
        const d = a.result.derived[day]
        const hint = d.blocks.map((b) => `${b.start}–${b.end}`).join(' + ')
        console.log(`         · ${day.padEnd(9)} — iSalud sugiere ${hint} (1 sola fecha, baja confianza)`)
      }
    }
    if (a.noneDays.length > 0) {
      console.log(`    Días inactivados por ausencia total: ${a.noneDays.join(', ')}`)
    }
  }
  console.log('')

  // ---- SKIPPED CUSTOM ----
  console.log(`⏭  SKIPPED — already configured (${skipCustom.length} doctors, NOT modified):`)
  if (skipCustom.length === 0) console.log('  (ninguno)')
  for (const a of skipCustom) {
    console.log(`  - ${a.doctor.doctor_name}`)
    console.log(`    Reason: working_hours difiere del default (config custom previa, no se toca)`)
  }
  console.log('')

  // ---- SKIPPED INSUFFICIENT ----
  console.log(`❌ INSUFFICIENT DATA (${skipInsuff.length} doctors, NOT modified):`)
  if (skipInsuff.length === 0) console.log('  (ninguno)')
  for (const a of skipInsuff) {
    console.log(`  - ${a.doctor.doctor_name}`)
    console.log(`    Slots totales: ${a.slots}`)
    const dayCounts = ALL_WEEKDAYS.map((d) => `${d}=${a.result.derived[d].confidence}`).join(', ')
    console.log(`    Confidence por día: ${dayCounts}`)
    console.log(`    Decisión: skip entero. Configurar manualmente desde dashboard.`)
  }
  console.log('')

  // ---- ORPHANS (LOUD) ----
  console.log('═════════════════════════════════════════════════════════════════════')
  if (orphans.length > 0) {
    console.log(`🚨 ORPHANS — profesionales en scrape SIN mapping en DB (${orphans.length}):`)
    console.log('')
    console.log('   ESTOS MÉDICOS ESTÁN EN ISALUD PERO NO LOS ENCONTRAMOS EN')
    console.log('   doctor_external_mappings. Posibles causas:')
    console.log('     - Typo en external_name')
    console.log('     - Médico nuevo en iSalud (mapping no creado por sync aún)')
    console.log('     - Variación de escritura no contemplada por normalización')
    console.log('')
    console.log('   RECOMENDACIÓN: revisar manualmente cada uno ANTES de re-correr.')
    console.log('   Sin mapping, su working_hours NO se va a poblar.')
    console.log('')
    for (const a of orphans) {
      console.log(`  - "${a.profesional.nombre}"`)
      console.log(`    normalizado: "${normalizeName(a.profesional.nombre)}"`)
      console.log(`    slots: ${a.profesional.slots.length}`)
    }
  } else {
    console.log(`🚨 ORPHANS: 0 — todos los profesionales scrapeados tienen mapping en DB ✅`)
  }
  console.log('═════════════════════════════════════════════════════════════════════')
  console.log('')

  // ---- NOT IN SCRAPE ----
  if (notInScrape.length > 0) {
    console.log(`❓ NOT IN SCRAPE — médicos en DB con mapping pero sin slots scrapeados (${notInScrape.length}):`)
    for (const a of notInScrape) {
      console.log(`  - ${a.doctor.doctor_name}`)
      console.log(`    external_name="${a.doctor.external_name}"`)
    }
    console.log('  (Sin slots en iSalud → no podemos derivar. Sus working_hours NO se tocan.)')
    console.log('')
  }

  // ---- GLOBAL MANUAL REVIEW SUMMARY ----
  const manualReviewCount = populated.reduce((sum, a) => sum + a.lowDays.length, 0)
  if (manualReviewCount > 0) {
    console.log('═════════════════════════════════════════════════════════════════════')
    console.log(`🔧 REVISIÓN MANUAL GLOBAL — ${manualReviewCount} día(s) requieren config manual de Lady:`)
    console.log('')
    for (const a of populated) {
      if (a.lowDays.length === 0) continue
      console.log(`  ${a.doctor.doctor_name}: ${a.lowDays.join(', ')}`)
    }
    console.log('')
    console.log('  Estos días tuvieron UNA sola fecha con slots en la ventana de 4 semanas.')
    console.log('  Una aparición no es señal — Lady debe confirmar si el médico atiende ese día.')
    console.log('  Mientras tanto, el valor default queda preservado en la DB.')
    console.log('═════════════════════════════════════════════════════════════════════')
    console.log('')
  }

  // ---- SUMMARY ----
  console.log('=== Summary ===')
  console.log(`  Profesionales scrapeados:  ${allProf.length}`)
  console.log(`  Populated:                 ${populated.length}${applyMode ? ' (UPDATEs se ejecutan abajo)' : ' (UPDATEs SE EJECUTARÍAN si --apply)'}`)
  console.log(`  Días para revisión manual: ${manualReviewCount}`)
  console.log(`  Skipped — custom:          ${skipCustom.length}`)
  console.log(`  Skipped — insufficient:    ${skipInsuff.length}`)
  console.log(`  Orphans (no mapping):      ${orphans.length}${orphans.length > 0 ? '  🚨 REVISAR' : ''}`)
  console.log(`  Not in scrape:             ${notInScrape.length}`)
  console.log('')
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
