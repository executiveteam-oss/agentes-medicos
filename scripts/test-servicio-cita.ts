// ============================================================
// Tests del servicio de una cita importada.
//
// Lo que protegen, en orden de qué tan caro sale romperlo:
//
// 1. Que NUNCA se elija una fila del catálogo al azar. Esa fila lleva el PRECIO:
//    "TERAPIA DE PISO PELVICO" existe dos veces —Lina a $60.000 y Daniela sin
//    precio— y elegir la equivocada le inventa una tarifa a una paciente.
// 2. Que el texto de iSalud se muestre IGUAL cuando no hay match. El texto sin
//    fila resuelve el problema de Carolina; la fila equivocada crea uno peor.
// 3. Que el "Motivo" no repita el nombre de la paciente.
// 4. Que la entidad concatenada se separe sin adivinar.
//
// Los datos son los REALES de Algia al 2026-08-13.
// Correr: npx tsx scripts/test-servicio-cita.ts
// ============================================================

import {
  normalizarServicio, matchearServicio, parsearEntidadISalud, motivoEsElNombre,
  type FilaCatalogo,
} from '../src/lib/isalud/servicio-cita'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const LINA = 'eacf026c-4aef-49f9-9d0b-f6daf3f69ec1'
const DANIELA = 'b5805347-4650-4eb1-a3a7-37b06f16b965'
const JORGE = '069523a9-f13b-4268-a77c-514d54c5672c'

// Filas REALES del catálogo de Algia.
const CAT: FilaCatalogo[] = [
  // El caso peligroso: mismo nombre, dos médicos, PRECIOS DISTINTOS.
  { id: 'tpp-lina',    name: 'TERAPIA DE PISO PELVICO', eps_name: null, price: 60000, is_active: true, doctor_id: LINA },
  { id: 'tpp-daniela', name: 'TERAPIA DE PISO PELVICO', eps_name: null, price: null,  is_active: true, doctor_id: DANIELA },
  // Inequívoco: una sola fila.
  { id: 'mapeo',       name: 'ECOGRAFIA DE MAPEO PELVICO', eps_name: null, price: 180000, is_active: true, doctor_id: JORGE },
  // Mismo nombre repetido por convenio.
  { id: 'pv-medplus',  name: 'CONSULTA DE PRIMERA VEZ', eps_name: 'MEDPLUS',  price: 90000,  is_active: true, doctor_id: JORGE },
  { id: 'pv-coomeva',  name: 'CONSULTA DE PRIMERA VEZ', eps_name: 'COOMEVA',  price: 110000, is_active: true, doctor_id: JORGE },
  // Inactiva: no debe matchear nunca.
  { id: 'vieja',       name: 'COLPOSCOPIA', eps_name: null, price: 200000, is_active: false, doctor_id: JORGE },
]

console.log('\n🔴 LO MÁS CARO: no elegir fila al azar cuando el precio difiere')
const sinMedico = matchearServicio('Terapia de piso pelvico', CAT)
ok('sin médico → AMBIGUO (no inventa precio)', sinMedico.tipo === 'ambiguo')
ok('  …y dice cuántos candidatos', sinMedico.tipo === 'ambiguo' && sinMedico.candidatos === 2)

const conLina = matchearServicio('Terapia de piso pelvico', CAT, null, LINA)
ok('con médico Lina → resuelve a SU fila', conLina.tipo === 'resuelto_por_medico' && conLina.consultationTypeId === 'tpp-lina')
const conDaniela = matchearServicio('Terapia de piso pelvico', CAT, null, DANIELA)
ok('con médico Daniela → resuelve a SU fila', conDaniela.tipo === 'resuelto_por_medico' && conDaniela.consultationTypeId === 'tpp-daniela')
ok('🔴 y NO son la misma fila', (conLina as { consultationTypeId: string }).consultationTypeId !== (conDaniela as { consultationTypeId: string }).consultationTypeId)

const medicoAjeno = matchearServicio('Terapia de piso pelvico', CAT, null, JORGE)
ok('médico que NO tiene esa fila → ambiguo, no elige otra', medicoAjeno.tipo === 'ambiguo')

console.log('\nMATCH INEQUÍVOCO')
const mapeo = matchearServicio('Ecografia de mapeo pelvico', CAT, null, JORGE)
ok('una sola fila → inequívoco', mapeo.tipo === 'inequivoco' && mapeo.consultationTypeId === 'mapeo')
ok('la tilde rara de iSalud no lo rompe',
  matchearServicio('EcografÍa de mapeo pÉlvico'.replace('É','E'), CAT, null, JORGE).tipo === 'inequivoco')

console.log('\nDESAMBIGUACIÓN POR CONVENIO')
const porConv = matchearServicio('Consulta de primera vez', CAT, 'MEDPLUS MEDICINA PREPAGADA', JORGE)
ok('la entidad larga matchea el convenio corto', porConv.tipo === 'resuelto_por_convenio' && porConv.consultationTypeId === 'pv-medplus')
ok('entidad que no matchea ningún convenio → ambiguo',
  matchearServicio('Consulta de primera vez', CAT, 'SALUD TOTAL', JORGE).tipo === 'ambiguo')
ok('sin entidad → ambiguo',
  matchearServicio('Consulta de primera vez', CAT, null, JORGE).tipo === 'ambiguo')

console.log('\nLO QUE NO DEBE MATCHEAR')
ok('fila INACTIVA no matchea', matchearServicio('Colposcopia', CAT, null, JORGE).tipo === 'sin_match')
ok('servicio que no está en el catálogo', matchearServicio('Ecografia de tiroides', CAT, null, JORGE).tipo === 'sin_match')
ok('texto vacío', matchearServicio('', CAT, null, JORGE).tipo === 'sin_match')

console.log('\nNORMALIZACIÓN')
ok('tildes', normalizarServicio('EcografÍa dinÁmica') === 'ecografia dinamica')
ok('mayúsculas y espacios dobles', normalizarServicio('  TERAPIA   DE  PISO ') === 'terapia de piso')
ok('punto final', normalizarServicio('Colposcopia.') === 'colposcopia')

console.log('\n🔴 LA ENTIDAD PEGADA (el bug del panel)')
const e1 = parsearEntidadISalud('PARTICULARRégimen: ParticularTipo afiliado: Cotizante')
ok('entidad', e1?.entidad === 'PARTICULAR')
ok('régimen', e1?.regimen === 'Particular')
ok('tipo afiliado', e1?.tipoAfiliado === 'Cotizante')

const e2 = parsearEntidadISalud('SURAMERICANA SEG VIDARégimen: EspecialTipo afiliado: Tomador/Amparado Planes voluntarios de salud')
ok('entidad con espacios', e2?.entidad === 'SURAMERICANA SEG VIDA')
ok('tipo afiliado largo', e2?.tipoAfiliado === 'Tomador/Amparado Planes voluntarios de salud')

const e3 = parsearEntidadISalud('COLMEDICA MEDICINA PREPAGADA S.ARégimen: EspecialTipo afiliado: Cotizante')
ok('entidad con punto adentro (S.A)', e3?.entidad === 'COLMEDICA MEDICINA PREPAGADA S.A')

console.log('\n…y si el patrón NO viene, no se corta a ciegas')
const raro = parsearEntidadISalud('COOMEVA')
ok('sin marcadores → todo va a entidad', raro?.entidad === 'COOMEVA' && raro?.regimen === null)
ok('vacío → null', parsearEntidadISalud('') === null)
ok('null → null', parsearEntidadISalud(null) === null)

console.log('\nEL "MOTIVO" QUE REPETÍA EL NOMBRE')
ok('reason == nombre → se oculta', motivoEsElNombre('LUISA FERNANDA MONTOYA CARDOZO', 'LUISA FERNANDA MONTOYA CARDOZO'))
ok('con espacios dobles de iSalud → igual se oculta', motivoEsElNombre('LUISA  FERNANDA  MONTOYA', 'LUISA FERNANDA MONTOYA'))
ok('con tildes distintas → igual', motivoEsElNombre('JOSÉ PÉREZ', 'JOSE PEREZ'))
ok('"Bloqueo iSalud" también se oculta', motivoEsElNombre('Bloqueo iSalud', 'Quien sea'))
ok('🔴 un motivo REAL se muestra', !motivoEsElNombre('Control post cirugía', 'LUISA FERNANDA MONTOYA'))
ok('motivo vacío no rompe', !motivoEsElNombre('', 'LUISA'))
ok('sin nombre de paciente, un motivo real se muestra', !motivoEsElNombre('Dolor pélvico', null))

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
