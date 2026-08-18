/** Test puro de esNumeroEnviable. Run: npx tsx scripts/test-numero-enviable.ts */
import { esNumeroEnviable } from '@/lib/utils/whatsapp-url'
let ok = 0, fail = 0
function t(label: string, phone: string | null, esperado: boolean) {
  const r = esNumeroEnviable(phone)
  if (r === esperado) { console.log(`  ✅ ${label}`); ok++ }
  else { console.log(`  ❌ ${label} — "${phone}" esperaba ${esperado}, dio ${r}`); fail++ }
}
console.log('El caso que motivó el chequeo:')
t('Centro Médico Bolívar (dice +57 y le faltan dígitos)', '+5730000000', false)
console.log('\nColombianos válidos (14.115 pacientes):')
t('celular con +57', '+573146152002', true)
t('sin +', '573146152002', true)
t('10 dígitos sueltos', '3146152002', true)
t('con espacios', '+57 314 615 2002', true)
console.log('\nExtranjeros REALES de Algia (no se deben cortar):')
for (const [p, d] of [['+16317023826','EE.UU.'],['+15189000000','EE.UU.'],['+50767000000','Panamá'],['+521810000000','México'],['+593990000000','Ecuador']] as const) {
  t(`${d} ${p}`, p, true)
}
console.log('\nBasura:')
t('vacío', '', false)
t('null', null, false)
t('fijo colombiano', '+5716012345', false)
t('demasiado corto', '+57312', false)
t('texto', 'no tengo', false)
console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
process.exit(fail === 0 ? 0 : 1)
