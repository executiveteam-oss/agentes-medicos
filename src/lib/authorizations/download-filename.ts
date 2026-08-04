// ============================================================
// Nombre de archivo para la descarga de autorizaciones.
//
// ⚠️ EL FORMATO VIVE ACÁ, EN UN SOLO LUGAR — a propósito. Cuando Lady vea cómo
// tiene armadas las carpetas y quiera otro orden/separador, se cambia SOLO esta
// función (y su test). Hoy es una adivinanza informada; ella tiene la última
// palabra.
//
// Formato actual:  CC1234567890_MARIA_PEREZ_GOMEZ_2026-08-04.pdf
//                  └─doc──┘      └──── nombre ────┘ └fecha recep┘
// - Documento primero (para radicar por cédula).
// - Nombre completo de la ficha, normalizado (sin tildes/ñ, espacios→_).
// - Fecha de RECEPCIÓN del archivo (created_at), NO la de la cita: la
//   autorización existe aunque la cita todavía no, y para radicar importa
//   cuándo entró el documento.
// - Sin documento en la ficha → prefijo SINDOC.
// ============================================================

const TIMEZONE = 'America/Bogota'

/** Quita tildes/ñ, deja [A-Za-z0-9], colapsa separadores a "_". Seguro en Windows. */
function slug(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tildes
    .replace(/ñ/gi, 'n')
    .replace(/[^A-Za-z0-9]+/g, '_') // cualquier otra cosa → _
    .replace(/^_+|_+$/g, '') // sin _ al inicio/fin
    .toUpperCase()
}

/** Fecha de recepción en Bogotá como YYYY-MM-DD (offset -05:00, hora entera). */
function receivedDate(receivedAtIso: string): string {
  const d = new Date(receivedAtIso)
  if (isNaN(d.getTime())) return 'sin-fecha'
  // toLocaleDateString en-CA da YYYY-MM-DD; con timeZone Bogotá.
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

export interface FilenameParams {
  documentType: string | null   // 'CC' | 'TI' | 'CE' | 'PP' | ...
  documentNumber: string | null
  patientName: string | null
  receivedAtIso: string          // created_at del archivo
  ext?: string                   // 'pdf' (default) o el original en el fallback
}

/**
 * Construye el nombre de archivo para descargar. Puro y determinista.
 * @returns ej. "CC1234567890_MARIA_PEREZ_2026-08-04.pdf"
 */
export function buildAuthorizationFilename(params: FilenameParams): string {
  const ext = (params.ext || 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'

  const docNum = (params.documentNumber ?? '').replace(/[^A-Za-z0-9]/g, '')
  const docType = slug(params.documentType ?? '')
  const docPart = docNum ? `${docType}${docNum}` : 'SINDOC'

  const namePart = slug(params.patientName ?? '') || 'SIN_NOMBRE'
  const datePart = receivedDate(params.receivedAtIso)

  return `${docPart}_${namePart}_${datePart}.${ext}`
}
