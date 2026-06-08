// ============================================================
// Genera Buffer xlsx con 2 hojas:
//   - "Listas para PISIS": 12 columnas, rows válidos
//   - "Incompletas": 12 cols + "FALTANTES" con los nombres de campos vacíos
//
// Encoding por defecto de exceljs es UTF-8.
// ============================================================

import ExcelJS from 'exceljs'
import type { Res256ReportResult, Res256Row } from './types'
import { PISIS_COLUMN_HEADERS, PISIS_COLUMNS_ORDER } from './column-mapping'

export async function generateRes256Xlsx(report: Res256ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Omuwan'
  wb.created = new Date()

  // Hoja 1: Listas
  const readySheet = wb.addWorksheet('Listas para PISIS')
  readySheet.columns = PISIS_COLUMNS_ORDER.map((key, i) => ({
    header: PISIS_COLUMN_HEADERS[i],
    key,
    width: 18,
  }))
  for (const row of report.ready) {
    readySheet.addRow(row as unknown as Record<string, string>)
  }
  // Style header
  readySheet.getRow(1).font = { bold: true }
  readySheet.getRow(1).alignment = { horizontal: 'center' }

  // Hoja 2: Incompletas
  const incompleteSheet = wb.addWorksheet('Incompletas')
  incompleteSheet.columns = [
    ...PISIS_COLUMNS_ORDER.map((key, i) => ({ header: PISIS_COLUMN_HEADERS[i], key, width: 18 })),
    { header: 'FALTANTES', key: 'faltantes', width: 40 },
  ]
  for (const item of report.incomplete) {
    incompleteSheet.addRow({
      ...item.row,
      faltantes: item.missingFields.join(', '),
    } as Record<string, unknown>)
  }
  incompleteSheet.getRow(1).font = { bold: true }
  incompleteSheet.getRow(1).alignment = { horizontal: 'center' }

  // Resaltar campos faltantes en rojo (fondo suave)
  const REQUIRED: Set<keyof Res256Row> = new Set([
    'identificacion',
    'numero',
    'fecha_nacimiento',
    'genero',
    'primer_nombre',
    'primer_apellido',
    'codigo_eapb',
    'fecha_solicitud_cita',
    'fecha_asignacion',
    'fecha_deseada',
  ])
  for (let i = 0; i < report.incomplete.length; i++) {
    const rowNum = i + 2
    const row = report.incomplete[i].row
    for (let j = 0; j < PISIS_COLUMNS_ORDER.length; j++) {
      const key = PISIS_COLUMNS_ORDER[j]
      const isEmpty = !row[key] || row[key].trim() === ''
      if (isEmpty && REQUIRED.has(key)) {
        incompleteSheet.getRow(rowNum).getCell(j + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' },
        }
      }
    }
  }

  const ab = await wb.xlsx.writeBuffer()
  return Buffer.from(ab)
}
