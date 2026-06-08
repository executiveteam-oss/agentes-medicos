import ExcelJS from 'exceljs'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { generateRes256Xlsx } from '../src/lib/reports/resolucion-256/xlsx-generator'
import type { Res256ReportResult, Res256Row } from '../src/lib/reports/resolucion-256/types'
import { PISIS_COLUMN_HEADERS } from '../src/lib/reports/resolucion-256/column-mapping'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

const ready: Res256Row = {
  identificacion: 'CC', numero: '12345', fecha_nacimiento: '1990-01-01', genero: 'F',
  primer_nombre: 'Ana', segundo_nombre: '', primer_apellido: 'Pérez', segundo_apellido: '',
  codigo_eapb: 'EPS037', fecha_solicitud_cita: '2026-06-01',
  fecha_asignacion: '2026-06-15', fecha_deseada: '2026-06-15',
}
const incomplete: Res256Row = { ...ready, identificacion: '', numero: '', codigo_eapb: '' }

const report: Res256ReportResult = {
  ready: [ready, ready, ready],
  incomplete: [{ row: incomplete, missingFields: ['identificacion', 'numero', 'codigo_eapb'] }],
  fromDate: '2026-01-01', toDate: '2026-06-30',
  generatedAt: new Date().toISOString(),
}

console.log('Tests xlsx generator\n')

const tmpFile = `/tmp/test-res256-${Date.now()}.xlsx`

async function main() {
  const buffer = await generateRes256Xlsx(report)
  assert('Buffer no vacío', buffer.byteLength > 1000)
  writeFileSync(tmpFile, buffer)
  assert('Archivo escrito', existsSync(tmpFile))

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(tmpFile)

  // Hoja "Listas para PISIS"
  const ready_sheet = wb.getWorksheet('Listas para PISIS')
  assert('Hoja "Listas para PISIS" existe', !!ready_sheet)
  if (ready_sheet) {
    assert('Hoja Listas: 12 columnas', ready_sheet.columnCount === 12)
    assert('Hoja Listas: header row 1 igual a PISIS_COLUMN_HEADERS', JSON.stringify((ready_sheet.getRow(1).values as unknown[]).slice(1)) === JSON.stringify(PISIS_COLUMN_HEADERS))
    assert('Hoja Listas: 3 filas de datos (rows 2-4)', ready_sheet.rowCount === 4)
    assert('Hoja Listas A2 = "CC"', ready_sheet.getCell('A2').value === 'CC')
    assert('Hoja Listas I2 = "EPS037"', ready_sheet.getCell('I2').value === 'EPS037')
  }

  // Hoja "Incompletas"
  const incomplete_sheet = wb.getWorksheet('Incompletas')
  assert('Hoja "Incompletas" existe', !!incomplete_sheet)
  if (incomplete_sheet) {
    assert('Hoja Incompletas: 13 columnas (12 + Faltantes)', incomplete_sheet.columnCount === 13)
    assert('Hoja Incompletas: header termina con "FALTANTES"', incomplete_sheet.getCell('M1').value === 'FALTANTES')
    assert('Hoja Incompletas: 1 fila datos', incomplete_sheet.rowCount === 2)
    assert('Hoja Incompletas M2 lista campos faltantes', String(incomplete_sheet.getCell('M2').value).includes('identificacion'))
  }

  unlinkSync(tmpFile)
  console.log(`\n${passed} pasaron · ${failed} fallaron`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
