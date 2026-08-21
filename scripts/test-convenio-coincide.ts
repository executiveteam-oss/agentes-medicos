import { convenioCoincide } from '@/lib/rules/convenio-aliases'
const cargados = ['COLMEDICA','COLSANITAS','SURAMERICANA','ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A','MEDPLUS']
const casos: Array<[string, boolean]> = [
  ['SOS', true], ['sos', true], ['Colmedica', true], ['COLMÉDICA', false],
  ['Medplus', true], ['Sura', true], ['Coomeva', false], ['', false],
]
let mal = 0
for (const [dicho, esperado] of casos) {
  const r = cargados.some((c) => convenioCoincide(dicho, c))
  const ok = r === esperado
  if (!ok) mal++
  console.log(`${ok ? '✅' : '🔴'} "${dicho}" → ${r} (esperado ${esperado})`)
}
process.exit(mal ? 1 : 0)
