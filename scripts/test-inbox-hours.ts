/** Horario de la bandeja — puro, sin DB. npx tsx scripts/test-inbox-hours.ts */
import { ventanaDeAtencion, coletillaDeContacto } from '@/lib/clinic/inbox-hours'

// El valor real de Algia: L–V 08:00–16:00, sábado y domingo apagados.
const ALGIA = {
  monday:{start:'08:00',end:'16:00',active:true}, tuesday:{start:'08:00',end:'16:00',active:true},
  wednesday:{start:'08:00',end:'16:00',active:true}, thursday:{start:'08:00',end:'16:00',active:true},
  friday:{start:'08:00',end:'16:00',active:true},
  saturday:{start:'08:00',end:'13:00',active:false}, sunday:{start:'08:00',end:'12:00',active:false},
}
/** Un instante COT como Date real (COT = UTC-5). */
const cot = (iso: string) => new Date(`${iso}-05:00`)
let mal = 0
function check(nombre: string, cuando: string, esperaDentro: boolean, esperaProxima: string | null) {
  const v = ventanaDeAtencion(ALGIA, cot(cuando))
  const ok = v.dentro === esperaDentro && v.proxima === esperaProxima
  if (!ok) mal++
  console.log(`${ok?'✅':'🔴'} ${nombre}`)
  console.log(`     dentro=${v.dentro}  próxima=${v.proxima ?? '—'}`)
  if (!ok) console.log(`     esperado: dentro=${esperaDentro} próxima=${esperaProxima ?? '—'}`)
}

// 2026-08-25 es LUNES · 08-22 SÁBADO · 08-23 DOMINGO
check('martes 10:00 — hay alguien',            '2026-08-25T10:00:00', true,  null)
check('🔴 sábado 08:21 — EL CASO REAL',        '2026-08-22T08:21:00', false, 'el lunes a partir de las 8:00 AM')
// El domingo "mañana" ES el lunes: decir "el lunes" sería más raro, no más preciso.
check('domingo 15:00',                          '2026-08-23T15:00:00', false, 'mañana a partir de las 8:00 AM')
check('viernes 16:30 — ya cerró',               '2026-08-21T16:30:00', false, 'el lunes a partir de las 8:00 AM')
check('viernes 07:30 — todavía no abre',        '2026-08-21T07:30:00', false, 'hoy a partir de las 8:00 AM')
check('jueves 15:59 — último minuto adentro',   '2026-08-27T15:59:00', true,  null)
check('jueves 16:00 — cerró en punto',          '2026-08-27T16:00:00', false, 'mañana a partir de las 8:00 AM')
check('lunes 08:00 — abre en punto',            '2026-08-24T08:00:00', true,  null)

console.log('\n── la coletilla ──')
for (const [q, w] of [['martes 10:00','2026-08-25T10:00:00'],['sábado 08:21','2026-08-22T08:21:00'],['domingo','2026-08-23T15:00:00']] as const) {
  const c = coletillaDeContacto(ALGIA, cot(w))
  console.log(`  ${q.padEnd(14)} → ${c === '' ? '(vacía: el mensaje queda como hoy)' : `"${c.trim()}"`}`)
}
console.log('\n── sin inbox_hours cargado (default seguro) ──')
const sin = ventanaDeAtencion(null, cot('2026-08-23T15:00:00'))
const okSin = sin.dentro === true
if (!okSin) mal++
console.log(`${okSin?'✅':'🔴'} domingo sin config → dentro=${sin.dentro} (se comporta como hoy, no inventa espera)`)
console.log(`\n${mal===0?'✅ todo bien':`🔴 ${mal} fallas`}`)
process.exit(mal?1:0)
