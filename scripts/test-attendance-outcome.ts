/**
 * Tests del campo attendance_outcome (migración 00073).
 *
 * Cubre:
 *   - Lógica pura computeNoShowDelta (todas las transiciones)
 *   - Label en español para UI
 *   - SMOKE de integración: CHECK constraint en DB rechaza valor inválido
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-attendance-outcome.ts
 */
import { computeNoShowDelta, attendanceOutcomeLabel } from '../src/lib/utils/attendance-outcome'
import { createClient } from '@supabase/supabase-js'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests attendance_outcome\n')

// ============================================================
// Lógica pura: computeNoShowDelta
// Matriz completa: 4 estados (NULL, admitido, facturado, inasistente) × 4 = 16 casos
// ============================================================
console.log('=== computeNoShowDelta — matriz 4×4 ===')

// Idempotencia: previous === next → 0 (4 casos diagonal)
assert('NULL → NULL = 0', computeNoShowDelta(null, null) === 0)
assert('admitido → admitido = 0', computeNoShowDelta('admitido', 'admitido') === 0)
assert('facturado → facturado = 0', computeNoShowDelta('facturado', 'facturado') === 0)
assert('inasistente → inasistente = 0', computeNoShowDelta('inasistente', 'inasistente') === 0)

// Transiciones que NO involucran inasistente → 0 (6 casos)
assert('NULL → admitido = 0', computeNoShowDelta(null, 'admitido') === 0)
assert('NULL → facturado = 0', computeNoShowDelta(null, 'facturado') === 0)
assert('admitido → NULL = 0', computeNoShowDelta('admitido', null) === 0)
assert('admitido → facturado = 0', computeNoShowDelta('admitido', 'facturado') === 0)
assert('facturado → NULL = 0', computeNoShowDelta('facturado', null) === 0)
assert('facturado → admitido = 0', computeNoShowDelta('facturado', 'admitido') === 0)

// Entrar a inasistente desde no-inasistente → +1 (3 casos)
assert('NULL → inasistente = +1', computeNoShowDelta(null, 'inasistente') === 1)
assert('admitido → inasistente = +1', computeNoShowDelta('admitido', 'inasistente') === 1)
assert('facturado → inasistente = +1', computeNoShowDelta('facturado', 'inasistente') === 1)

// Salir de inasistente hacia no-inasistente → -1 (3 casos)
assert('inasistente → NULL = -1', computeNoShowDelta('inasistente', null) === -1)
assert('inasistente → admitido = -1', computeNoShowDelta('inasistente', 'admitido') === -1)
assert('inasistente → facturado = -1', computeNoShowDelta('inasistente', 'facturado') === -1)

// ============================================================
// Labels UI
// ============================================================
console.log('\n=== attendanceOutcomeLabel ===')
assert('null → "Programado"', attendanceOutcomeLabel(null) === 'Programado')
assert('admitido → "Admitido"', attendanceOutcomeLabel('admitido') === 'Admitido')
assert('facturado → "Facturado"', attendanceOutcomeLabel('facturado') === 'Facturado')
assert('inasistente → "Inasistente"', attendanceOutcomeLabel('inasistente') === 'Inasistente')

// ============================================================
// SMOKE integración: CHECK constraint en DB rechaza valor inválido
// ============================================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function smokeCheckConstraint(): Promise<void> {
  console.log('\n=== SMOKE: CHECK constraint en DB ===')

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('  ⏭  Skipped (env vars Supabase faltantes)')
    return
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Buscar una cita real (no tocamos su outcome — solo probamos constraint)
  const { data: testApt } = await supa
    .from('appointments')
    .select('id, attendance_outcome')
    .eq('clinic_id', 'a1b2c3d4-0000-0000-0000-000000000001')  // Demo clinic
    .limit(1)
    .single()

  if (!testApt) {
    console.log('  ⏭  Skipped (no hay citas en clínica Demo para probar)')
    return
  }

  // Intentar setear un valor INVÁLIDO → debe fallar por CHECK constraint
  const { error: invalidErr } = await supa
    .from('appointments')
    .update({ attendance_outcome: 'BANANA' })
    .eq('id', testApt.id)

  assert(
    'CHECK rechaza valor inválido ("BANANA")',
    invalidErr !== null && invalidErr.message.includes('check'),
    invalidErr?.message,
  )

  // Valor válido funciona (revertir al final si cambiamos)
  const original = (testApt.attendance_outcome ?? null) as 'admitido' | 'facturado' | 'inasistente' | null
  const { error: validErr } = await supa
    .from('appointments')
    .update({ attendance_outcome: 'admitido' })
    .eq('id', testApt.id)
  assert('CHECK acepta "admitido"', validErr === null)

  // Revertir al estado original (no contaminar Demo)
  await supa
    .from('appointments')
    .update({ attendance_outcome: original })
    .eq('id', testApt.id)
}

;(async () => {
  await smokeCheckConstraint()

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
})()
