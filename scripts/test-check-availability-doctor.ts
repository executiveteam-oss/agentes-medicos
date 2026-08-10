/**
 * check_availability tiene que usar el médico PEDIDO — su horario Y SU NOMBRE.
 *
 * ⚠️ ESTE TEST PASÓ DIEZ DÍAS CON UN BUG ADENTRO.
 * La versión de julio verificaba solo `available` y `reason`, nunca el NOMBRE.
 * El fix de esa fecha movió los HORARIOS al médico pedido y dejó el nombre
 * saliendo del principal, en tres ramas distintas. El test siguió verde
 * mientras una paciente recibía la disponibilidad de su ginecólogo rotulada
 * con el nombre de otra médica.
 *
 * Por eso ahora se verifica el nombre en LAS TRES ramas que lo devuelven, no
 * solo en la que era fácil de alcanzar. Verificar una sola cosa de una sola
 * rama fue exactamente el agujero.
 *
 * Caso real Algia: Adriana NO atiende martes; Juan Diego SÍ (08:00–18:00).
 * Se llama check_availability para Adriana un MARTES, pasando a Juan Diego como
 * `doctor` param (el principal). Debe devolver available=false (Adriana no atiende
 * martes) — NO los cupos de Juan Diego. Antes del fix devolvía los de Juan Diego.
 * Read-only: check_availability no escribe.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-check-availability-doctor.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const ADRIANA = '2b0e5172-97ae-43a2-a1be-b266880191a5'      // lunes INACTIVO
const JUAN_DIEGO = '97a20f5e-4aac-48d0-bef9-4240e666dca5'   // lunes 08:00–18:00 ACTIVO
// El lunes se CALCULA, no se hardcodea. La versión de julio fijaba '2026-08-03'
// y para el 9 de agosto ya era pasado: la tool devolvía "se agenda con mínimo 1
// día de anticipación" y las aserciones de disponibilidad fallaban solas. Un
// test con una fecha futura escrita a mano tiene fecha de vencimiento.
function proximoLunes(diasMinimos = 7): string {
  const d = new Date()
  d.setDate(d.getDate() + diasMinimos)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)   // 1 = lunes
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const LUNES = proximoLunes()

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('../src/agents/tools/executor')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await supa.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: adriana } = await supa.from('doctors').select('*').eq('id', ADRIANA).single()

  // Llamada REAL que reproduce el bug reportado: doctor_id = Juan Diego (lunes ACTIVO),
  // pero el `doctor` param = Adriana (lunes INACTIVO), simulando que el principal es otro.
  // ANTES del fix: usaba Adriana (param) → available=false (el bug de "otra doctora").
  // DESPUÉS: usa Juan Diego (el pedido) → available=true, con SU horario.
  const result = await executeTool(
    'check_availability',
    { doctor_id: JUAN_DIEGO, preferred_date: LUNES },
    ALGIA,
    clinic as never,
    adriana as never,
  )
  const data = (result as { data?: { available?: boolean; reason?: string } }).data ?? {}

  console.log('Reproducción del bug check_availability (usa el médico PEDIDO, no el principal)\n')
  console.log(`  doctor_id = Juan Diego (lunes 08–18 ACTIVO) | doctor param = Adriana (lunes INACTIVO)`)
  console.log(`  → available=${data.available} reason="${data.reason ?? ''}"\n`)

  let ok = 0, fail = 0
  const a = (label: string, cond: boolean) => { cond ? (console.log(`  ✅ ${label}`), ok++) : (console.log(`  ❌ ${label}`), fail++) }

  a('usa el horario del médico PEDIDO (Juan Diego, lunes activo) → available=true', data.available === true)
  a('NO usa el horario del `doctor` param (Adriana, lunes inactivo)', data.reason !== 'El doctor no atiende ese día (lunes)')

  // ── RAMA 1: éxito. Es la que le pegó a la paciente el 2026-08-09.
  console.log('\nRAMA 1 — éxito con cupos: ¿de quién dice que son?')
  const nombre = (result as { data?: { doctor_name?: string } }).data?.doctor_name ?? ''
  console.log(`  doctor_name devuelto: "${nombre}"`)
  a('el nombre es el del médico PEDIDO (Juan Diego)', /juan\s*diego/i.test(nombre))
  a('NO es el del `doctorPorDefecto` (Adriana)', !/adriana/i.test(nombre))
  a('no viene vacío', nombre.trim().length > 0)

  // ── RAMAS 2 y 3: fecha bloqueada, con y sin motivo.
  // Van por la función pura: ejercitarlas contra la base exige un blocked_dates,
  // y Algia no tiene ninguno — por eso nunca las tocó ningún test.
  const { mensajeFechaBloqueada } = await import('../src/lib/calendar/blocked-date-message')

  console.log('\nRAMA 2 — fecha bloqueada CON motivo')
  const conMotivo = mensajeFechaBloqueada({
    nombreMedico: 'JUAN DIEGO VILLEGAS ECHEVERRI', bloqueadoPor: 'doctor',
    diaSemana: 'miércoles', motivo: 'Congreso',
  })
  console.log(`  "${conMotivo}"`)
  a('nombra al médico PEDIDO', /juan\s*diego/i.test(conMotivo))
  a('NO nombra a otro médico', !/adriana|lina|grajales/i.test(conMotivo))
  a('incluye el motivo', conMotivo.includes('Congreso'))

  console.log('\nRAMA 3 — fecha bloqueada SIN motivo')
  const sinMotivo = mensajeFechaBloqueada({
    nombreMedico: 'JUAN DIEGO VILLEGAS ECHEVERRI', bloqueadoPor: 'doctor',
    diaSemana: 'miércoles', motivo: null,
  })
  console.log(`  "${sinMotivo}"`)
  a('nombra al médico PEDIDO', /juan\s*diego/i.test(sinMotivo))
  a('NO nombra a otro médico', !/adriana|lina|grajales/i.test(sinMotivo))
  a('no deja "por:" colgando', !sinMotivo.includes('por:'))

  console.log('\nBORDES del mensaje')
  const clinica = mensajeFechaBloqueada({
    nombreMedico: 'JUAN DIEGO', bloqueadoPor: 'clinic', diaSemana: 'lunes', motivo: 'Festivo',
  })
  a('bloqueo de CLÍNICA no nombra a ningún médico', !/juan|diego/i.test(clinica))
  const sinNombre = mensajeFechaBloqueada({
    nombreMedico: null, bloqueadoPor: 'doctor', diaSemana: 'lunes', motivo: null,
  })
  a('sin nombre usa un genérico, NO otro médico', sinNombre.startsWith('El médico'))
  const vacio = mensajeFechaBloqueada({
    nombreMedico: '   ', bloqueadoPor: 'doctor', diaSemana: 'lunes', motivo: null,
  })
  a('nombre en blanco también cae al genérico', vacio.startsWith('El médico'))

  console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
