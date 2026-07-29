import { REJECT_REASONS, isRejectReasonKey, buildRejectPatientMessage } from '../src/lib/rules/reject-reasons'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — motivos de rechazo de autorización\n')

// keys válidas
assert('5 motivos definidos', REJECT_REASONS.length === 5)
assert('isRejectReasonKey acepta válida', isRejectReasonKey('vencida'))
assert('isRejectReasonKey rechaza inválida', !isRejectReasonKey('inventada'))

// textos amables — tuteo colombiano, sin voseo
const clinic = 'Algia'
const vencida = buildRejectPatientMessage('vencida', { clinicName: clinic })
assert('vencida menciona vencida + tuteo', /vencida/i.test(vencida) && /pídele|reenvíamela/i.test(vencida))
assert('ningún motivo usa voseo', ['vencida','mal_direccionada','ilegible','no_corresponde'].every((k) => {
  const t = buildRejectPatientMessage(k as 'vencida', { clinicName: clinic })
  return !/\b(podés|reenviá|reenviámela|pedile|verificá|puedés)\b/i.test(t)
}))

// mal_direccionada interpola la clínica
const mal = buildRejectPatientMessage('mal_direccionada', { clinicName: 'Clínica Algia' })
assert('mal_direccionada interpola nombre de clínica', mal.includes('Clínica Algia'))

// otra usa el texto libre
const otra = buildRejectPatientMessage('otra', { clinicName: clinic, freeText: '  Falta la firma del médico.  ' })
assert('otra usa freeText (trim)', otra === 'Falta la firma del médico.')
assert('otra sin freeText devuelve vacío', buildRejectPatientMessage('otra', { clinicName: clinic }) === '')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
