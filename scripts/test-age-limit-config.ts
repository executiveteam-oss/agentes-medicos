/**
 * Tests del schema Zod de AgeLimitConfig + evaluateAgeLimit.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-age-limit-config.ts
 */

import {
  AgeLimitConfigSchema,
  evaluateAgeLimit,
  deriveRowActionFromConfig,
  type AgeLimitConfig,
} from '../src/lib/rules/age-limit-config'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tests AgeLimitConfig (schema + evaluate)')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n=== Schema válido: solo mínimo (Ginecología 15+) ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: 15, action_below_min: 'rechazar',
    })
    assert('Acepta solo-min con action_below_min', r.success, r.success ? '' : JSON.stringify(r.error.issues))
  }

  console.log('\n=== Schema válido: solo máximo ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      max: 12, action_above_max: 'rechazar',
    })
    assert('Acepta solo-max con action_above_max', r.success)
  }

  console.log('\n=== Schema válido: rango completo (Mapeo 18-50) ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: 18, max: 50,
      action_below_min: 'rechazar',
      action_above_max: 'derivar_humano',
    })
    assert('Acepta rango completo con ambas acciones', r.success)
  }

  console.log('\n=== Schema inválido: sin min ni max ===')
  {
    const r = AgeLimitConfigSchema.safeParse({})
    assert('Rechaza config vacía', !r.success)
  }

  console.log('\n=== Schema inválido: min sin action_below_min ===')
  {
    const r = AgeLimitConfigSchema.safeParse({ min: 18 })
    assert('Rechaza min sin acción', !r.success)
  }

  console.log('\n=== Schema inválido: max sin action_above_max ===')
  {
    const r = AgeLimitConfigSchema.safeParse({ max: 50 })
    assert('Rechaza max sin acción', !r.success)
  }

  console.log('\n=== Schema inválido: min >= max ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: 50, max: 18,
      action_below_min: 'rechazar', action_above_max: 'derivar_humano',
    })
    assert('Rechaza min > max', !r.success)
  }
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: 18, max: 18,
      action_below_min: 'rechazar', action_above_max: 'derivar_humano',
    })
    assert('Rechaza min == max', !r.success)
  }

  console.log('\n=== Schema inválido: acción no enum ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: 18, action_below_min: 'derivar' as unknown as 'rechazar',
    })
    assert('Rechaza acción "derivar" (sin _humano)', !r.success)
  }

  console.log('\n=== Schema inválido: edad negativa o > 120 ===')
  {
    const r = AgeLimitConfigSchema.safeParse({
      min: -1, action_below_min: 'rechazar',
    })
    assert('Rechaza min negativo', !r.success)
  }
  {
    const r = AgeLimitConfigSchema.safeParse({
      max: 150, action_above_max: 'rechazar',
    })
    assert('Rechaza max > 120', !r.success)
  }

  console.log('\n=== evaluateAgeLimit: dentro de rango ===')
  const mapeo: AgeLimitConfig = {
    min: 18, max: 50,
    action_below_min: 'rechazar',
    action_above_max: 'derivar_humano',
  }
  assert('Edad 30 con Mapeo 18-50 → null (ok)', evaluateAgeLimit(30, mapeo) === null)
  assert('Edad 18 (borde inferior) → null (ok)', evaluateAgeLimit(18, mapeo) === null)
  assert('Edad 50 (borde superior) → null (ok)', evaluateAgeLimit(50, mapeo) === null)

  console.log('\n=== evaluateAgeLimit: bajo mínimo ===')
  {
    const r = evaluateAgeLimit(16, mapeo)
    assert('Edad 16 → below_min + rechazar',
      r?.edge === 'below_min' && r.action === 'rechazar',
      JSON.stringify(r))
  }
  {
    const r = evaluateAgeLimit(17, mapeo)
    assert('Edad 17 (un año debajo) → below_min', r?.edge === 'below_min')
  }

  console.log('\n=== evaluateAgeLimit: sobre máximo ===')
  {
    const r = evaluateAgeLimit(62, mapeo)
    assert('Edad 62 → above_max + derivar_humano',
      r?.edge === 'above_max' && r.action === 'derivar_humano',
      JSON.stringify(r))
  }
  {
    const r = evaluateAgeLimit(51, mapeo)
    assert('Edad 51 (un año arriba) → above_max', r?.edge === 'above_max')
  }

  console.log('\n=== evaluateAgeLimit: solo mínimo (Ginecología 15+) ===')
  const gineco: AgeLimitConfig = {
    min: 15, action_below_min: 'rechazar',
  }
  assert('Edad 90 con solo min=15 → null (no hay tope)', evaluateAgeLimit(90, gineco) === null)
  assert('Edad 14 con min=15 → below_min',
    evaluateAgeLimit(14, gineco)?.edge === 'below_min')

  console.log('\n=== deriveRowActionFromConfig ===')
  assert('Solo rechazar → rechazar',
    deriveRowActionFromConfig({ min: 18, action_below_min: 'rechazar' }) === 'rechazar')
  assert('Solo derivar_humano → derivar_humano',
    deriveRowActionFromConfig({ max: 50, action_above_max: 'derivar_humano' }) === 'derivar_humano')
  assert('Mix rechazar+derivar → rechazar (más restrictivo)',
    deriveRowActionFromConfig({
      min: 18, max: 50,
      action_below_min: 'rechazar', action_above_max: 'derivar_humano',
    }) === 'rechazar')

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
