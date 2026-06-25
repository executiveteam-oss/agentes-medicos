/**
 * Tests del schema Zod de PatientConditionConfig + evaluador.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-patient-condition-config.ts
 */

import {
  PatientConditionConfigSchema,
  evaluatePatientCondition,
  type PatientConditionConfig,
} from '../src/lib/rules/patient-condition-config'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tests PatientConditionConfig (schema + evaluate)')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n=== Schema válido: caso Algia "no gestantes" ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Estás embarazada actualmente?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
      verification_mode: 'trust',
    })
    assert('Acepta config completa (gestantes)', r.success)
  }

  console.log('\n=== Schema válido: trigger=no, action=rechazar ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Has cumplido 8 horas de ayuno?',
      trigger_answer: 'no',
      action_on_trigger: 'rechazar',
      verification_mode: 'trust',
    })
    assert('Acepta trigger=no + action=rechazar (ayuno)', r.success)
  }

  console.log('\n=== Schema: verification_mode default=trust ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Estás embarazada?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
    })
    assert('Default verification_mode = trust',
      r.success && r.data.verification_mode === 'trust',
      r.success ? `value: ${r.data.verification_mode}` : 'parse failed')
  }

  console.log('\n=== Schema inválido: pregunta muy corta ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿OK?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
    })
    assert('Rechaza pregunta < 5 chars', !r.success)
  }

  console.log('\n=== Schema inválido: pregunta muy larga (>200) ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿' + 'a'.repeat(205) + '?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
    })
    assert('Rechaza pregunta > 200 chars', !r.success)
  }

  console.log('\n=== Schema inválido: trigger_answer fuera de enum ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Cuántas semanas tienes?',
      trigger_answer: 'maybe' as never,
      action_on_trigger: 'derivar_humano',
    })
    assert('Rechaza trigger="maybe"', !r.success)
  }

  console.log('\n=== Schema inválido: verification_mode="verify" (no implementado) ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Estás embarazada?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
      verification_mode: 'verify' as never,
    })
    assert('Rechaza verification_mode=verify hoy', !r.success)
  }

  console.log('\n=== evaluatePatientCondition: respuesta apta (no dispara) ===')
  const gestantes: PatientConditionConfig = {
    question_type: 'yes_no',
    question: '¿Estás embarazada actualmente?',
    trigger_answer: 'yes',
    action_on_trigger: 'derivar_humano',
    verification_mode: 'trust',
  }
  {
    const r = evaluatePatientCondition('no', gestantes)
    assert('Respuesta NO con trigger=yes → outcome=apt',
      r.outcome === 'apt' && r.action === null)
  }

  console.log('\n=== evaluatePatientCondition: respuesta dispara ===')
  {
    const r = evaluatePatientCondition('yes', gestantes)
    assert('Respuesta YES con trigger=yes → outcome=triggered + derivar_humano',
      r.outcome === 'triggered' && r.action === 'derivar_humano')
  }

  console.log('\n=== evaluatePatientCondition: ambiguo siempre deriva ===')
  {
    const r = evaluatePatientCondition('ambiguous', gestantes)
    assert('Respuesta AMBIGUOUS → outcome=ambiguous + derivar_humano',
      r.outcome === 'ambiguous' && r.action === 'derivar_humano')
  }

  console.log('\n=== Caso ayuno (trigger=no, action=rechazar) ===')
  const ayuno: PatientConditionConfig = {
    question_type: 'yes_no',
    question: '¿Has cumplido 8 horas de ayuno?',
    trigger_answer: 'no',
    action_on_trigger: 'rechazar',
    verification_mode: 'trust',
  }
  {
    const r = evaluatePatientCondition('yes', ayuno)
    assert('SI ayunó (trigger=no) → apt', r.outcome === 'apt')
  }
  {
    const r = evaluatePatientCondition('no', ayuno)
    assert('NO ayunó (dispara) → triggered + rechazar',
      r.outcome === 'triggered' && r.action === 'rechazar')
  }
  {
    const r = evaluatePatientCondition('ambiguous', ayuno)
    assert('Ambigua sobre ayuno → ambiguous + derivar (no rechazar)',
      r.outcome === 'ambiguous' && r.action === 'derivar_humano',
      'safe default fuerza derivar incluso si action_on_trigger=rechazar')
  }

  // ====================================================
  // EXTENSIÓN multi-choice (2026-06-25). Cubrir retrocompat
  // + casos nuevos sin romper los anteriores.
  // ====================================================

  console.log('\n=== RETROCOMPAT: schema legacy SIN question_type → se parsea como yes_no ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question: '¿Estás embarazada?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
    })
    assert('Legacy (sin question_type) → válido', r.success)
    if (r.success) {
      assert('Se infiere question_type=yes_no', r.data.question_type === 'yes_no')
    }
  }

  console.log('\n=== Schema multi-choice válido: caso mapeo ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿El mapeo es por cuál de estas causas?',
      options: [
        { id: 'opt_1', label: 'Endometriosis',  action_if_chosen: 'continuar' },
        { id: 'opt_2', label: 'Miomas',         action_if_chosen: 'continuar' },
        { id: 'opt_3', label: 'Adenomiosis',    action_if_chosen: 'continuar' },
        { id: 'opt_4', label: 'Otras',          action_if_chosen: 'derivar_humano' },
      ],
    })
    assert('Multi-choice 4 opciones válido', r.success)
  }

  console.log('\n=== Schema multi-choice inválido: menos de 2 opciones ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿Cómo es?',
      options: [{ id: 'opt_1', label: 'Sola', action_if_chosen: 'continuar' }],
    })
    assert('Rechaza 1 sola opción', !r.success)
  }

  console.log('\n=== Schema multi-choice inválido: más de 6 opciones ===')
  {
    const opts = Array.from({ length: 7 }, (_, i) => ({
      id: `opt_${i + 1}`, label: `Opción ${i + 1}`, action_if_chosen: 'continuar' as const,
    }))
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿Mucho?',
      options: opts,
    })
    assert('Rechaza 7 opciones', !r.success)
  }

  console.log('\n=== Schema multi-choice inválido: sin "continuar" ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿Todo bloquea?',
      options: [
        { id: 'opt_1', label: 'A', action_if_chosen: 'derivar_humano' },
        { id: 'opt_2', label: 'B', action_if_chosen: 'rechazar' },
      ],
    })
    assert('Rechaza opciones sin "continuar"', !r.success)
  }

  console.log('\n=== Schema multi-choice inválido: ids duplicados ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿Mismo id?',
      options: [
        { id: 'x', label: 'A', action_if_chosen: 'continuar' },
        { id: 'x', label: 'B', action_if_chosen: 'derivar_humano' },
      ],
    })
    assert('Rechaza ids duplicados', !r.success)
  }

  console.log('\n=== Schema multi-choice inválido: labels duplicados (case-insensitive) ===')
  {
    const r = PatientConditionConfigSchema.safeParse({
      question_type: 'multiple_choice',
      question: '¿Mismo label?',
      options: [
        { id: 'opt_1', label: 'Miomas', action_if_chosen: 'continuar' },
        { id: 'opt_2', label: 'miomas', action_if_chosen: 'derivar_humano' },
      ],
    })
    assert('Rechaza labels duplicados (case-insensitive)', !r.success)
  }

  console.log('\n=== evaluate multi-choice ===')
  const mapeo: PatientConditionConfig = {
    question_type: 'multiple_choice',
    question: '¿El mapeo es por cuál de estas causas?',
    options: [
      { id: 'opt_1', label: 'Endometriosis', action_if_chosen: 'continuar' },
      { id: 'opt_2', label: 'Miomas',        action_if_chosen: 'continuar' },
      { id: 'opt_3', label: 'Adenomiosis',   action_if_chosen: 'continuar' },
      { id: 'opt_4', label: 'Otras',         action_if_chosen: 'derivar_humano' },
    ],
    verification_mode: 'trust',
  }
  {
    const r = evaluatePatientCondition('opt_1', mapeo)
    assert('Opt_1 (Endometriosis, continuar) → apt', r.outcome === 'apt' && r.action === null)
  }
  {
    const r = evaluatePatientCondition('opt_4', mapeo)
    assert('Opt_4 (Otras, derivar) → triggered + derivar_humano + label correcto',
      r.outcome === 'triggered' && r.action === 'derivar_humano' &&
      r.outcome === 'triggered' && r.option_label === 'Otras')
  }
  {
    const r = evaluatePatientCondition('ambiguous', mapeo)
    assert('ambiguous siempre deriva', r.outcome === 'ambiguous')
  }
  {
    const r = evaluatePatientCondition('opt_99', mapeo)
    assert('id inválido → invalid_option + derivar (safe default)',
      r.outcome === 'invalid_option' && r.action === 'derivar_humano')
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
