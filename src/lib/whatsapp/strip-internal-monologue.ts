// ============================================================
// EL MODELO PENSANDO EN VOZ ALTA NO LE LLEGA A LA PACIENTE.
//
// A Juliana Montoya le llegó esto, textual, el 2026-08-13:
//
//   "Tienes razón. Debo llamar create_appointment ahora con los datos
//    confirmados. Déjame obtener primero el ID de la cita actual del paciente."
//
// POR QUÉ PASA: `appointment-agent.ts` acumula el texto de TODAS las
// iteraciones del loop de tools (`collectedTexts.push` en cada vuelta) y al
// final las une con `join('\n\n')`. Eso se hizo a propósito —para no perder el
// mensaje pre-tool, que suele traer el motivo de lo que va a hacer— pero se
// lleva puesto también el razonamiento intermedio. Y como el orden es el del
// loop y no el de la conversación, puede quedar el "✅ confirmada" ANTES del
// "¿confirmás?".
//
// POR QUÉ ACÁ Y NO EN EL PROMPT: pedirle al modelo que no piense en voz alta es
// capa A. Esto es capa B — determinista, en el punto de envío, junto al
// stripTimestampMarkers que resuelve el mismo tipo de problema (algo que el
// modelo emite y la paciente no debe ver).
//
// CRITERIO CONSERVADOR: se descarta un bloque SOLO si es inequívocamente
// interno. Ante la duda se deja pasar — un párrafo de más es molesto; borrarle
// a la paciente la parte donde le dicen a qué hora es la cita, no.
// ============================================================

/** Nombres de las tools. Si aparecen en un texto que va a WhatsApp, ese texto
 *  no era para la paciente: nadie afuera del código los conoce. */
const NOMBRES_DE_TOOLS = [
  'create_appointment', 'check_availability', 'cancel_appointment',
  'reschedule_appointment', 'get_patient_appointments', 'escalate_to_human',
  'add_to_waitlist', 'calculate_date', 'check_eps_convenio', 'get_consultation_price',
]

/** Frases con las que el modelo se narra a sí mismo el próximo paso. */
const PATRONES_INTERNOS: RegExp[] = [
  // "Debo/voy a/tengo que llamar|usar|ejecutar <tool>"
  /\b(debo|tengo que|voy a|déjame|dejame|permíteme)\s+(llamar|usar|ejecutar|invocar|consultar)\s+(a\s+)?(la\s+)?(herramienta|tool|función|funcion)\b/i,
  // Referencia directa a una tool por su nombre técnico
  new RegExp(`\\b(${NOMBRES_DE_TOOLS.join('|')})\\b`, 'i'),
  // "Tienes razón. Debo…" — el modelo aceptando una corrección del sistema
  /\b(tienes|tenés)\s+razón[.,]?\s*(debo|voy a|déjame|dejame)\b/i,
  // Auto-instrucciones sobre el flujo
  /\b(primero|ahora)\s+(debo|necesito)\s+(obtener|buscar|traer|verificar)\s+(el\s+)?(id|identificador)\b/i,
  // El "ID de la cita" es vocabulario del sistema: una paciente nunca lo pide
  // ni lo necesita, así que un texto que lo menciona no era para ella.
  /\b(id|identificador)\s+(interno\s+)?(de\s+)?(la\s+|el\s+)?(cita|paciente|consulta|registro)\b/i,
  // El modelo narrando que el SISTEMA le rechazó algo. Salió a una paciente:
  // "Disculpa, acabo de verificar y veo que el Dr. Jorge Dario está
  // identificado en el sistema con otro ID. Déjame revisar sus horarios
  // correctamente:". Es el pin del médico rebotándolo, contado en voz alta.
  /\b(en el sistema|del sistema)\b[^.]*\b(id|identificado|registrado)\b/i,
  /\bacabo de\s+(verificar|revisar|comprobar|chequear)\b/i,
  // Se corrige a sí mismo en voz alta: "déjame revisar … correctamente".
  /\b(déjame|dejame|permíteme|permitime)\s+(revisar|verificar|buscar|consultar)\b[^.]*\b(correctamente|de nuevo|otra vez|nuevamente)\b/i,
]

/** ¿Este bloque de texto es monólogo interno? */
export function esMonologoInterno(bloque: string): boolean {
  const t = bloque.trim()
  if (!t) return true
  return PATRONES_INTERNOS.some((re) => re.test(t))
}

export interface ResultadoLimpieza {
  text: string
  /** Cuántos bloques se descartaron. Sirve para alertar: si esto sube, el
   *  modelo está narrando más de la cuenta y hay que mirar el prompt. */
  removidos: number
}

/**
 * Saca los bloques de monólogo interno de un mensaje ya unido con '\n\n'.
 *
 * Si TODOS los bloques resultan internos, devuelve el texto original: es la
 * señal de que el detector se pasó de ancho, y mandar algo raro es mejor que
 * mandar un mensaje vacío o dejar a la paciente sin respuesta.
 */
export function stripInternalMonologue(text: string): ResultadoLimpieza {
  if (!text.trim()) return { text, removidos: 0 }

  const bloques = text.split(/\n{2,}/)
  const limpios = bloques.filter((b) => !esMonologoInterno(b))
  const removidos = bloques.length - limpios.length

  if (removidos === 0) return { text, removidos: 0 }
  if (limpios.length === 0) return { text, removidos: 0 }   // no dejar sin mensaje

  return { text: limpios.join('\n\n').trim(), removidos }
}
