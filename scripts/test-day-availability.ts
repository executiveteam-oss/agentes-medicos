// ============================================================
// Tests de la fuente única de disponibilidad por día.
//
// Lo que protegen, en orden de qué tan caro sale romperlo:
//
// 1. Que "no atiende ese día" y "cerramos ese día" NO se confundan. Para quien
//    agenda son decisiones distintas: al primero le busca otro día del mismo
//    médico; al segundo, otro médico o llama a la paciente.
// 2. Que un día que el médico marcó inactivo NO herede el horario de la clínica.
//    Ya pasó: un médico que no trabajaba los miércoles aparecía libre 08–18.
// 3. Que el bloqueo gane sobre el horario. Angélica atiende los viernes 13–16;
//    el viernes 14/08 la clínica cerró. Si el bloqueo no ganara, la grilla
//    pintaría verde sobre un día cerrado — el bug que originó todo esto.
//
// Los datos son los REALES de Algia al 2026-08-13.
// Correr: npx tsx scripts/test-day-availability.ts
// ============================================================

import {
  resolverDisponibilidadDia, estadoDeFranja, motivoParaConfirmar,
  type DatosDelDia,
} from '../src/lib/calendar/day-availability'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// ---- horarios REALES ----
const ADRIANA = {
  nombre: 'ADRIANA  ESTEVEZ DURAN',
  working_hours: {
    monday:   { active: false, blocks: [] },
    thursday: { active: true,  blocks: [{ start: '08:00', end: '11:00' }] },
    friday:   { active: false, blocks: [] },
  },
  agenda_closed: false, agenda_closed_reason: null, agenda_closed_until: null,
  schedule_type: 'fixed', manual_availability_message: null,
}
const ANGELICA = {
  nombre: 'ANGELICA  MARIA QUINTERO MONTAÑO',
  working_hours: {
    monday:   { active: true, blocks: [{ start: '13:00', end: '16:30' }] },
    thursday: { active: true, blocks: [{ start: '07:00', end: '12:00' }] },
    friday:   { active: true, blocks: [{ start: '13:00', end: '16:00' }] },
  },
  agenda_closed: false, agenda_closed_reason: null, agenda_closed_until: null,
  schedule_type: 'fixed', manual_availability_message: null,
}
// El horario de la CLÍNICA: amplio y todos los días. Es el que se filtraba
// cuando el médico tenía el día inactivo.
const HORARIO_CLINICA = {
  monday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  thursday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  friday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
}

function datos(over: Partial<DatosDelDia>): DatosDelDia {
  return {
    fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1,
    medico: ADRIANA, fechaBloqueada: null, configWhatsApp: null,
    horarioClinica: HORARIO_CLINICA,
    ...over,
  }
}

console.log('\n🔴 CASO 1 — ADRIANA un LUNES (no atiende) → FUERA DE HORARIO todo el día')
const c1 = resolverDisponibilidadDia(datos({ fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1 }))
ok('no atiende', c1.atiende === false)
ok('sin franjas', c1.franjas.length === 0)
ok('NO es un bloqueo (es fuera de horario)', c1.bloqueo === null)
for (const h of ['08:00', '10:00', '13:00', '17:00']) {
  ok(`  ${h} → fuera_de_horario`, estadoDeFranja(c1, h) === 'fuera_de_horario')
}
ok('el motivo dice que no atiende los lunes',
  /no atiende los lunes/i.test(motivoParaConfirmar(c1, ADRIANA.nombre)))

console.log('\n🔴 …Y NO HEREDA EL HORARIO DE LA CLÍNICA (el bug de los 08–18)')
ok('la clínica abre 08–18 ese lunes pero Adriana sigue sin atender',
  estadoDeFranja(c1, '09:00') === 'fuera_de_horario')

console.log('\n🔴 CASO 2 — ADRIANA un JUEVES → DISPONIBLE 08:00–11:00')
const c2 = resolverDisponibilidadDia(datos({ fecha: '2026-08-20', diaSemana: 'jueves', indiceDiaSemana: 4 }))
ok('atiende', c2.atiende === true)
ok('sin bloqueo', c2.bloqueo === null)
ok('una franja 08:00–11:00', c2.franjas.length === 1 && c2.franjas[0].start === '08:00' && c2.franjas[0].end === '11:00')
for (const h of ['08:00', '09:00', '10:00', '10:59']) {
  ok(`  ${h} → disponible`, estadoDeFranja(c2, h) === 'disponible')
}
for (const h of ['07:00', '07:59', '11:00', '15:00']) {
  ok(`  ${h} → fuera_de_horario (fin EXCLUSIVO)`, estadoDeFranja(c2, h) === 'fuera_de_horario')
}

console.log('\n🔴 CASO 3 — ANGÉLICA el VIERNES 14/08 (bloqueado) → BLOQUEADO, no "fuera de horario"')
const c3 = resolverDisponibilidadDia(datos({
  fecha: '2026-08-14', diaSemana: 'viernes', indiceDiaSemana: 5, medico: ANGELICA,
  fechaBloqueada: { doctor_id: '6a0c89a0-539e-4d75-a841-5742b3c9bd5b', reason: null },
}))
ok('no atiende', c3.atiende === false)
ok('🔴 ES un bloqueo (distinto del caso 1)', c3.bloqueo !== null)
ok('tipo = fecha bloqueada del médico', c3.bloqueo?.tipo === 'fecha_bloqueada_medico')
ok('el motivo nombra a la médica', /angelica/i.test(c3.bloqueo?.motivo ?? ''))
ok('el motivo dice la fecha', (c3.bloqueo?.motivo ?? '').includes('14/08'))
for (const h of ['13:00', '14:00', '15:30']) {
  ok(`  ${h} → bloqueado (aunque los viernes SÍ atiende 13–16)`, estadoDeFranja(c3, h) === 'bloqueado')
}

console.log('\n🔴 LA DISTINCIÓN QUE ES REQUISITO: caso 1 ≠ caso 3')
ok('caso 1 (no atiende) → "fuera_de_horario"', estadoDeFranja(c1, '09:00') === 'fuera_de_horario')
ok('caso 3 (bloqueado)  → "bloqueado"', estadoDeFranja(c3, '14:00') === 'bloqueado')
ok('🔴 SON ESTADOS DISTINTOS', estadoDeFranja(c1, '09:00') !== estadoDeFranja(c3, '14:00'))

console.log('\n…y un VIERNES NORMAL de Angélica sí es disponible')
const c3b = resolverDisponibilidadDia(datos({
  fecha: '2026-08-21', diaSemana: 'viernes', indiceDiaSemana: 5, medico: ANGELICA, fechaBloqueada: null,
}))
ok('el 21/08 atiende 13–16', estadoDeFranja(c3b, '14:00') === 'disponible')
ok('fuera de esa franja, no', estadoDeFranja(c3b, '09:00') === 'fuera_de_horario')

console.log('\nLOS OTROS DOS BLOQUEOS')
const cerrada = resolverDisponibilidadDia(datos({
  medico: { ...ANGELICA, agenda_closed: true, agenda_closed_reason: 'Vacaciones', agenda_closed_until: '2026-09-01' },
  diaSemana: 'lunes', indiceDiaSemana: 1,
}))
ok('agenda cerrada → bloqueado', cerrada.bloqueo?.tipo === 'agenda_cerrada')
ok('el motivo dice hasta cuándo', (cerrada.bloqueo?.motivo ?? '').includes('01/09'))
ok('y el porqué', /vacaciones/i.test(cerrada.bloqueo?.motivo ?? ''))

const manual = resolverDisponibilidadDia(datos({
  medico: { ...ANGELICA, schedule_type: 'manual', manual_availability_message: 'Coordina por teléfono' },
}))
ok('horario manual → bloqueado', manual.bloqueo?.tipo === 'horario_manual')
ok('usa el mensaje del médico', manual.bloqueo?.motivo === 'Coordina por teléfono')

const clinicaCerrada = resolverDisponibilidadDia(datos({
  medico: ANGELICA, diaSemana: 'viernes', indiceDiaSemana: 5, fecha: '2026-08-14',
  fechaBloqueada: { doctor_id: null, reason: 'Festivo' },
}))
ok('bloqueo de CLÍNICA se distingue del de médico', clinicaCerrada.bloqueo?.tipo === 'fecha_bloqueada_clinica')
ok('y no nombra a ningún médico', !/angelica/i.test(clinicaCerrada.bloqueo?.motivo ?? ''))

console.log('\nPRECEDENCIA')
const soloClinica = resolverDisponibilidadDia(datos({
  medico: { ...ADRIANA, working_hours: null }, diaSemana: 'lunes', indiceDiaSemana: 1,
}))
ok('sin working_hours del médico → hereda el de la clínica', soloClinica.atiende === true)

const conWhatsApp = resolverDisponibilidadDia(datos({
  medico: { ...ADRIANA, working_hours: {} }, diaSemana: 'lunes', indiceDiaSemana: 1,
  configWhatsApp: { days: [1], start: '14:00', end: '16:00' },
}))
ok('whatsapp_config gana sobre el horario de la clínica', conWhatsApp.franjas[0]?.start === '14:00')

console.log('\nBORDES')
ok('sin médico → no atiende', resolverDisponibilidadDia(datos({ medico: null })).atiende === false)
ok('hora inválida → fuera_de_horario', estadoDeFranja(c2, 'xx:yy') === 'fuera_de_horario')
ok('varias franjas: entre medio queda fuera', estadoDeFranja(
  resolverDisponibilidadDia(datos({
    medico: { ...ADRIANA, working_hours: { monday: { active: true, blocks: [
      { start: '07:00', end: '11:00' }, { start: '13:00', end: '17:00' }] } } },
    diaSemana: 'lunes', indiceDiaSemana: 1,
  })), '12:00') === 'fuera_de_horario')

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
