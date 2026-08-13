// ============================================================
// Tests del enlace cita ↔ ficha.
//
// Lo que protegen: que NUNCA se enlace por adivinanza. Un enlace equivocado no
// es un error de pantalla — es el recordatorio de una paciente llegándole a
// otra, y el agente reconociendo a quien no es cuando escriba por WhatsApp.
//
// Correr: npx tsx scripts/test-enlazar-ficha.ts
// ============================================================

import { normalizarDocumento, decidirEnlace, indexarFichasPorDocumento } from '../src/lib/isalud/enlazar-ficha'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// Padrón de prueba: una ficha normal, y DOS con el mismo documento.
const PADRON = [
  { id: 'p-luisa',  document_number: '1053813866' },
  { id: 'p-laura',  document_number: '1088347830' },
  { id: 'p-dup-a',  document_number: '9999999' },
  { id: 'p-dup-b',  document_number: '9.999.999' },   // mismo doc, otra escritura
  { id: 'p-sindoc', document_number: null },
]
const IDX = indexarFichasPorDocumento(PADRON)

console.log('\nNORMALIZACIÓN — iSalud manda "CC 1053813866", el padrón "1053813866"')
ok('quita el prefijo CC', normalizarDocumento('CC 1053813866') === '1053813866')
ok('quita puntos', normalizarDocumento('1.053.813.866') === '1053813866')
ok('quita espacios', normalizarDocumento(' 1053813866 ') === '1053813866')
ok('null → vacío', normalizarDocumento(null) === '')
ok('texto sin dígitos → vacío', normalizarDocumento('SIN DOCUMENTO') === '')

console.log('\nENLACE LIMPIO')
const luisa = decidirEnlace('CC 1053813866', IDX)
ok('un documento → una ficha → enlaza', luisa.enlazar === true)
ok('  …y es la ficha correcta', luisa.enlazar && luisa.patientId === 'p-luisa')
ok('con puntos también', decidirEnlace('1.088.347.830', IDX).enlazar === true)

console.log('\n🔴 LO QUE NUNCA DEBE ENLAZAR')
const dup = decidirEnlace('9999999', IDX)
ok('documento en DOS fichas → NO enlaza', dup.enlazar === false)
ok('  …y dice por qué', !dup.enlazar && dup.razon === 'documento_duplicado')
const sinDoc = decidirEnlace('', IDX)
ok('cita sin documento → NO enlaza', sinDoc.enlazar === false && sinDoc.razon === 'sin_documento')
ok('cita con "SIN DOCUMENTO" → NO enlaza', decidirEnlace('SIN DOCUMENTO', IDX).enlazar === false)
const sinFicha = decidirEnlace('CC 4444444', IDX)
ok('documento que no está en el padrón → NO enlaza', sinFicha.enlazar === false && sinFicha.razon === 'sin_ficha')
ok('null → NO enlaza', decidirEnlace(null, IDX).enlazar === false)

console.log('\nEL ÍNDICE')
ok('agrupa los duplicados en vez de pisarlos', IDX.get('9999999')?.length === 2)
ok('la ficha sin documento no entra', !Array.from(IDX.values()).flat().includes('p-sindoc'))
ok('documentos únicos indexados', IDX.size === 3)

console.log('\n🔴 EL ESCENARIO QUE ESTE TEST EXISTE PARA IMPEDIR')
// Si alguien "simplifica" tomando el primero de la lista, este test se cae.
const conDup = decidirEnlace('9.999.999', IDX)
ok('con documento duplicado NO devuelve el primero', conDup.enlazar === false)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
