/** Run: TZ=America/Bogota npx tsx scripts/test-proximas-fechas.ts */
import { proximasFechasQueAtiende } from '@/lib/calendar/schedule-check'
let ok = 0, fail = 0
const t = (l: string, got: string, exp: string) => {
  if (got === exp) { console.log(`  ✅ ${l}`); ok++ }
  else { console.log(`  ❌ ${l}\n      esperaba: ${exp}\n      obtuvo  : ${got}`); fail++ }
}
const b = (s: string, e: string) => ({ active: true, blocks: [{ start: s, end: e }] })
const off = { active: false, blocks: [] }
const jorge = { monday: b('07:30','11:00'), tuesday: off, wednesday: b('07:30','11:00'),
                thursday: off, friday: b('07:30','11:00'), saturday: off, sunday: off }

// El caso real: preguntó por el jueves 20/08/2026
const r = proximasFechasQueAtiende(jorge, '2026-08-20', 3)
t('próximas 3 desde el jueves 20/08',
  r.map((x) => x.texto).join(' · '),
  'viernes 21 de agosto · lunes 24 de agosto · miércoles 26 de agosto')
console.log(`     el agente había dicho: "lunes 19, miércoles 21 o viernes 22"`)
console.log(`     (19=miércoles, 21=viernes, 22=sábado — los tres mal)`)

t('las fechas ISO son correctas', r.map((x) => x.fecha).join(','), '2026-08-21,2026-08-24,2026-08-26')
t('no devuelve el mismo día que se pidió', r.some((x) => x.fecha === '2026-08-20') ? 'sí' : 'no', 'no')
t('sin días activos → vacío', String(proximasFechasQueAtiende({ monday: off }, '2026-08-20').length), '0')
t('working_hours nulo → vacío', String(proximasFechasQueAtiende(null, '2026-08-20').length), '0')
t('fecha inválida → vacío', String(proximasFechasQueAtiende(jorge, 'no-es-fecha').length), '0')

// Cruce de mes
const soloDomingo = { sunday: b('08:00','12:00') }
t('cruza fin de mes', proximasFechasQueAtiende(soloDomingo, '2026-08-28', 2).map((x) => x.texto).join(' · '),
  'domingo 30 de agosto · domingo 6 de septiembre')

console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
