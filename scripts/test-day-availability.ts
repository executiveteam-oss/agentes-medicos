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
// 🪦 HORARIO_CLINICA se fue (2026-08-22). resolverFranjas ya no acepta un
// horario de clínica: dejó de ser fallback. Un médico sin horario propio no
// ofrece cupos, en vez de heredar los del consultorio.
function datos(over: Partial<DatosDelDia>): DatosDelDia {
  return {
    fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1,
    medico: ADRIANA, fechaBloqueada: null, configWhatsApp: null,
    festivo: null, estadoClinica: null,
    excepcion: null,
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

console.log('\n🔴 …Y UN MÉDICO SIN HORARIO PROPIO NO OFRECE NADA')
ok('Adriana un lunes: sin franjas, sin heredar nada',
  estadoDeFranja(c1, '09:00') === 'fuera_de_horario')
// El caso nuevo: un médico SIN working_hours (no "con el día apagado").
// Antes heredaba el horario del consultorio; ahora no tiene de dónde.
const sinHorario = resolverDisponibilidadDia(datos({
  medico: { nombre: 'Dr. Sin Horario', working_hours: null, agenda_closed: false,
    agenda_closed_reason: null, agenda_closed_until: null, schedule_type: null,
    manual_availability_message: null },
}))
ok('médico sin working_hours → no atiende', sinHorario.atiende === false)
ok('médico sin working_hours → cero franjas', sinHorario.franjas.length === 0)
ok('y NO es un bloqueo: es que no sabemos su horario', sinHorario.bloqueo === null)

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
// 🔴 ESTE CASO SE DIO VUELTA (2026-08-22). Antes: "hereda el de la clínica".
// Heredar convertía "no sabemos su horario" en cupos concretos con el horario
// del consultorio detrás — el agente ofrecía una hora que nadie había cargado.
ok('sin working_hours del médico → NO hereda nada, no atiende', soloClinica.atiende === false)
ok('   y sin franjas', soloClinica.franjas.length === 0)

const conWhatsApp = resolverDisponibilidadDia(datos({
  medico: { ...ADRIANA, working_hours: {} }, diaSemana: 'lunes', indiceDiaSemana: 1,
  configWhatsApp: { days: [1], start: '14:00', end: '16:00' },
}))
ok('whatsapp_config gana sobre el horario de la clínica', conWhatsApp.franjas[0]?.start === '14:00')

console.log('\n🔴 FESTIVO — el bug que descubrió una paciente en el chat')
// Omuwan no sabía que el 17/08 es festivo y el agente ofrecía cita ese día.
const festivo = resolverDisponibilidadDia(datos({
  fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1, medico: ANGELICA,
  festivo: { nombre: 'Asunción de la Virgen' },
}))
ok('festivo → bloqueado', festivo.bloqueo?.tipo === 'festivo')
ok('🔴 el motivo NOMBRA el festivo', festivo.bloqueo?.motivo === 'Festivo — Asunción de la Virgen.')
ok('no atiende', festivo.atiende === false)
for (const h of ['08:00', '14:00', '16:00']) {
  ok(`  ${h} → bloqueado (aunque Angélica atiende los lunes 13–16:30)`, estadoDeFranja(festivo, h) === 'bloqueado')
}

// El festivo GANA sobre todo lo demás: el país no trabaja, no importa el resto.
const festivoYAgenda = resolverDisponibilidadDia(datos({
  fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1,
  medico: { ...ANGELICA, agenda_closed: true, agenda_closed_reason: 'Vacaciones' },
  festivo: { nombre: 'Asunción de la Virgen' },
}))
ok('gana sobre agenda_closed', festivoYAgenda.bloqueo?.tipo === 'festivo')
const festivoYBloqueo = resolverDisponibilidadDia(datos({
  fecha: '2026-08-17', diaSemana: 'lunes', indiceDiaSemana: 1, medico: ANGELICA,
  festivo: { nombre: 'Asunción de la Virgen' },
  fechaBloqueada: { doctor_id: 'x', reason: 'lo que sea' },
}))
ok('gana sobre blocked_dates', festivoYBloqueo.bloqueo?.tipo === 'festivo')

// Y sin festivo, el mismo lunes es un día normal — que es lo que pasa cuando la
// clínica destapa el feriado (el fetcher manda festivo:null).
const lunesNormal = resolverDisponibilidadDia(datos({
  fecha: '2026-08-24', diaSemana: 'lunes', indiceDiaSemana: 1, medico: ANGELICA, festivo: null,
}))
ok('sin festivo, Angélica atiende ese lunes 13–16:30', estadoDeFranja(lunesNormal, '14:00') === 'disponible')

console.log('\nBORDES')
ok('sin médico → no atiende', resolverDisponibilidadDia(datos({ medico: null })).atiende === false)
ok('hora inválida → fuera_de_horario', estadoDeFranja(c2, 'xx:yy') === 'fuera_de_horario')
ok('varias franjas: entre medio queda fuera', estadoDeFranja(
  resolverDisponibilidadDia(datos({
    medico: { ...ADRIANA, working_hours: { monday: { active: true, blocks: [
      { start: '07:00', end: '11:00' }, { start: '13:00', end: '17:00' }] } } },
    diaSemana: 'lunes', indiceDiaSemana: 1,
  })), '12:00') === 'fuera_de_horario')

// ============================================================
// EXCEPCIÓN DE HORARIO POR FECHA
//
// "Este martes atiendo distinto, los demás martes igual."
//
// La regla entera está en DÓNDE se evalúa: después de todos los bloqueos y
// antes de working_hours. Una excepción cambia las HORAS de un día que se
// atiende; NUNCA abre un día cerrado. Estos tests son los que impiden que
// alguien la mueva de lugar "para simplificar".
// ============================================================
console.log('\nEXCEPCIÓN DE HORARIO POR FECHA')

const EXC = { blocks: [{ start: '14:00', end: '18:00' }], reason: 'Congreso en la mañana' }

// Adriana atiende los JUEVES de 08:00 a 11:00. Es el par que decide: el jueves
// con excepción y el jueves siguiente sin ella tienen que verse distinto.
const conExc = resolverDisponibilidadDia(datos({
  fecha: '2026-08-27', diaSemana: 'jueves', indiceDiaSemana: 4, excepcion: EXC,
}))
ok('la franja de la excepción manda', estadoDeFranja(conExc, '15:00') === 'disponible')
ok('el horario base de ese día YA NO aplica', estadoDeFranja(conExc, '09:00') === 'fuera_de_horario')
ok('el día se atiende', conExc.atiende === true && conExc.bloqueo === null)
ok('queda marcado como excepción', conExc.excepcion?.motivo === 'Congreso en la mañana')
ok('y expone el horario base para poder comparar',
  JSON.stringify(conExc.excepcion?.franjasBase) === JSON.stringify([{ start: '08:00', end: '11:00' }]))

// El mismo día de la semana SIN excepción sigue con el horario de siempre.
const sinExc = resolverDisponibilidadDia(datos({
  fecha: '2026-09-03', diaSemana: 'jueves', indiceDiaSemana: 4, excepcion: null,
}))
ok('otro jueves sigue con el horario base 08–11', estadoDeFranja(sinExc, '09:00') === 'disponible')
ok('y NO tiene la franja de la excepción', estadoDeFranja(sinExc, '15:00') === 'fuera_de_horario')
ok('sin excepción no se marca nada', sinExc.excepcion === undefined)

console.log('\nUNA EXCEPCIÓN NUNCA ABRE UN DÍA CERRADO')
ok('festivo gana sobre la excepción', resolverDisponibilidadDia(datos({
  excepcion: EXC, festivo: { nombre: 'Asunción de la Virgen' },
})).bloqueo?.tipo === 'festivo')
ok('agenda_closed gana sobre la excepción', resolverDisponibilidadDia(datos({
  excepcion: EXC, medico: { ...ADRIANA, agenda_closed: true },
})).bloqueo?.tipo === 'agenda_cerrada')
ok('fecha bloqueada gana sobre la excepción', resolverDisponibilidadDia(datos({
  excepcion: EXC, fechaBloqueada: { doctor_id: 'x', reason: 'Vacaciones' },
})).bloqueo?.tipo === 'fecha_bloqueada_medico')
ok('clínica no operativa gana sobre la excepción', resolverDisponibilidadDia(datos({
  excepcion: EXC, estadoClinica: { estado: 'cerrado', mensaje: null },
})).bloqueo?.tipo === 'clinica_no_operativa')
ok('en todos esos casos NO se atiende', [
  resolverDisponibilidadDia(datos({ excepcion: EXC, festivo: { nombre: 'x' } })),
  resolverDisponibilidadDia(datos({ excepcion: EXC, medico: { ...ADRIANA, agenda_closed: true } })),
  resolverDisponibilidadDia(datos({ excepcion: EXC, fechaBloqueada: { doctor_id: 'x', reason: null } })),
].every((r) => r.atiende === false && r.franjas.length === 0))

console.log('\nUNA EXCEPCIÓN SIN FRANJAS NO EXISTE')
ok('excepción con blocks vacío → se ignora, rige el horario base',
  estadoDeFranja(resolverDisponibilidadDia(datos({
    fecha: '2026-08-27', diaSemana: 'jueves', indiceDiaSemana: 4,
    excepcion: { blocks: [], reason: 'vacía' },
  })), '09:00') === 'disponible')

console.log('\nUNA EXCEPCIÓN SÍ PUEDE DAR HORARIO A UN DÍA QUE EL MÉDICO NO ATIENDE')
// Adriana tiene el martes inactivo. Una excepción para un martes puntual le da
// franja: el día no está CERRADO (no hay bloqueo), solo no era su día habitual.
// Distinto de festivo/vacaciones/bloqueo, donde el día sí está cerrado.
const martesExcepcional = resolverDisponibilidadDia(datos({
  fecha: '2026-08-25', diaSemana: 'martes', indiceDiaSemana: 2, excepcion: EXC,
}))
ok('martes con excepción → atiende 14–18', estadoDeFranja(martesExcepcional, '15:00') === 'disponible')
ok('y su horario base era vacío', martesExcepcional.excepcion?.franjasBase.length === 0)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
