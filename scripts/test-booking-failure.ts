/**
 * Tests — bug #4: distinguir falla DURA de agendamiento (escala) de regla de
 * negocio (el LLM la explica). Run: npx tsx scripts/test-booking-failure.ts
 */
import { isHardBookingFailure } from '../src/agents/booking-failure'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — isHardBookingFailure\n')

const SLOT = 'SLOT_JUST_TAKEN — Ese horario se acaba de ocupar... check_availability...'

// DURAS → escalan
assert('create + SLOT_JUST_TAKEN → dura (escala)', isHardBookingFailure('create_appointment', SLOT))
assert('create + BLOCKED_BY_SCHEDULE → dura', isHardBookingFailure('create_appointment', 'BLOCKED_BY_SCHEDULE'))
assert('reschedule + SLOT_JUST_TAKEN → dura', isHardBookingFailure('reschedule_appointment', SLOT))
assert('reschedule + BLOCKED_BY_SCHEDULE → dura', isHardBookingFailure('reschedule_appointment', 'BLOCKED_BY_SCHEDULE'))

// 🔴 EL CASO DE 2026-08-11: la clínica bloqueó un viernes y el agente decía
// "tuve un inconveniente técnico" + escalaba, por un día cerrado a propósito.
// BLOCKED_BY_DATE es información de negocio: el agente ofrece otra fecha.
assert('🔴 create + BLOCKED_BY_DATE → NO es dura (el agente ofrece otra fecha)',
  !isHardBookingFailure('create_appointment', 'BLOCKED_BY_DATE'))
assert('🔴 reschedule + BLOCKED_BY_DATE → NO es dura',
  !isHardBookingFailure('reschedule_appointment', 'BLOCKED_BY_DATE'))

// …Y LOS OTROS TRES CASOS DE BLOCKED_BY_SCHEDULE SIGUEN ESCALANDO.
// Es la mitad del cambio que importa: fecha pasada, agenda cerrada y fuera de
// franja son el modelo pidiendo algo que no debía, y eso sí amerita que una
// persona mire. Si alguien "simplifica" sacando BLOCKED_BY_SCHEDULE entero de
// isHardBookingFailure, estos tres se caen con él.
assert('in_the_past sigue siendo dura', isHardBookingFailure('create_appointment', 'BLOCKED_BY_SCHEDULE'))
assert('BLOCKED_BY_DATE no matchea BLOCKED_BY_SCHEDULE por prefijo',
  !isHardBookingFailure('create_appointment', 'BLOCKED_BY_DAT'))

// REGLAS de negocio → NO escalan (el LLM las explica)
assert('BLOCKED_BY_AGE_RECHAZAR → NO es dura', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_AGE_RECHAZAR'))
assert('BLOCKED_BY_AGE_UNKNOWN → NO', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_AGE_UNKNOWN'))
assert('BLOCKED_CONDITION_NOT_ASKED → NO', !isHardBookingFailure('create_appointment', 'BLOCKED_CONDITION_NOT_ASKED'))
assert('BLOCKED_BY_CONDITION_DERIVAR → NO', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_CONDITION_DERIVAR'))
assert('BLOCKED_BY_RULE_ESCALATE_HUMAN → NO (ya escala por su cuenta)', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_RULE_ESCALATE_HUMAN'))
assert('BLOCKED_BY_AUTH_PENDING → NO', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_AUTH_PENDING'))

// Otras tools nunca son falla dura de agendamiento
assert('check_availability + SLOT → NO (no es create/reschedule)', !isHardBookingFailure('check_availability', SLOT))
assert('cancel_appointment + BLOCKED_BY_SCHEDULE → NO (cancelar no agenda)', !isHardBookingFailure('cancel_appointment', 'BLOCKED_BY_SCHEDULE'))

// Bordes
assert('create + error null → NO', !isHardBookingFailure('create_appointment', null))
assert('create + error vacío → NO', !isHardBookingFailure('create_appointment', ''))
assert('BLOCKED_BY_SCHEDULE_OTRA_COSA no matchea AGE por prefijo', !isHardBookingFailure('create_appointment', 'BLOCKED_BY_AGE'))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
