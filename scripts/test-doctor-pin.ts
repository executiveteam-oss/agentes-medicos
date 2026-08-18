/**
 * Test de la detección de médico (capa 1). Función PURA — sin DB ni red.
 * Run: npx tsx scripts/test-doctor-pin.ts
 */
import { detectarMencionDeMedico, normalizar, construirIndice } from '@/lib/agent/doctor-pin'

// Los 7 activos de Algia + el doctor de pruebas y el inactivo que comparten
// apellido/nombre — están a propósito: son los que generan las colisiones.
const DOCS = [
  { id: 'lina',    name: 'LINA MARIA GRAJALES MARULANDA' },
  { id: 'jorge',   name: 'JORGE DARIO LOPEZ ISANOA' },
  { id: 'daniela', name: 'DANIELA  OSORIO POSADA' },
  { id: 'angelica',name: 'ANGELICA  MARIA QUINTERO MONTAÑO' },
  { id: 'jazmin',  name: 'JAZMIN DANIELA GOMEZ  RAMIREZ' },
  { id: 'juandi',  name: 'JUAN DIEGO VILLEGAS ECHEVERRI' },
  { id: 'adriana', name: 'ADRIANA  ESTEVEZ DURAN' },
  { id: 'jose',    name: 'JOSÉ DUVÁN LÓPEZ JARAMILLO' },
  { id: 'juanl',   name: 'Juan Londoño' },
]

let ok = 0, fail = 0
function t(label: string, texto: string, esperado: string | null) {
  const r = detectarMencionDeMedico(texto, DOCS)
  const got = r?.doctor_id ?? null
  if (got === esperado) { console.log(`  ✅ ${label}`); ok++ }
  else { console.log(`  ❌ ${label}\n      texto="${texto}"\n      esperado=${esperado} · obtenido=${got}`); fail++ }
}

console.log('normalizar (tildes/puntuación):')
console.log(`  "Dr. Jorge Darío López" → "${normalizar('Dr. Jorge Darío López')}"`)
console.log(`  "ANGÉLICA MONTAÑO"      → "${normalizar('ANGÉLICA MONTAÑO')}"`)

console.log('\nLos dos casos REALES del 2026-08-17:')
t('Lina Marcela: "con el doctor Jorge Dario"',
  'Hola buenas tardes...para sacar cita revisión por cistitis con el doctor Jorge Dario ...esta semana porfa es que estoy delicada', 'jorge')
t('Luisa: "el doctor Jorge Isanoa"',
  'Me puedes confirmar el nombre del doctor es que primero me dices con el doctor Jorge Isanoa', 'jorge')

console.log('\nFormas reales de nombrar:')
t('apellido solo', 'quiero con isanoa', 'jorge')
t('nombre completo', 'JORGE DARIO LOPEZ ISANOA', 'jorge')
t('con tildes', 'la doctora Angélica Quintero por favor', 'angelica')
t('minúsculas sin tildes', 'con angelica', 'angelica')
t('dos nombres de pila', 'cita con juan diego', 'juandi')
t('apellido distintivo', 'con villegas', 'juandi')
t('Dra. + apellido', 'Dra. Grajales', 'lina')
t('nombre con ñ', 'con la dra montaño', 'angelica')

console.log('\nAmbigüedad → NO se pinea (default seguro):')
t('"juan" colisiona con Juan Londoño', 'quiero con juan', null)
t('"lopez" colisiona Jorge/José', 'con el doctor lopez', null)
t('"daniela" colisiona Daniela/Jazmin', 'con daniela', null)
t('dos médicos en un mensaje = pregunta', '¿atiende Jorge o Juan Diego?', null)
t('sin médico', 'quiero una cita de ginecología para el martes', null)
t('vacío', '', null)
t('solo ruido', 'doctor', null)

console.log('\nNo confundir con el nombre de la PACIENTE:')
// La paciente presentándose NO es una elección de médico. Sin el filtro por
// nombre, un apellido compartido con un médico pinearía al equivocado.
function tp(label: string, texto: string, paciente: string, esperado: string | null) {
  const r = detectarMencionDeMedico(texto, DOCS, { nombrePaciente: paciente })
  const got = r?.doctor_id ?? null
  if (got === esperado) { console.log(`  ✅ ${label}`); ok++ }
  else { console.log(`  ❌ ${label}\n      texto="${texto}"\n      esperado=${esperado} · obtenido=${got}`); fail++ }
}
tp('paciente Lina Marcela se presenta', 'Lina Marcela Gallego Londoño', 'Lina Marcela Gallego Londoño', null)
tp('paciente APELLIDADA Villegas', 'Soy Marcela Villegas', 'Marcela Villegas', null)
tp('paciente APELLIDADA Quintero', 'Ana Quintero, cc 123', 'Ana Quintero', null)
tp('pero si pide OTRO médico, sí pinea', 'Soy Marcela Villegas y quiero con isanoa', 'Marcela Villegas', 'jorge')

console.log('\nÍndice: alias ambiguos descartados')
const idx = construirIndice(DOCS)
for (const a of ['juan', 'lopez', 'daniela', 'maria', 'jorge', 'isanoa', 'villegas']) {
  console.log(`  "${a}" → ${idx.get(a)?.id ?? '(descartado)'}`)
}

console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
