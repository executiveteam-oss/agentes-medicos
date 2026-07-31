// ============================================================
// Strip DETERMINISTA del marcador de timestamp [YYYY-MM-DD HH:MM] que
// buildMessageHistory antepone a cada mensaje del historial. Si el modelo lo
// copia (eco), lo removemos ANTES de enviar a WhatsApp — no depende de que el
// modelo obedezca la cláusula del prompt.
//
// Saca CUALQUIER ocurrencia (no solo la del arranque) + un espacio/tab que
// quede pegado, y limpia el whitespace resultante. Un mensaje sin marcador no
// se toca.
// ============================================================

const TS_MARKER = /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\][ \t]?/g

export function stripTimestampMarkers(text: string): { text: string; stripped: number } {
  let stripped = 0
  let out = text.replace(TS_MARKER, () => { stripped++; return '' })
  if (stripped > 0) {
    out = out
      .replace(/[ \t]{2,}/g, ' ')   // colapsa espacios dobles que quedaron
      .replace(/[ \t]+\n/g, '\n')   // espacio pegado antes de un salto de línea
      .replace(/\n{3,}/g, '\n\n')   // no dejar más de una línea en blanco
      .trim()
  }
  return { text: out, stripped }
}
