/**
 * Tests para src/lib/utils/whatsapp-url.ts
 * Run: npx tsx scripts/test-whatsapp-url.ts
 */

import { isValidColombianMobile, buildWhatsAppUrl } from '../src/lib/utils/whatsapp-url'

let pass = 0
let fail = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    pass++
  } catch (err) {
    console.log(`  ❌ ${name}`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    fail++
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

console.log('isValidColombianMobile')

test('+57NNNNNNNNNN celular canónico → true', () => {
  assert(isValidColombianMobile('+573101234567') === true, 'esperado true')
})

test('573101234567 (sin +) → true (normalizePhone lo arregla)', () => {
  assert(isValidColombianMobile('573101234567') === true, 'esperado true')
})

test('3101234567 (10 dígitos) → true', () => {
  assert(isValidColombianMobile('3101234567') === true, 'esperado true')
})

test('con espacios "+57 310 123 4567" → true', () => {
  assert(isValidColombianMobile('+57 310 123 4567') === true, 'esperado true')
})

test('con guiones "+57-310-1234567" → true', () => {
  assert(isValidColombianMobile('+57-310-1234567') === true, 'esperado true')
})

test('null → false', () => {
  assert(isValidColombianMobile(null) === false, 'esperado false')
})

test('undefined → false', () => {
  assert(isValidColombianMobile(undefined) === false, 'esperado false')
})

test('string vacío → false', () => {
  assert(isValidColombianMobile('') === false, 'esperado false')
})

test('fijo bogotano "+57 1 3456789" (empieza con 1) → false', () => {
  assert(isValidColombianMobile('+5713456789') === false, 'fijo no es celular')
})

test('celular otro país "+521234567890" → false', () => {
  // MX empieza con 52, no 57. Post-normalizePhone da +521234567890 (12 digits pero no +573)
  assert(isValidColombianMobile('+521234567890') === false, 'no colombiano')
})

test('demasiado corto "+57310" → false', () => {
  assert(isValidColombianMobile('+57310') === false, 'faltan dígitos')
})

test('demasiado largo "+573101234567890" → false', () => {
  assert(isValidColombianMobile('+573101234567890') === false, 'sobran dígitos')
})

test('con letras "310ABCDEFG" → false', () => {
  // normalizePhone quita no-dígitos → queda "310" que es corto
  assert(isValidColombianMobile('310ABCDEFG') === false, 'sin dígitos válidos')
})

test('solo espacios "   " → false', () => {
  assert(isValidColombianMobile('   ') === false, 'trim → vacío')
})

console.log('\nbuildWhatsAppUrl')

test('URL correcta con mensaje simple', () => {
  const url = buildWhatsAppUrl('+573101234567', 'Hola')
  assert(url === 'https://wa.me/573101234567?text=Hola', `got: ${url}`)
})

test('URL usa 57 sin + en path', () => {
  const url = buildWhatsAppUrl('+573101234567', 'x')
  assert(url !== null && !url.includes('%2B'), '+ no debe ir url-encoded')
  assert(url !== null && !url.includes('wa.me/+'), '+ no debe ir literal')
  assert(url !== null && url.startsWith('https://wa.me/573'), 'debe empezar wa.me/573')
})

test('URL encodea acentos correctamente', () => {
  const url = buildWhatsAppUrl('+573101234567', 'Buen día María')
  assert(url === 'https://wa.me/573101234567?text=Buen%20d%C3%ADa%20Mar%C3%ADa', `got: ${url}`)
})

test('URL encodea saltos de línea', () => {
  const url = buildWhatsAppUrl('+573101234567', 'línea1\nlínea2')
  assert(url !== null && url.includes('%0A'), 'debe encodear \\n')
})

test('URL encodea emojis', () => {
  const url = buildWhatsAppUrl('+573101234567', 'hola 🔗')
  assert(url !== null && url.includes('%F0%9F%94%97'), 'emoji encoded')
})

test('URL encodea ?& que aparecerían en form_url embebido', () => {
  const url = buildWhatsAppUrl('+573101234567', 'https://forms.gle/x?a=1&b=2')
  assert(url !== null && url.includes('%3F') && url.includes('%26'), '?& deben ir encoded')
})

test('Phone inválido → null', () => {
  assert(buildWhatsAppUrl('inválido', 'x') === null, 'esperado null')
})

test('Phone vacío → null', () => {
  assert(buildWhatsAppUrl('', 'x') === null, 'esperado null')
})

test('Phone con solo 10 dígitos válidos → URL correcta', () => {
  const url = buildWhatsAppUrl('3101234567', 'x')
  assert(url === 'https://wa.me/573101234567?text=x', `got: ${url}`)
})

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
