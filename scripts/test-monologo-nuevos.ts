/** Run: npx tsx scripts/test-monologo-nuevos.ts */
import { esMonologoInterno } from '@/lib/whatsapp/strip-internal-monologue'
let ok = 0, fail = 0
const t = (l: string, txt: string, esperado: boolean) => {
  const r = esMonologoInterno(txt)
  if (r === esperado) { console.log(`  ✅ ${l}`); ok++ }
  else { console.log(`  ❌ ${l} — esperaba ${esperado}, dio ${r}\n      "${txt.slice(0,80)}"`); fail++ }
}
console.log('El caso REAL que se filtró:')
t('narración del rechazo del pin',
  'Disculpa, acabo de verificar y veo que el Dr. Jorge Dario Lopez Isanoa está identificado en el sistema con otro ID. Déjame revisar sus horarios correctamente:', true)

console.log('\nOtras formas de lo mismo:')
t('"déjame revisar de nuevo"', 'Déjame revisar sus horarios de nuevo.', true)
t('"acabo de comprobar"', 'Acabo de comprobar el registro y hay un problema.', true)

console.log('\nNO debe bloquear texto legítimo:')
t('confirmación normal', 'Tu cita quedó confirmada para el miércoles 19 a las 8:30 AM.', false)
t('ofrece horarios', 'Para el miércoles tengo 8:30, 9:00 y 9:30 AM. ¿Cuál preferís?', false)
t('dice qué días atiende', 'El Dr. Jorge Dario atiende lunes, miércoles y viernes de 7:30 a 11:00.', false)
t('"déjame revisar" a secas (legítimo)', 'Dale, déjame revisar la disponibilidad.', false)
t('"verifico" sin sistema', 'Perfecto, verifico tu cita y te confirmo.', false)
t('menciona su documento', 'Tu documento quedó registrado correctamente.', false)
console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
