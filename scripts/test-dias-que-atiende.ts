/** Test puro. Run: npx tsx scripts/test-dias-que-atiende.ts */
import { diasQueAtiende, fraseDiasQueAtiende } from '@/lib/calendar/schedule-check'
let ok = 0, fail = 0
const t = (l: string, got: string, exp: string) => {
  if (got === exp) { console.log(`  ✅ ${l}`); ok++ }
  else { console.log(`  ❌ ${l}\n      esperaba: "${exp}"\n      obtuvo  : "${got}"`); fail++ }
}
const b = (s: string, e: string) => ({ active: true, blocks: [{ start: s, end: e }] })
const off = { active: false, blocks: [] }

// El caso real: Jorge Darío
const jorge = { monday: b('07:30','11:00'), tuesday: off, wednesday: b('07:30','11:00'),
                thursday: off, friday: b('07:30','11:00'), saturday: off, sunday: off }
t('Jorge Darío (el caso que se inventó)', fraseDiasQueAtiende(jorge), 'lunes, miércoles y viernes de 07:30 a 11:00')
console.log(`     el agente había dicho: "lunes, martes, miércoles, viernes y sábado"`)

// Juan Diego: rangos distintos por día
const juandi = { monday: off, tuesday: { active: true, blocks: [{start:'10:00',end:'11:00'},{start:'13:00',end:'15:00'}] },
                 wednesday: b('07:00','11:00'), thursday: { active: true, blocks: [{start:'10:00',end:'11:00'},{start:'13:00',end:'15:00'}] },
                 friday: b('10:00','11:00'), saturday: off, sunday: off }
t('rangos distintos → se detallan', fraseDiasQueAtiende(juandi),
  'martes de 10:00 a 15:00, miércoles de 07:00 a 11:00, jueves de 10:00 a 15:00, viernes de 10:00 a 11:00')

t('un solo día', fraseDiasQueAtiende({ thursday: b('08:00','12:00') }), 'jueves de 08:00 a 12:00')
t('dos días', fraseDiasQueAtiende({ monday: b('08:00','12:00'), friday: b('08:00','12:00') }), 'lunes y viernes de 08:00 a 12:00')
t('ninguno activo', fraseDiasQueAtiende({ monday: off }), '')
t('working_hours nulo', fraseDiasQueAtiende(null), '')
t('active true pero sin bloques', fraseDiasQueAtiende({ monday: { active: true, blocks: [] } }), '')

console.log('\n  orden: lunes primero, domingo último')
t('domingo va al final', fraseDiasQueAtiende({ sunday: b('08:00','12:00'), monday: b('08:00','12:00') }),
  'lunes y domingo de 08:00 a 12:00')
console.log(`\n  diasQueAtiende(jorge) = ${JSON.stringify(diasQueAtiende(jorge))}`)
console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
