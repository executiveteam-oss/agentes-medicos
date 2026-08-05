// scripts/test-crisis-survives-inbox-actions.ts
// Invariante del rediseño de bandeja: NINGUNA de las acciones de "atender"
// (responder, atender-yo, devolver-al-agente, resuelta) puede apagar la
// alerta 🆘 de crisis. Se garantiza porque TODAS limpian notificaciones
// exclusivamente vía resolveEscalationNotifications, que solo toca
// 'conversation_escalated' (nunca 'crisis_detected' ni 'data_rights_request').
// Este test blinda esa garantía a nivel de fuente: si alguien agrega un
// .delete()/.update() directo sobre staff_notifications en conversations.ts,
// o mete crisis_detected en la constante, el test falla.
import { readFileSync } from 'fs'
import { join } from 'path'
import { ALERTS_CLEARED_ON_ATTEND } from '../src/lib/notifications/escalation-notify'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — la 🆘 de crisis sobrevive a las acciones de bandeja\n')

// --- 1. La constante nunca puede limpiar crisis ni ARCO ---
const set = ALERTS_CLEARED_ON_ATTEND as readonly string[]
assert('ALERTS_CLEARED_ON_ATTEND NO incluye crisis_detected', !set.includes('crisis_detected'))
assert('ALERTS_CLEARED_ON_ATTEND NO incluye data_rights_request', !set.includes('data_rights_request'))
assert('ALERTS_CLEARED_ON_ATTEND = exactamente [conversation_escalated]',
  set.length === 1 && set[0] === 'conversation_escalated')

// --- 2. conversations.ts limpia notificaciones SOLO vía el helper crisis-safe ---
const src = readFileSync(join(__dirname, '../src/app/actions/conversations.ts'), 'utf8')

// Ninguna escritura directa a staff_notifications (que podría tocar la 🆘).
// El único camino permitido es resolveEscalationNotifications.
assert('conversations.ts NO escribe directo sobre staff_notifications',
  !/\.from\(['"]staff_notifications['"]\)/.test(src),
  'usar resolveEscalationNotifications, no tocar la tabla directo')

// Cada acción de atender que cierra alertas usa el helper crisis-safe.
const ATTEND_ACTIONS = [
  'sendStaffMessage',          // responder = atender (punto 1)
  'takeOverConversation',      // atender yo (Eje A)
  'returnConversationToAgent', // que siga el agente (Eje A)
  'setConversationTriageState',// resuelta (Eje B)
]
for (const fn of ATTEND_ACTIONS) {
  const start = src.indexOf(`export async function ${fn}`)
  assert(`${fn} existe en conversations.ts`, start >= 0)
  if (start < 0) continue
  // cuerpo aproximado hasta el próximo export
  const next = src.indexOf('\nexport async function ', start + 1)
  const body = src.slice(start, next < 0 ? undefined : next)
  const clearsNotifs = body.includes('resolveEscalationNotifications')
  assert(`${fn} limpia alertas SOLO vía resolveEscalationNotifications (crisis-safe)`,
    clearsNotifs, 'debe delegar en el helper que preserva la 🆘')
}

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail > 0 ? 1 : 0)
