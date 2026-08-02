/**
 * Tests — lógica pura de etiquetas de paciente.
 * Run: npx tsx scripts/test-patient-labels.ts
 */
import {
  validateNewLabel, pickableLabels, resolveLabels, toggleLabel,
  renameInCatalog, archiveInCatalog, deleteFromCatalog, isValidColor, type ClinicLabel,
} from '../src/lib/labels/patient-labels'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — etiquetas de paciente\n')

const cat: ClinicLabel[] = [
  { id: 'lbl_a', name: 'pendiente de ICER', color: 'amber' },
  { id: 'lbl_b', name: 'terapias', color: 'green' },
  { id: 'lbl_c', name: 'vieja', color: 'gray', archived: true },
]

// Validación
assert('nombre vacío → error', !validateNewLabel('   ', cat).ok)
assert('duplicado (case/tildes/espacios) → error', !validateNewLabel('  Pendiente de Icer ', cat).ok)
assert('duplicado NO cuenta contra archivadas → permite "vieja"', validateNewLabel('vieja', cat).ok)
assert('> 40 chars → error', !validateNewLabel('x'.repeat(41), cat).ok)
assert('nombre nuevo válido → ok + trim', validateNewLabel('  agendar en septiembre ', cat).name === 'agendar en septiembre')

// Selector: no ofrece archivadas
assert('pickable excluye archivadas', pickableLabels(cat).every((l) => l.id !== 'lbl_c'))
assert('pickable ordenado por nombre', pickableLabels(cat)[0].name === 'pendiente de ICER' ? pickableLabels(cat).length === 2 : false)

// Resolver: incluye archivadas (para verlas donde ya están puestas)
assert('resolve incluye archivada si la paciente la tiene', resolveLabels(['lbl_c'], cat)[0]?.name === 'vieja')
assert('resolve ignora ids que ya no existen', resolveLabels(['lbl_a', 'lbl_zzz'], cat).length === 1)

// Toggle
assert('toggle on agrega', toggleLabel(['lbl_a'], 'lbl_b', true).includes('lbl_b'))
assert('toggle on es idempotente (sin duplicar)', toggleLabel(['lbl_a'], 'lbl_a', true).length === 1)
assert('toggle off quita', !toggleLabel(['lbl_a', 'lbl_b'], 'lbl_a', false).includes('lbl_a'))

// Catálogo
assert('renombrar mantiene el id (pacientes intactas)', renameInCatalog(cat, 'lbl_a', 'ICER pendiente', 'red').find((l) => l.id === 'lbl_a')?.name === 'ICER pendiente')
assert('archivar setea archived=true', archiveInCatalog(cat, 'lbl_b').find((l) => l.id === 'lbl_b')?.archived === true)
assert('eliminar saca del catálogo', !deleteFromCatalog(cat, 'lbl_a').some((l) => l.id === 'lbl_a'))

// Color
assert('color válido', isValidColor('amber') && isValidColor('teal'))
assert('color inválido', !isValidColor('#ff0000') && !isValidColor('naranja'))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
