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
