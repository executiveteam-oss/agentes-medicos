// scripts/test-escalation-notify.ts
import { buildEscalationPayload } from '../src/lib/notifications/escalation-notify'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests escalation-notify (builder puro)\n')

// Nombre presente → título con el nombre
{
  const p = buildEscalationPayload('Ana Gómez', 'quiero una cita urgente', 'conv-1')
  assert('type es conversation_escalated', p.type === 'conversation_escalated')
  assert('title incluye el nombre', p.title.includes('Ana Gómez'), p.title)
  assert('navigateTo apunta a la conversación', p.navigateTo === '/dashboard/conversations/conv-1', p.navigateTo)
  assert('body incluye el motivo', p.body.includes('quiero una cita urgente'), p.body)
}

// Sin nombre → fallback "Paciente nuevo"
{
  const p = buildEscalationPayload(null, 'hola', 'conv-2')
  assert('title usa "Paciente nuevo" si no hay nombre', p.title.includes('Paciente nuevo'), p.title)
}

// Motivo largo → body truncado a 120 chars + elipsis
{
  const longReason = 'x'.repeat(300)
  const p = buildEscalationPayload('Ana', longReason, 'conv-3')
  assert('body truncado a <= 123 chars (120 + "...")', p.body.length <= 123, `len=${p.body.length}`)
  assert('body termina en "..."', p.body.endsWith('...'), p.body.slice(-5))
}

// Motivo corto → sin elipsis
{
  const p = buildEscalationPayload('Ana', 'corto', 'conv-4')
  assert('body corto no lleva elipsis', !p.body.endsWith('...'), p.body)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
