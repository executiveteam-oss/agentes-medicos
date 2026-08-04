// Tests — nombre de archivo de descarga de autorizaciones.
import { buildAuthorizationFilename } from '../src/lib/authorizations/download-filename'

let ok = 0, fail = 0
function eq(name: string, got: string, want: string) {
  if (got === want) { ok++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}\n       got:  ${got}\n       want: ${want}`) }
}

const base = { documentType: 'CC', documentNumber: '1234567890', patientName: 'Maria Perez Gomez', receivedAtIso: '2026-08-04T15:00:00-05:00' }

console.log('Formato base\n')
eq('CC + nombre + fecha recepción', buildAuthorizationFilename(base), 'CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.pdf')

console.log('\nNormalización (Windows-safe)\n')
eq('tildes y ñ', buildAuthorizationFilename({ ...base, patientName: 'José Muñoz Ñandú' }), 'CC1234567890_JOSE_MUNOZ_NANDU_2026-08-04.pdf')
eq('caracteres raros → _', buildAuthorizationFilename({ ...base, patientName: 'Ana/María (la del 3B)' }), 'CC1234567890_ANA_MARIA_LA_DEL_3B_2026-08-04.pdf')
eq('documento con puntos/espacios se limpia', buildAuthorizationFilename({ ...base, documentNumber: '1.234.567.890' }), 'CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.pdf')

console.log('\nFallbacks\n')
eq('sin documento → SINDOC', buildAuthorizationFilename({ ...base, documentNumber: null }), 'SINDOC_MARIA_PEREZ_GOMEZ_2026-08-04.pdf')
eq('sin nombre → SIN_NOMBRE', buildAuthorizationFilename({ ...base, patientName: null }), 'CC1234567890_SIN_NOMBRE_2026-08-04.pdf')
eq('otro tipo de doc (TI)', buildAuthorizationFilename({ ...base, documentType: 'TI' }), 'TI1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.pdf')
eq('fecha inválida → sin-fecha', buildAuthorizationFilename({ ...base, receivedAtIso: 'basura' }), 'CC1234567890_MARIA_PEREZ_GOMEZ_sin-fecha.pdf')

console.log('\nExtensión (fallback a imagen original)\n')
eq('ext heic (fallback)', buildAuthorizationFilename({ ...base, ext: 'heic' }), 'CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.heic')
eq('ext con punto se limpia', buildAuthorizationFilename({ ...base, ext: '.PNG' }), 'CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.png')

console.log('\nZona horaria — recepción cerca de medianoche UTC\n')
// 2026-08-05 02:00 UTC = 2026-08-04 21:00 COT → debe dar 2026-08-04
eq('UTC 02:00 → COT día anterior', buildAuthorizationFilename({ ...base, receivedAtIso: '2026-08-05T02:00:00Z' }), 'CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.pdf')

console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
if (fail > 0) process.exit(1)
