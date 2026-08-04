// Tests — ensamblador de descarga de autorizaciones (pdf-lib).
import { PDFDocument } from 'pdf-lib'
import { assembleAuthorizationPdf } from '../src/lib/authorizations/build-pdf'

let ok = 0, fail = 0
function assert(name: string, cond: boolean) { if (cond) { ok++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

// PNG 1×1 transparente real (base64).
const PNG_1x1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
))

async function main() {
  console.log('Imagen JPEG/PNG → PDF de 1 página\n')
  const r1 = await assembleAuthorizationPdf([{ bytes: PNG_1x1, mimeType: 'image/png' }])
  assert('PNG → kind pdf', r1.kind === 'pdf')
  assert('1 página', r1.kind === 'pdf' && r1.pages === 1)
  assert('bytes empiezan con %PDF', r1.kind === 'pdf' && Buffer.from(r1.bytes.slice(0, 4)).toString() === '%PDF')

  console.log('\nHEIC/WEBP único → fallback al original (kind raw, ext correcto)\n')
  const heicBytes = new Uint8Array([1, 2, 3, 4])
  const r2 = await assembleAuthorizationPdf([{ bytes: heicBytes, mimeType: 'image/heic' }])
  assert('HEIC solo → kind raw', r2.kind === 'raw')
  assert('ext heic', r2.kind === 'raw' && r2.ext === 'heic')
  assert('devuelve los bytes originales', r2.kind === 'raw' && r2.bytes === heicBytes)

  console.log('\nLote mixto (PNG + HEIC) → PDF con el PNG, HEIC saltado\n')
  const r3 = await assembleAuthorizationPdf([
    { bytes: PNG_1x1, mimeType: 'image/png' },
    { bytes: heicBytes, mimeType: 'image/heic' },
  ])
  assert('mixto → kind pdf', r3.kind === 'pdf')
  assert('1 página (PNG), HEIC no cuenta', r3.kind === 'pdf' && r3.pages === 1)
  assert('skipped = 1', r3.kind === 'pdf' && r3.skipped === 1)

  console.log('\nPDF entrante → se copian sus páginas (merge)\n')
  const srcDoc = await PDFDocument.create()
  srcDoc.addPage(); srcDoc.addPage() // 2 páginas
  const srcBytes = await srcDoc.save()
  const r4 = await assembleAuthorizationPdf([{ bytes: srcBytes, mimeType: 'application/pdf' }])
  assert('PDF → kind pdf', r4.kind === 'pdf')
  assert('conserva las 2 páginas', r4.kind === 'pdf' && r4.pages === 2)

  console.log('\nMulti-página: 2 imágenes → PDF de 2 páginas\n')
  const r5 = await assembleAuthorizationPdf([
    { bytes: PNG_1x1, mimeType: 'image/png' },
    { bytes: PNG_1x1, mimeType: 'image/png' },
  ])
  assert('2 imágenes → 2 páginas', r5.kind === 'pdf' && r5.pages === 2)

  console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
  if (fail > 0) process.exit(1)
}
main()
