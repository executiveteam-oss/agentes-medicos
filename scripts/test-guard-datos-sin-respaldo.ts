/** Guard 6. Incluye los 6 falsos positivos que identifiqué ANTES de aplicarlo.
 *  Run: npx tsx scripts/test-guard-datos-sin-respaldo.ts */
import { detectDatosSinRespaldo } from '@/lib/whatsapp/agent-guards'
let ok = 0, fail = 0
const H = (p: Partial<Parameters<typeof detectDatosSinRespaldo>[0]['hechos']> = {}) =>
  ({ diasQueAtiende: [], fechasDeTools: [], minutosDeSlots: [], huboSlots: false, ...p })
const t = (l: string, texto: string, hechos: ReturnType<typeof H> | null, debeBloquear: boolean) => {
  const r = detectDatosSinRespaldo({ agentText: texto, hechos, anioRef: 2026 })
  if (r.blocked === debeBloquear) { console.log(`  ✅ ${l}${r.blocked ? ` → ${r.reason}` : ''}`); ok++ }
  else { console.log(`  ❌ ${l} — esperaba blocked=${debeBloquear}, dio ${r.blocked} ${JSON.stringify(r.details ?? {})}`); fail++ }
}
const DIAS_JORGE = H({ diasQueAtiende: ['lunes, miércoles y viernes de 07:30 a 11:00'] })

console.log('CHEQUEO 1 — fecha ↔ día (duro):')
t('el caso real: "lunes 19, miércoles 21 o viernes 22"',
  'Te propongo lunes 19 de agosto, miércoles 21 de agosto o viernes 22 de agosto.', DIAS_JORGE, true)
t('fecha correcta pasa', 'Tu cita es el miércoles 19 de agosto a las 8:30.', H(), false)
t('fecha inexistente (31 de febrero)', 'Te espero el lunes 31 de febrero.', H(), true)
t('sin día nombrado → no se valida', 'Tu cita es el 19 de agosto.', H(), false)
t('año que viene: "5 de enero" es lunes en 2026', 'Nos vemos el lunes 5 de enero.', H(), false)

console.log('\nCHEQUEO 2 — días afirmados (duro, solo positivos):')
t('el caso real: inventa martes y sábado',
  'El Dr. Jorge no atiende los jueves. Atiende lunes, martes, miércoles, viernes y sábado.', DIAS_JORGE, true)
t('dice los correctos', 'El Dr. Jorge atiende lunes, miércoles y viernes de 7:30 a 11:00.', DIAS_JORGE, false)
t('NEGACIÓN no cuenta', 'El Dr. Jorge no atiende los martes ni los jueves.', DIAS_JORGE, false)
t('sin datos de tool → no opina', 'Atiende lunes y sábado.', H(), false)

console.log('\nCHEQUEO 3 — horas (ACOTADO) y los 6 falsos positivos:')
const SLOTS = H({ huboSlots: true, minutosDeSlots: [8*60+30, 9*60, 9*60+30] })
t('ofrece una hora que no existe', 'Tengo 8:30, 9:00 y 11:45 AM. ¿Cuál preferís?', SLOTS, true)
t('ofrece solo horas reales', 'Tengo 8:30, 9:00 y 9:30 AM. ¿Cuál preferís?', SLOTS, false)
t('FP1 — rango de horario, no cupos', 'El Dr. Jorge atiende lunes, miércoles y viernes de 07:30 a 11:00.', DIAS_JORGE, false)
t('FP2 — confirma cita ya creada (sin slots)', 'Tu cita quedó confirmada a las 8:15 AM.', H(), false)
t('FP3 — recuerda cita existente (sin slots)', 'Tenés cita el martes a las 2:00 PM con la Dra. Angélica.', H(), false)
t('FP4 — horario del consultorio', 'Atendemos de 7:00 a 20:00 todos los días hábiles.', H(), false)
t('FP5 — mismo cupo, otro formato', 'Tengo 8:30 de la mañana y 9:00 de la mañana. ¿Cuál te sirve?', SLOTS, false)
t('FP6 — línea de crisis', 'Si estás en peligro llamá al 123 o a la línea 106.', H(), false)
t('una sola hora sin oferta → no opina', 'Te espero a las 11:45.', SLOTS, false)

console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
