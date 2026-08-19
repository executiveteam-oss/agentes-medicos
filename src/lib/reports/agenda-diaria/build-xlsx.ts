// ============================================================
// La MISMA agenda diaria, en .xlsx.
//
// Comparte `armarFilasAgenda` con el PDF: los fallbacks por columna —de dónde
// sale cada dato cuando la cita no tiene ficha— se escriben una sola vez. Acá
// sólo cambia cómo se presenta.
//
// .xlsx DE VERDAD, no un CSV renombrado. Un CSV es bytes sin declarar
// codificación: Excel lo abre como Latin-1 y por eso el archivo de iSalud se
// ve "CÃ©dula" y "ECOGRAFÃ­A". Un .xlsx es un ZIP con XML que declara UTF-8 en
// su propia cabecera — no hay forma de que el programa lo interprete mal.
//
// Y a diferencia del PDF, acá los datos tienen que quedar USABLES: si van a
// filtrar y ordenar, la hora tiene que ser hora y la fecha fecha. Un "10:00 AM"
// de texto ordena antes que "9:00 AM".
// ============================================================

import ExcelJS from 'exceljs'
import type { FilaAgenda } from './build-pdf'

export interface AgendaXlsxInput {
  doctorName: string
  fechaLarga: string
  clinicName: string
  filas: FilaAgenda[]
}

/**
 * Las columnas del archivo que ya usaban. `texto: true` fuerza formato de TEXTO
 * en la celda — sin eso, Excel se come los ceros a la izquierda de un documento
 * y pasa los largos a notación científica ("1,08833E+09").
 */
const COLUMNAS: { header: string; key: keyof FilaAgenda | 'horaExcel' | 'fechaExcel'; ancho: number; texto?: boolean }[] = [
  { header: 'H INICIA', key: 'horaExcel', ancho: 11 },
  { header: 'FECHA', key: 'fechaExcel', ancho: 12 },
  { header: 'PROFESIONAL', key: 'profesional', ancho: 32 },
  { header: 'ESPECIALIDAD', key: 'especialidad', ancho: 16 },
  { header: 'ASEGURADORA', key: 'aseguradora', ancho: 34 },
  { header: 'TIPO ID', key: 'tipoId', ancho: 9, texto: true },
  { header: 'NRO ID', key: 'nroId', ancho: 15, texto: true },
  { header: 'NOMBRE', key: 'nombre', ancho: 34 },
  { header: 'PRODUCTO', key: 'producto', ancho: 34 },
]

/** En Excel el dato faltante es la celda VACÍA, no un guion — ver el comentario
 *  de abajo. Se traduce al salir. */
const GUION_DEL_PDF = '—'

export async function buildAgendaDiariaXlsx(input: AgendaXlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Omuwan'
  wb.created = new Date()

  const ws = wb.addWorksheet('Agenda', {
    views: [{ state: 'frozen', ySplit: 1 }],   // la fila de encabezados queda fija al bajar
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  // Si igual lo imprimen desde Excel, que salga con el mismo encabezado del PDF.
  ws.headerFooter.oddHeader = `&L&"Helvetica,Bold"&14${input.doctorName}&R&"Helvetica,Regular"&11${input.fechaLarga} — ${input.clinicName}`

  ws.columns = COLUMNAS.map((c) => ({ header: c.header, key: c.header, width: c.ancho }))

  const encabezado = ws.getRow(1)
  encabezado.font = { bold: true }
  encabezado.alignment = { vertical: 'middle' }
  encabezado.height = 20

  for (const fila of input.filas) {
    const inicio = new Date(fila.startsAtIso)
    // Excel guarda fechas sin zona horaria: se le pasa el instante YA corrido a
    // hora de Colombia, o una cita de las 7:00 AM COT se ve a las 12:00.
    const enBogota = new Date(inicio.getTime() - 5 * 60 * 60 * 1000)

    const row = ws.addRow({
      'H INICIA': enBogota,
      'FECHA': enBogota,
      'PROFESIONAL': limpiar(fila.profesional),
      'ESPECIALIDAD': limpiar(fila.especialidad),
      'ASEGURADORA': limpiar(fila.aseguradora),
      'TIPO ID': limpiar(fila.tipoId),
      'NRO ID': limpiar(fila.nroId),
      'NOMBRE': limpiar(fila.nombre),
      'PRODUCTO': limpiar(fila.producto),
    })

    row.getCell('H INICIA').numFmt = 'h:mm AM/PM'
    row.getCell('FECHA').numFmt = 'dd/mm/yyyy'
    for (const c of COLUMNAS.filter((x) => x.texto)) row.getCell(c.header).numFmt = '@'
  }

  // Autofiltro sobre el rango con datos: es lo primero que van a querer usar.
  if (input.filas.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: input.filas.length + 1, column: COLUMNAS.length } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/**
 * El guion del PDF se convierte en celda VACÍA.
 *
 * En una hoja impresa un blanco se lee como error de impresión y por eso ahí va
 * el guion. En Excel es al revés: el guion es un VALOR —aparece como opción en
 * el filtro, ordena entre los textos, y rompe cualquier fórmula que cuente no
 * vacíos—. La celda vacía es lo que las herramientas ya entienden como "no hay
 * dato". Mismo hecho, dos convenciones.
 */
function limpiar(valor: string): string {
  return valor === GUION_DEL_PDF ? '' : valor
}
