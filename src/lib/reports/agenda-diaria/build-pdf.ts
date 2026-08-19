// ============================================================
// Agenda diaria de UN médico, en PDF apaisado para imprimir.
//
// Reemplaza el archivo que las secretarias bajaban de iSalud para llevarle las
// consultas al médico. Mismas nueve columnas y en el mismo orden, para que no
// tengan que aprender a leer otra cosa.
//
// APAISADO, no vertical: nombres como "ENTIDAD PROMOTORA DE SALUD SERVICIO
// OCCIDENTAL DE SALUD S.A" o "ECOGRAFÍA DINÁMICA DE PISO PÉLVICO" no entran en
// los ~180mm útiles de un A4 vertical sin partir palabras o bajar a 6pt. En
// horizontal hay ~270mm. La altura nunca fue el problema: el día más cargado
// son 13 citas para un médico.
//
// Las tildes salen bien por construcción: el texto va incrustado en el PDF con
// su fuente, no depende de cómo lo abra el programa que lo recibe. El archivo
// de iSalud se ve "CÃ©dula" porque es UTF-8 abierto como Latin-1 — con un PDF
// eso no puede pasar.
// ============================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/** Una fila ya resuelta. El armado de los datos vive en armar-filas.ts, y lo
 *  comparten el PDF y el Excel: los fallbacks por columna se escriben UNA vez. */
export interface FilaAgenda {
  /** El instante crudo. El PDF no lo usa —ya tiene hora y fecha formateadas—,
   *  pero Excel necesita un Date real para que la hora se ordene y se filtre
   *  como hora y no como el texto "10:00 AM", que ordena antes que "9:00 AM". */
  startsAtIso: string
  horaInicia: string
  fecha: string
  profesional: string
  especialidad: string
  aseguradora: string
  tipoId: string
  nroId: string
  nombre: string
  producto: string
}

export interface AgendaDiariaInput {
  doctorName: string
  /** Ya formateada para el encabezado: "Miércoles 20 de agosto de 2026". */
  fechaLarga: string
  clinicName: string
  filas: FilaAgenda[]
}

/** Dato que no existe. Un blanco se lee como error de impresión; esto no. */
export const SIN_DATO = '—'

// A4 apaisado, en puntos.
const ANCHO = 841.89
const ALTO = 595.28
const MARGEN = 30

/** Anchos por columna. Suman el ancho útil (781.89). */
const COLUMNAS: { titulo: string; ancho: number; campo: keyof FilaAgenda }[] = [
  { titulo: 'H INICIA', ancho: 55, campo: 'horaInicia' },
  { titulo: 'FECHA', ancho: 62, campo: 'fecha' },
  { titulo: 'PROFESIONAL', ancho: 105, campo: 'profesional' },
  // Se llama ESPECIALIDAD y no SERVICIO a propósito: el dato es la especialidad
  // del médico (doctors.specialty). iSalud traía la categoría del servicio
  // ("ECOGRAFIAS"), que el sync no guardó — nombrarlo SERVICIO sería vender una
  // aproximación como si fuera el dato de ellos.
  { titulo: 'ESPECIALIDAD', ancho: 80, campo: 'especialidad' },
  { titulo: 'ASEGURADORA', ancho: 120, campo: 'aseguradora' },
  { titulo: 'TIPO ID', ancho: 45, campo: 'tipoId' },
  { titulo: 'NRO ID', ancho: 70, campo: 'nroId' },
  { titulo: 'NOMBRE', ancho: 130, campo: 'nombre' },
  { titulo: 'PRODUCTO', ancho: 115, campo: 'producto' },
]

/**
 * Las fuentes estándar de PDF codifican en WinAnsi: tildes y ñ entran, pero un
 * emoji o una comilla curva hacen throw y se cae la descarga entera. Se limpia
 * antes de dibujar — un guion raro no vale perder la hoja.
 */
function aWinAnsi(texto: string): string {
  return texto
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Deja pasar Latin-1 (incluye á é í ó ú ñ Ñ ü) y descarta el resto.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

/** Corta con puntos suspensivos lo que no entra en la columna. */
function recortar(texto: string, ancho: number, font: PDFFont, size: number): string {
  const limpio = aWinAnsi(texto)
  const util = ancho - 6
  if (font.widthOfTextAtSize(limpio, size) <= util) return limpio
  let cortado = limpio
  while (cortado.length > 1 && font.widthOfTextAtSize(cortado + '...', size) > util) {
    cortado = cortado.slice(0, -1)
  }
  return cortado + '...'
}

function dibujarEncabezadoDePagina(
  page: PDFPage, input: AgendaDiariaInput, bold: PDFFont, regular: PDFFont,
): number {
  let y = ALTO - MARGEN

  // El nombre del médico y la fecha en grande: se imprime una hoja por médico
  // por día y tiene que distinguirse de un vistazo en un mostrador.
  y -= 22
  page.drawText(aWinAnsi(input.doctorName), { x: MARGEN, y, size: 20, font: bold, color: rgb(0.1, 0.08, 0.19) })
  y -= 20
  page.drawText(aWinAnsi(input.fechaLarga), { x: MARGEN, y, size: 14, font: regular, color: rgb(0.35, 0.33, 0.42) })

  const derecha = `${aWinAnsi(input.clinicName)}  ·  ${input.filas.length} cita${input.filas.length === 1 ? '' : 's'}`
  page.drawText(derecha, {
    x: ANCHO - MARGEN - regular.widthOfTextAtSize(derecha, 10), y: ALTO - MARGEN - 22,
    size: 10, font: regular, color: rgb(0.45, 0.43, 0.5),
  })

  y -= 18
  page.drawLine({
    start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y },
    thickness: 1, color: rgb(0.8, 0.78, 0.85),
  })
  return y - 16
}

function dibujarCabeceraDeTabla(page: PDFPage, y: number, bold: PDFFont): number {
  let x = MARGEN
  for (const col of COLUMNAS) {
    page.drawText(recortar(col.titulo, col.ancho, bold, 8), { x, y, size: 8, font: bold, color: rgb(0.35, 0.33, 0.42) })
    x += col.ancho
  }
  y -= 6
  page.drawLine({
    start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y },
    thickness: 0.5, color: rgb(0.85, 0.83, 0.88),
  })
  return y - 13
}

export async function buildAgendaDiariaPdf(input: AgendaDiariaInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Agenda ${input.doctorName} — ${input.fechaLarga}`)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([ANCHO, ALTO])
  let y = dibujarEncabezadoDePagina(page, input, bold, regular)
  y = dibujarCabeceraDeTabla(page, y, bold)

  if (input.filas.length === 0) {
    page.drawText('Sin citas para este día.', { x: MARGEN, y, size: 11, font: regular, color: rgb(0.45, 0.43, 0.5) })
    return pdf.save()
  }

  for (const [i, fila] of input.filas.entries()) {
    // Salto de página si no queda alto. El caso normal (13 citas) entra en una.
    if (y < MARGEN + 20) {
      page = pdf.addPage([ANCHO, ALTO])
      y = dibujarEncabezadoDePagina(page, input, bold, regular)
      y = dibujarCabeceraDeTabla(page, y, bold)
    }

    // Cebra suave: son filas largas y el ojo se pierde de columna a columna.
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGEN - 3, y: y - 4, width: ANCHO - MARGEN * 2 + 6, height: 15,
        color: rgb(0.97, 0.96, 0.98),
      })
    }

    let x = MARGEN
    for (const col of COLUMNAS) {
      const valor = fila[col.campo]?.trim() || SIN_DATO
      const esHora = col.campo === 'horaInicia'
      page.drawText(recortar(valor, col.ancho, esHora ? bold : regular, 8.5), {
        x, y, size: 8.5, font: esHora ? bold : regular, color: rgb(0.1, 0.08, 0.19),
      })
      x += col.ancho
    }
    y -= 15
  }

  return pdf.save()
}
