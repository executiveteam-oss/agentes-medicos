/**
 * ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
 *
 * Dry-run de getSuggestionsForDoctor contra Algia, para José Duván + Juan Diego.
 *
 * No escribe nada. Solo carga citas + staging + eapb_codes desde la DB de prod,
 * pasa por la lógica pura, e imprime las sugerencias para validación humana.
 *
 * Run: NODE_ENV=development TZ=America/Bogota npx tsx scripts/dryrun-consulta-convenio-suggestions.ts
 */

import { internalGetSuggestionsForDoctor } from '../src/app/actions/isalud-consulta-convenio'
import type { SuggestionCombo } from '../src/lib/isalud/consulta-convenio-derivation'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

const DOCTORS = [
  { id: '68696dff-68ff-4d0c-9a55-230e75cccbb7', label: 'JOSÉ DUVÁN LÓPEZ JARAMILLO' },
  { id: '97a20f5e-4aac-48d0-bef9-4240e666dca5', label: 'JUAN DIEGO VILLEGAS ECHEVERRI' },
]

function fmtCombo(c: SuggestionCombo, index: number): string {
  const eapb = c.convenio_eapb_code
    ? `→ ${c.convenio_eapb_code} (${c.convenio_eapb_type})`
    : '→ ❗ NEEDS CLASSIFICATION'
  const dur =
    c.duration_source === 'derived'
      ? `${c.duration_minutes}min ✓ derived (${c.citas_with_duration}/${c.citas_count} citas)`
      : `${c.duration_minutes}min ⚠ default (${c.citas_count} citas — bajo umbral 5)`
  const price = c.suggested_price ? `$${c.suggested_price.toLocaleString('es-CO')}` : '(sin precio)'
  const flagBadge = c.needs_classification ? '🔧' : '✅'
  return [
    `  ${flagBadge} [${index}] ${c.procedimiento_canonical.slice(0, 70)}`,
    `       Convenio: ${c.convenio_canonical} ${eapb}`,
    `       Duración: ${dur}`,
    `       Precio sugerido: ${price}  ·  staging_id=${c.staging_product_id?.slice(0, 8)}`,
  ].join('\n')
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  DRY-RUN: getSuggestionsForDoctor — Algia')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(`  Timestamp: ${new Date().toISOString()}`)
  console.log(`  Clinic: Algia (${ALGIA_CLINIC_ID})`)
  console.log('')

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: env vars de Supabase faltantes')
    process.exit(1)
  }

  for (const doc of DOCTORS) {
    console.log('')
    console.log('───────────────────────────────────────────────────────────────────')
    console.log(`  ${doc.label}`)
    console.log('───────────────────────────────────────────────────────────────────')

    const result = await internalGetSuggestionsForDoctor(ALGIA_CLINIC_ID, doc.id)

    if (!result.ok) {
      console.log(`  ERROR: ${result.error}`)
      continue
    }

    console.log(`  Doctor: ${result.doctor!.name} (${result.doctor!.specialty ?? '—'})`)
    console.log('')
    console.log('  === Stats ===')
    console.log(`    Citas totales:                 ${result.stats!.totalCitasProcessed}`)
    console.log(`    Citas con combinación derivable: ${result.stats!.totalCitasParseable}`)
    console.log(`    Aseguradora unparseable:       ${result.stats!.aseguradoraUnparseable}`)
    console.log(`    Combinaciones totales:         ${result.stats!.totalCombinations}`)
    console.log(`      Con eapb auto-match:         ${result.stats!.combinationsWithEapbMatch}`)
    console.log(`      Necesitan clasificación:     ${result.stats!.combinationsNeedingClassification}  🔧`)
    console.log('')
    console.log('  === Combinaciones ===')

    const combos = result.suggestions?.combinations ?? []
    if (combos.length === 0) {
      console.log('  (ninguna)')
    } else {
      // Ordenar: needs_classification al final, luego por procedimiento
      const sorted = combos.slice().sort((a, b) => {
        if (a.needs_classification !== b.needs_classification) {
          return a.needs_classification ? 1 : -1
        }
        return a.procedimiento_canonical.localeCompare(b.procedimiento_canonical)
      })
      sorted.forEach((c, i) => console.log(fmtCombo(c, i + 1)))
    }

    console.log('')
    console.log('  === Unparseable (info global del dataset) ===')
    if (result.unparseable!.procedimientos.length > 0) {
      console.log(`    Procedimientos sin cruce en staging (${result.unparseable!.procedimientos.length}):`)
      result.unparseable!.procedimientos.forEach((p) => console.log(`      - "${p}"`))
    }
    if (result.unparseable!.convenios.length > 0) {
      console.log(`    Convenios sin auto-match (${result.unparseable!.convenios.length}):`)
      result.unparseable!.convenios.forEach((c) => console.log(`      - "${c}"`))
    }
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  Dry-run completo. NO se escribió nada en DB.')
  console.log('═══════════════════════════════════════════════════════════════════')
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
