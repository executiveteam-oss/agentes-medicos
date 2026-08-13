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
// NI LA FECHA NI EL DÍA SE HARDCODEAN.
//
// Dos veces este test falló por datos que envejecieron, no por bugs:
//  · julio fijaba '2026-08-03', que en agosto ya era pasado;
//  · y asumía "Juan Diego atiende los lunes", que dejó de ser cierto.
// Lo que el test verifica es que la tool use el médico PEDIDO y no el default,
// y eso NO depende de qué día atiende cada uno — solo de que atiendan días
// distintos. Así que el día se BUSCA: se toma el primero en que el pedido
// atiende y el default no.
function proximoDiaDeSemana(diaSemana: number, diasMinimos = 7): string {
  const d = new Date()
  d.setDate(d.getDate() + diasMinimos)
  while (d.getDay() !== diaSemana) d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const CLAVES_DIA = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const
function atiende(wh: Record<string, { active?: boolean; blocks?: unknown[] }> | null, dia: number): boolean {
  const d = wh?.[CLAVES_DIA[dia]]
  return !!d?.active && (d.blocks?.length ?? 0) > 0
}

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('../src/agents/tools/executor')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await supa.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: adriana } = await supa.from('doctors').select('*').eq('id', ADRIANA).single()
  const { data: juanDiego } = await supa.from('doctors').select('*').eq('id', JUAN_DIEGO).single()

  // El día donde los dos difieren: el PEDIDO atiende, el default no.
  const whJD = juanDiego?.working_hours as Record<string, { active?: boolean; blocks?: unknown[] }> | null
  const whAD = adriana?.working_hours as Record<string, { active?: boolean; blocks?: unknown[] }> | null
  const diaUtil = [1,2,3,4,5,6].find((d) => atiende(whJD, d) && !atiende(whAD, d))
  if (diaUtil === undefined) {
    console.log('⚠️  No hay ningún día en que Juan Diego atienda y Adriana no.')
    console.log('    El test no puede distinguir "usa el pedido" de "usa el default" — NO pasa por defecto.')
    process.exit(1)
  }
  const LUNES = proximoDiaDeSemana(diaUtil)
  const NOMBRE_DIA = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][diaUtil]
  console.log(`Día elegido: ${NOMBRE_DIA} ${LUNES} (Juan Diego atiende · Adriana no)\n`)

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
  console.log(`  doctor_id = Juan Diego (atiende) | doctor param = Adriana (NO atiende)`)
  console.log(`  → available=${data.available} reason="${data.reason ?? ''}"\n`)

  let ok = 0, fail = 0
  const a = (label: string, cond: boolean) => { cond ? (console.log(`  ✅ ${label}`), ok++) : (console.log(`  ❌ ${label}`), fail++) }

  a('usa el horario del médico PEDIDO (Juan Diego) → available=true', data.available === true)
  a('NO usa el horario del `doctor` param (Adriana, que ese día no atiende)',
    !(data.reason ?? '').includes('no atiende ese día'))

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
