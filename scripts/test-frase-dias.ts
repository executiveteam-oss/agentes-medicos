/**
 * fraseDiasQueAtiende — la frase que leen la paciente Y el modelo.
 * La usan el prompt (doctorLines) y check_availability: una sola fuente.
 * Run: npx tsx scripts/test-frase-dias.ts
 */
import { fraseDiasQueAtiende, diasQueAtiende } from '@/lib/calendar/schedule-check'

const dia = (bloques: Array<[string, string]>) => ({ active: true, blocks: bloques.map(([start, end]) => ({ start, end })) })
const off = { active: false, blocks: [] }
let mal = 0
function check(nombre: string, wh: Record<string, unknown>, esperado: string) {
  const r = fraseDiasQueAtiende(wh)
  const ok = r === esperado
  if (!ok) { mal++; console.log(`🔴 ${nombre}\n     esperado: "${esperado}"\n     obtuvo  : "${r}"`) }
  else console.log(`✅ ${nombre}\n     "${r}"`)
}

// 🔴 EL BUG: un día partido salía "de 10:00 a 15:00", con el mediodía adentro.
check('un día con dos bloques',
  { monday: off, tuesday: dia([['10:00','11:00'],['13:00','15:00']]), wednesday: off, thursday: off, friday: off, saturday: off, sunday: off },
  'martes de 10:00 a 11:00 y de 13:00 a 15:00')

check('varios días, todos con los MISMOS dos bloques',
  { monday: dia([['08:30','11:30'],['13:15','16:15']]), tuesday: dia([['08:30','11:30'],['13:15','16:15']]),
    wednesday: off, thursday: off, friday: off, saturday: off, sunday: off },
  'lunes y martes de 08:30 a 11:30 y de 13:15 a 16:15')

check('varios días con el mismo rango simple (comportamiento de siempre)',
  { monday: dia([['07:30','11:00']]), tuesday: off, wednesday: dia([['07:30','11:00']]), thursday: off,
    friday: dia([['07:30','11:00']]), saturday: off, sunday: off },
  'lunes, miércoles y viernes de 07:30 a 11:00')

check('días con rangos distintos, ninguno partido → separador coma',
  { monday: dia([['07:30','12:00']]), tuesday: off, wednesday: dia([['07:30','11:00']]), thursday: off, friday: off, saturday: off, sunday: off },
  'lunes de 07:30 a 12:00, miércoles de 07:30 a 11:00')

// Con un día partido el separador entre días pasa a ";" — si no, el " y " de
// los bloques y el " y " de los días se confunden.
check('días distintos y uno partido → separador punto y coma',
  { monday: dia([['08:00','12:00']]), tuesday: dia([['10:00','11:00'],['13:00','15:00']]),
    wednesday: off, thursday: off, friday: off, saturday: off, sunday: off },
  'lunes de 08:00 a 12:00; martes de 10:00 a 11:00 y de 13:00 a 15:00')

check('tres bloques en un día', 
  { monday: dia([['07:00','09:00'],['10:00','11:00'],['14:00','16:00']]), tuesday: off, wednesday: off, thursday: off, friday: off, saturday: off, sunday: off },
  'lunes de 07:00 a 09:00, de 10:00 a 11:00 y de 14:00 a 16:00')

check('bloques desordenados se ordenan por hora',
  { monday: dia([['13:00','15:00'],['08:00','11:00']]), tuesday: off, wednesday: off, thursday: off, friday: off, saturday: off, sunday: off },
  'lunes de 08:00 a 11:00 y de 13:00 a 15:00')

check('no atiende ningún día', { monday: off, tuesday: off, wednesday: off, thursday: off, friday: off, saturday: off, sunday: off }, '')
console.log(`\nsin working_hours → "${fraseDiasQueAtiende(null)}"  ·  días: ${diasQueAtiende(null).length}`)
console.log(`\n${mal === 0 ? '✅ todo bien' : `🔴 ${mal} fallas`}`)
process.exit(mal ? 1 : 0)
