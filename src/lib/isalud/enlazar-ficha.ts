// ============================================================
// ENLAZAR UNA CITA IMPORTADA CON LA FICHA DE SU PACIENTE.
//
// El sync insertaba citas SIN `patient_id` —la palabra no aparecía en todo
// sync-agent.ts— y sin ese enlace la cita queda fuera de casi todo: no sale el
// recordatorio de 24h, no sale la encuesta, no hay historial ni riesgo de
// inasistencia, y si la paciente escribe al WhatsApp el agente no la reconoce.
//
// Al 2026-08-13 eran 133 de 268 citas futuras (49,6%), y en 82 de esas la ficha
// EXISTÍA en el padrón con teléfono y documento. Lo que faltaba era el enlace.
//
// LA REGLA ES DURA A PROPÓSITO: solo por DOCUMENTO exacto normalizado. Nunca
// por nombre, nunca fuzzy, nunca por teléfono. Un documento que matchea dos
// fichas NO se enlaza.
//
// Por qué tan estricto: enlazar mal no es un error de pantalla. Es el
// recordatorio de una paciente llegándole a otra, y el agente reconociendo a
// quien no es cuando escriba por WhatsApp. Ante la duda, sin enlace — que es el
// estado que ya teníamos y del que nadie se murió.
// ============================================================

/** Solo dígitos. iSalud manda "CC 1053813866" y el padrón guarda "1053813866";
 *  también hay documentos con puntos y espacios de por medio. */
export function normalizarDocumento(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

export type ResultadoEnlace =
  | { enlazar: true; patientId: string }
  | { enlazar: false; razon: 'sin_documento' | 'sin_ficha' | 'documento_duplicado' }

/**
 * Decide si una cita se enlaza, dado el índice documento → fichas.
 *
 * `fichasPorDocumento` mapea documento normalizado a TODAS las fichas con ese
 * documento. Que sea una lista y no un id es lo que permite detectar el
 * duplicado en vez de tomar el primero.
 */
export function decidirEnlace(
  documentoDeLaCita: string | null | undefined,
  fichasPorDocumento: Map<string, string[]>,
): ResultadoEnlace {
  const doc = normalizarDocumento(documentoDeLaCita)
  if (!doc) return { enlazar: false, razon: 'sin_documento' }

  const fichas = fichasPorDocumento.get(doc)
  if (!fichas || fichas.length === 0) return { enlazar: false, razon: 'sin_ficha' }
  // Dos fichas con el mismo documento es un problema del padrón, no de la cita.
  // Elegir una sería adivinar cuál de las dos personas es.
  if (fichas.length > 1) return { enlazar: false, razon: 'documento_duplicado' }

  return { enlazar: true, patientId: fichas[0] }
}

/** Arma el índice a partir de las filas del padrón. Agrupa por documento para
 *  que los duplicados se vean en vez de pisarse. */
export function indexarFichasPorDocumento(
  filas: { id: string; document_number: string | null }[],
): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const f of filas) {
    const d = normalizarDocumento(f.document_number)
    if (!d) continue
    const lista = m.get(d)
    if (lista) lista.push(f.id)
    else m.set(d, [f.id])
  }
  return m
}
