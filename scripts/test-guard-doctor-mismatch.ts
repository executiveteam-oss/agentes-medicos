/**
 * Test del GUARD 5 con los TEXTOS REALES de los dos casos del 2026-08-17.
 * Función pura — sin DB ni red.
 * Run: npx tsx scripts/test-guard-doctor-mismatch.ts
 */
import { detectDoctorNameMismatch } from '@/lib/whatsapp/agent-guards'

const DOCS = [
  { id: 'lina',     name: 'LINA MARIA GRAJALES MARULANDA' },
  { id: 'jorge',    name: 'JORGE DARIO LOPEZ ISANOA' },
  { id: 'daniela',  name: 'DANIELA  OSORIO POSADA' },
  { id: 'angelica', name: 'ANGELICA  MARIA QUINTERO MONTAÑO' },
  { id: 'jazmin',   name: 'JAZMIN DANIELA GOMEZ  RAMIREZ' },
  { id: 'juandi',   name: 'JUAN DIEGO VILLEGAS ECHEVERRI' },
  { id: 'adriana',  name: 'ADRIANA  ESTEVEZ DURAN' },
]

let ok = 0, fail = 0
function t(label: string, args: Parameters<typeof detectDoctorNameMismatch>[0], esperaBloqueo: boolean) {
  const r = detectDoctorNameMismatch(args)
  if (r.blocked === esperaBloqueo) {
    console.log(`  ✅ ${label}${r.blocked ? ` → prometido=${(r.details as {prometido?:string})?.prometido} agendado=${(r.details as {agendado?:string})?.agendado}` : ''}`)
    ok++
  } else {
    console.log(`  ❌ ${label} — esperaba blocked=${esperaBloqueo}, obtuvo ${r.blocked}`)
    fail++
  }
}

console.log('CASOS REALES del 2026-08-17 (deben BLOQUEAR):')
t('Lina Marcela — prometió Jorge, agendó Juan Diego', {
  agentText: '✅ Cita confirmada con Dr. Juan Diego Villegas Echeverri\n📅 Miércoles 19 de agosto de 2026 a las 8:15 AM',
  priorAgentTexts: [
    'Perfecto, Lina. Déjame confirmar los detalles de tu cita:\n\n✅ Doctor: Dr. Jorge Dario López Isanoa\n✅ Servicio: Consulta de control o seguimiento por ginecología\n📅 Miércoles 19 de agosto de 2026 a las 8:15 AM',
  ],
  appointmentDoctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI',
  doctors: DOCS, patientName: 'Lina Marcela Gallego Londoño',
}, true)

t('Luisa — prometió Jorge, agendó Juan Diego', {
  agentText: '✅ Cita confirmada con el Dr. Juan Diego Villegas Echeverri\n📅 Martes 18 de agosto de 2026 a las 2:00 PM\n💰 Costo: $46.100 COP',
  priorAgentTexts: [
    'Excelente, Luisa. Déjame confirmar tu cita:\n\n✅ Consulta de primera vez en ginecología con el Dr. Jorge Dario López Isanoa\n📅 Martes 18 de agosto de 2026 a las 2:00 PM',
  ],
  appointmentDoctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI',
  doctors: DOCS, patientName: 'Luisa María García Montes',
}, false === false ? true : true)

console.log('\nCASOS SANOS (NO deben bloquear):')
t('coincide: prometió y agendó Angélica', {
  agentText: '✅ Cita confirmada con la Dra. Angélica María Quintero\n📅 Martes 18 a las 2:45 PM',
  priorAgentTexts: ['Perfecto. Déjame confirmar los detalles:\n\n✅ Control o seguimiento con la Dra. Angélica María Quintero'],
  appointmentDoctorName: 'ANGELICA  MARIA QUINTERO MONTAÑO', doctors: DOCS,
}, false)

t('menú de médicos NO es promesa', {
  agentText: '✅ Cita confirmada con Dr. Juan Diego Villegas Echeverri',
  priorAgentTexts: ['Listo. Para control o seguimiento tengo varios doctores disponibles. ¿Con cuál te gustaría reagendar?\n1. Dra. Angélica María Quintero\n2. Dr. Juan Diego Villegas\n3. El que tenga primer horario'],
  appointmentDoctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI', doctors: DOCS,
}, false)

t('cambio NEGOCIADO (caso Katheryne, nombra a los dos)', {
  agentText: '✅ Consulta de primera vez en ginecología con Dr. Juan Diego Villegas Echeverri\n📅 Sábado 15 de agosto a las 8:00 AM',
  priorAgentTexts: ['Listo. Voy a revisar disponibilidad con la Dra. Angelica Maria Quintero Montaño y el Dr. Juan Diego Villegas Echeverri para viernes a partir de las 2 PM y sábados en la mañana. Excelente noticia. El Dr. Juan Diego Villegas Echeverri atiende viernes y sábado'],
  appointmentDoctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI', doctors: DOCS,
}, false)

t('sin appointmentData → no aplica (lo cubre el guard 4)', {
  agentText: '✅ Cita confirmada con el Dr. Jorge Darío',
  priorAgentTexts: [], appointmentDoctorName: null, doctors: DOCS,
}, false)

t('nadie nombrado en el texto', {
  agentText: '✅ Tu cita quedó confirmada para el martes a las 3:00 PM.',
  priorAgentTexts: ['Perfecto, te confirmo el horario.'],
  appointmentDoctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI', doctors: DOCS,
}, false)

console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
