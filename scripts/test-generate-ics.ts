// Tests — generador .ics (METHOD PUBLISH/CANCEL + título corto sin servicio/typo).
import { generateConfirmICS, generateCancelICS } from '../src/lib/calendar/generate-ics'

let ok = 0, fail = 0
function assert(name: string, cond: boolean) { if (cond) { ok++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

const base = {
  appointmentId: 'apt-123',
  startsAt: '2026-08-10T15:00:00-05:00',
  endsAt: '2026-08-10T15:30:00-05:00',
  doctorName: 'JUAN DIEGO VILLEGAS ECHEVERRI',
  // Nombre crudo del catálogo con el typo real "OBSTERICIA":
  consultationType: 'CONSULTA GINECOLOGIA Y OBSTERICIA PRIMERA VEZ',
  clinicName: 'Algia',
  clinicAddress: 'Cra 1 #2-3',
  clinicCity: 'Pereira',
  sequence: 0,
}

function summaryLine(ics: string): string {
  return ics.split('\r\n').find((l) => l.startsWith('SUMMARY:')) ?? ''
}

console.log('Confirmar → METHOD:PUBLISH + título corto\n')
const confirm = generateConfirmICS(base)
assert('confirmar usa METHOD:PUBLISH', confirm.includes('METHOD:PUBLISH'))
assert('confirmar NO usa METHOD:REQUEST', !confirm.includes('METHOD:REQUEST'))
assert('STATUS:CONFIRMED presente', confirm.includes('STATUS:CONFIRMED'))
const cSum = summaryLine(confirm)
assert('título = "Cita Algia — Juan Villegas"', cSum === 'SUMMARY:Cita Algia — Juan Villegas')
assert('título NO trae el nombre del servicio', !cSum.includes('GINECOLOGIA'))
assert('título NO trae el typo OBSTERICIA', !cSum.includes('OBSTERICIA'))
assert('el servicio SÍ queda en la DESCRIPTION', confirm.includes('OBSTERICIA'))

console.log('\nCancelar → METHOD:CANCEL (borra el evento)\n')
const cancel = generateCancelICS(base)
assert('cancelar usa METHOD:CANCEL', cancel.includes('METHOD:CANCEL'))
assert('cancelar NO usa PUBLISH', !cancel.includes('METHOD:PUBLISH'))
assert('STATUS:CANCELLED presente', cancel.includes('STATUS:CANCELLED'))
assert('título cancelado = "CANCELADA: Cita Algia — Juan Villegas"', summaryLine(cancel) === 'SUMMARY:CANCELADA: Cita Algia — Juan Villegas')

console.log('\nTítulo corto — nombres de distinto largo\n')
assert('4 tokens → primer nombre + primer apellido',
  summaryLine(generateConfirmICS({ ...base, doctorName: 'LINA MARIA GRAJALES MARULANDA' })) === 'SUMMARY:Cita Algia — Lina Grajales')
assert('3 tokens → nombre + apellido',
  summaryLine(generateConfirmICS({ ...base, doctorName: 'MARIA GOMEZ LOPEZ' })) === 'SUMMARY:Cita Algia — Maria Gomez')
assert('1 token → tal cual, Title Case',
  summaryLine(generateConfirmICS({ ...base, doctorName: 'HOUSE' })) === 'SUMMARY:Cita Algia — House')

console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
if (fail > 0) process.exit(1)
