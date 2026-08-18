/**
 * Tests — precedencia del webhook: Capa 0 SIEMPRE antes que la desambiguación.
 * Run: npx tsx scripts/test-webhook-action.ts
 */
import { decideWebhookAction } from '../src/lib/safety/webhook-action'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — decideWebhookAction (Capa 0 antes de desambiguación)\n')

// EL TEST QUE PEDISTE: crisis desde un número ambiguo → escala por crisis, NO pregunta identidad
assert('crisis + teléfono ambiguo → crisis (no disambiguate)',
  decideWebhookAction({ text: 'me quiero morir', crisisEnabled: true, phoneAmbiguous: true }) === 'crisis')

// Los otros detectores de Capa 0 también ganan sobre la desambiguación
assert('pedido de humano + ambiguo → human_request (no disambiguate)',
  decideWebhookAction({ text: 'quiero hablar con una persona', crisisEnabled: true, phoneAmbiguous: true }) === 'human_request')
assert('derecho ARCO + ambiguo → data_rights (no disambiguate)',
  decideWebhookAction({ text: 'quiero eliminar mis datos', crisisEnabled: true, phoneAmbiguous: true }) === 'data_rights')

// La desambiguación SOLO cuando ningún detector disparó y el teléfono es ambiguo
assert('mensaje normal + ambiguo → disambiguate',
  decideWebhookAction({ text: 'quiero una cita', crisisEnabled: true, phoneAmbiguous: true }) === 'disambiguate')
assert('mensaje normal + teléfono único → proceed',
  decideWebhookAction({ text: 'quiero una cita', crisisEnabled: true, phoneAmbiguous: false }) === 'proceed')

// Crisis apagada por config: no matchea crisis, pero human sí (crisisEnabled cubre ambos)
assert('crisis deshabilitada + texto de crisis + ambiguo → NO crisis, cae a disambiguate',
  decideWebhookAction({ text: 'me quiero morir', crisisEnabled: false, phoneAmbiguous: true }) === 'disambiguate')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
