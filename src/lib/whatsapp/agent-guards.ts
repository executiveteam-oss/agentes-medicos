// ============================================================
// Guards defensivos para detectar alucinaciones del agente
//
// Cada guard detecta cuando el agente afirma algo que NO ocurrió:
// - Identidad confirmada sin afirmación explícita del paciente
// - Cita cancelada sin haber llamado cancel_appointment
// - Cita reagendada sin haber llamado reschedule_appointment
// - Cita confirmada sin appointmentData válida
// - Cita creada con un médico distinto al que el agente le prometió
//
// Funciones puras → testeables sin DB/network.
// ============================================================

import type { Message } from '@/types/database'
import { detectarMencionDeMedico } from '@/lib/agent/doctor-pin'

// ============================================================
// Regex compartidos
// ============================================================

// Frases que CLAIMAN identidad confirmada
export const IDENTITY_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bya\s+(que\s+)?(confirmaste|confirmamos|confirmas)\b/i,
  /\bcomo\s+(ya\s+)?(confirmaste|confirmados?)\b/i,
  /\b(datos|identidad)\s+confirmad[oa]s?\b/i,
  /\bconfirmad[oa]\s+(tu|tus)\s+(identidad|datos)\b/i,
  /\bgracias\s+por\s+confirmar\b/i,
  /\buna\s+vez\s+confirmad[oa]/i,
]

// Detecta cuando el AGENTE preguntó por confirmación
export const AGENT_REQUESTED_CONFIRMATION = /confirmas\s+que\s+eres|¿confirmas\??|me\s+confirmas\s+tu\s+nombre|confirmas\s+tu\s+nombre|tu\s+nombre\s+completo|responde\s+s[ií]\s+para|¿eres\s+[A-ZÁÉÍÓÚÑ]/i

/** El paciente dijo un nombre que matchea la ficha → cuenta como confirmación
 *  (el protocolo nuevo confirma pidiendo el nombre, no un "sí"). Lenient a
 *  propósito: el guard NO debe bloquear un flujo legítimo por no haber un "sí". */
export function patientMsgMatchesName(msg: string, patientName: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const nMsg = norm(msg)
  return norm(patientName).split(/\s+/).filter((t) => t.length >= 3).some((tok) => nMsg.includes(tok))
}

// Mensaje del PACIENTE que cuenta como afirmación explícita
// (mensaje entero o que empieza con sí + puntuación)
export const PATIENT_AFFIRMATION = /^\s*(s[ií]|si|yes|correcto|exacto|exactamente|dale|claro|ok(?:ey)?|listo|sip|confirmo|af[ií]rmativo|as[ií]\s+es|esa\s+soy|ese\s+soy|soy\s+yo|todo\s+correcto|conforme|de\s+acuerdo)\s*[!.,]?\s*$/i
export const PATIENT_AFFIRMATION_PREFIX = /^\s*(s[ií]|si)\b[\s,.!]/i

// Frases que CLAIMAN cancelación
export const CANCELLATION_CLAIM = /\bcita\b[^.!?]{0,40}\b(cancelad[ao]|anulad[ao])\b|\bcancel[ée]\s+tu\s+cita\b|\bcita\s+(qued[ao]|est[áa])\s+cancelad/i

// Frases que CLAIMAN reagendamiento
export const RESCHEDULE_CLAIM = /\bcita\b[^.!?]{0,40}\b(reagendad[ao]|reprogramad[ao])\b|\b(reagend[ée]|reprogram[ée])\s+tu\s+cita\b|\bcita\s+(qued[ao]|est[áa])\s+(reagendad|reprogramad)/i

// Frases que CLAIMAN cita creada/confirmada (formato con ✅)
export const APPOINTMENT_CONFIRMATION_CLAIM = /✅.*cita (confirmada|agendada|creada)/i

// ============================================================
// Resultado común
// ============================================================
export interface GuardResult {
  blocked: boolean
  replacement?: string
  reason?: string
  details?: Record<string, unknown>
}

// ============================================================
// GUARD 1: Identidad confirmada fabricada
// ============================================================
export function detectHallucinatedIdentity(args: {
  agentText: string
  messageHistory: Message[]
  currentPatientMsg: string
  patientName: string
  patientDocType?: string | null
  patientDocNumber?: string | null
}): GuardResult {
  const { agentText, messageHistory, currentPatientMsg, patientName, patientDocType, patientDocNumber } = args

  const claimsConfirmed = IDENTITY_CLAIM_PATTERNS.some((r) => r.test(agentText))
  if (!claimsConfirmed) return { blocked: false }

  // Buscar última solicitud de confirmación del agente en historial
  let lastConfirmRequestIdx = -1
  messageHistory.forEach((m, i) => {
    if (m.role === 'agent' && AGENT_REQUESTED_CONFIRMATION.test(m.content)) {
      lastConfirmRequestIdx = i
    }
  })

  // Recopilar mensajes del paciente DESPUÉS de la solicitud + el actual
  const subsequentPatientMsgs: string[] = []
  if (lastConfirmRequestIdx >= 0) {
    for (let i = lastConfirmRequestIdx + 1; i < messageHistory.length; i++) {
      if (messageHistory[i].role === 'patient') subsequentPatientMsgs.push(messageHistory[i].content)
    }
  }
  subsequentPatientMsgs.push(currentPatientMsg)

  // ¿Alguno fue afirmación explícita?
  const explicitConfirmation = subsequentPatientMsgs.some((m) => {
    const t = m.trim()
    // "sí/confirmo" O un nombre que matchea la ficha (protocolo nuevo: confirma
    // dando el nombre, no un "sí"). Sin esto, el guard bloquearía el flujo nuevo.
    return PATIENT_AFFIRMATION.test(t) || PATIENT_AFFIRMATION_PREFIX.test(t) || patientMsgMatchesName(t, patientName)
  })

  if (explicitConfirmation) return { blocked: false }

  const docInfo = patientDocType && patientDocNumber ? `, ${patientDocType} ${patientDocNumber}` : ''
  return {
    blocked: true,
    replacement: `Antes de continuar necesito que confirmes tu identidad. ¿Eres ${patientName}${docInfo}? Respóndeme "sí" o "no" para seguir.`,
    reason: 'hallucinated_identity_confirmation',
    details: {
      last_patient_messages: subsequentPatientMsgs.slice(-3).map((s) => s.slice(0, 80)),
      had_confirm_request_in_history: lastConfirmRequestIdx >= 0,
    },
  }
}

// ============================================================
// GUARD 2: Cancelación fabricada
// ============================================================
export function detectHallucinatedCancellation(args: {
  agentText: string
  toolsUsed: string[]
}): GuardResult {
  if (!CANCELLATION_CLAIM.test(args.agentText)) return { blocked: false }
  if (args.toolsUsed.includes('cancel_appointment')) return { blocked: false }
  return {
    blocked: true,
    replacement: 'Disculpa, tuve un problema procesando la cancelación. ¿Me confirmas qué cita quieres cancelar?',
    reason: 'hallucinated_cancellation',
    details: { tools_used: args.toolsUsed },
  }
}

// ============================================================
// GUARD 3: Reagendamiento fabricado
// ============================================================
export function detectHallucinatedReschedule(args: {
  agentText: string
  toolsUsed: string[]
}): GuardResult {
  if (!RESCHEDULE_CLAIM.test(args.agentText)) return { blocked: false }
  // reschedule_appointment O create_appointment (algunos flujos crean nueva en vez de reagendar)
  if (args.toolsUsed.includes('reschedule_appointment') || args.toolsUsed.includes('create_appointment')) {
    return { blocked: false }
  }
  return {
    blocked: true,
    replacement: 'Disculpa, tuve un problema procesando el reagendamiento. ¿Me confirmas el nuevo horario que prefieres?',
    reason: 'hallucinated_reschedule',
    details: { tools_used: args.toolsUsed },
  }
}

// ============================================================
// GUARD 7: prometió que una persona la iba a contactar, y no escaló
//
// A diferencia de los guards 2, 3 y 4, este NO reemplaza el texto. La promesa
// que el agente le hizo a la paciente es CORRECTA —alguien tiene que
// contactarla—; lo único que faltó fue cumplirla. Reemplazarla por "disculpa,
// tuve un problema" le traslada a ella un error nuestro y encima le saca la
// única respuesta útil que recibió. El guard escala de verdad y deja el texto.
//
// Casos reales del 2026-08-18 que lo originaron (2 de 8 en el período):
//   · "Déjame escalar esto con la secretaria para que te los hagan llegar"
//   · "Ya les avisé y te contactan en los próximos minutos"
// Las dos pacientes quedaron esperando algo que nadie sabía que debía hacer.
//
// EL RIESGO ACÁ ES EL INVERSO AL DEL GUARD 6: un patrón amplio escala
// conversaciones que el agente podía cerrar solo, y eso ensucia la bandeja que
// justamente estamos tratando de limpiar. Por eso la familia A exige DOS cosas
// juntas —un sujeto humano Y una acción de contacto—: "voy a revisar" no
// dispara porque el sujeto es el agente, no una persona del consultorio.
//
// Medido sobre 888 mensajes del agente (08→18/08): 15 disparos reales en 11
// días, y 0 de los 85 señuelos ("déjame revisar", "dame un momento", "te
// confirmo en un momento", "voy a revisar").

/** Quién promete: tiene que ser una PERSONA del consultorio, no el agente. */
const SUJETO_HUMANO = /\b(asesor|asesora|secretaria|el equipo|equipo del consultorio|una persona del consultorio|alguien del consultorio)\b/i

/** Qué promete: que esa persona se va a comunicar. */
const ACCION_DE_CONTACTO = /(te contact|te escrib|te llam|te respond|se comunic|te confirm|te los hagan llegar|te van a|va a contactar|est[áa]n en eso)/i

/** O directamente el verbo de escalar, que no necesita sujeto: ya lo implica. */
const VERBO_ESCALAR = /(voy a escalar|d[ée]jame escalar|escalar esto|te paso con (un|una)|ya les avis[ée]|ya le avis[ée]|les aviso|voy a coordinar con el equipo)/i

export function detectPromesaDeHumanoSinEscalar(args: {
  agentText: string
  toolsUsed: string[]
  /** ¿La conversación YA va a escalar por cualquier vía?
   *
   *  No alcanza con mirar `toolsUsed`: existe un SEGUNDO camino de escalación
   *  —`agentResponse.escalate`, que usan los cortes deterministas (error
   *  técnico, convenio no reconocido, clínica no operativa, servicio que no
   *  existe con ese médico)—. Esos textos prometen humano y escalan bien, pero
   *  no pasan por la tool. Sin este flag el guard dispararía sobre
   *  conversaciones que ya están escalando: ruido en la bandeja, no un guard. */
  yaVaAEscalar: boolean
  /** ¿Esta conversación tiene un servicio ruleado marcado y sin gestionar?
   *
   *  🔴 LA CALIBRACIÓN (2026-08-20). "Para colposcopia, un asesor del
   *  consultorio confirma los detalles contigo" es la frase que emite la Capa 0
   *  al marcar un servicio ruleado — y ESA promesa SÍ tiene respaldo: el
   *  servicio quedó en `servicios_marcados` y la conversación vive en la
   *  pestaña Servicios. No hay nada que escalar.
   *
   *  Medido sobre las 19 escalaciones de la semana: 5 tenían el servicio
   *  marcado con fecha (y el texto era exactamente el del servicio ruleado);
   *  las otras 14 no tenían rastro en ningún lado y son detecciones correctas.
   *  La exención baja el guard de 19 a 14 sin eximir una sola promesa huérfana.
   *
   *  Ojo con la condición: NO alcanza con que el context tenga la clave. Tiene
   *  que haber un servicio PENDIENTE (marcado y no resuelto) — si ya lo
   *  gestionaron, una promesa nueva vuelve a no tener respaldo. */
  tieneServicioPendiente: boolean
}): GuardResult {
  if (args.yaVaAEscalar) return { blocked: false }
  if (args.toolsUsed.includes('escalate_to_human')) return { blocked: false }
  if (args.tieneServicioPendiente) return { blocked: false }

  const prometeConSujeto = SUJETO_HUMANO.test(args.agentText) && ACCION_DE_CONTACTO.test(args.agentText)
  const prometeEscalar = VERBO_ESCALAR.test(args.agentText)
  if (!prometeConSujeto && !prometeEscalar) return { blocked: false }

  return {
    // `blocked` acá significa "hay que actuar", NO "reemplazar el texto".
    // El caller escala y deja el mensaje tal cual — ver el comentario de arriba.
    blocked: true,
    reason: 'promesa_sin_escalar',
    details: {
      tools_used: args.toolsUsed,
      familia: prometeEscalar ? 'verbo_escalar' : 'sujeto_humano_mas_contacto',
    },
  }
}

// ============================================================
// GUARD 8: negó una cita que la paciente sostiene que tiene
//
// Como el 7, NO reemplaza el texto: escala. Y como el 7, el riesgo es escalar
// de más — por eso exige las DOS mitades, la negación del agente Y la
// afirmación previa de ella. Una paciente que pide agendar por primera vez no
// afirma nada, así que no dispara.
//
// EL CASO QUE LO ORIGINÓ (18/08): una paciente con TRES citas confirmadas para
// el día siguiente preguntó "¿es a las 2 o a las 2:20?" y recibió "Disculpa, no
// tengo registrada una cita tuya en este momento" — una hora después de que el
// sistema le confirmara una por el botón del recordatorio.
//
// La causa de fondo se arregló aparte (la tool ahora usa el patient_id resuelto
// y no el teléfono que escriba el modelo). Este guard es el backstop para lo
// que quede: el tercer caso del audit NO tenía cita en ninguna parte, y aun así
// hacía falta pasarlo a una persona. Un vacío no es una certeza.

/** El agente afirma que no hay citas. Excluye el convenio, que usa las mismas
 *  palabras ("no tengo registrado ese convenio") y es otra cosa. */
const NIEGA_CITA = /no (veo|tienes|tiene|hay|encuentro|aparece|figura|tengo)[^.]{0,30}(cita|programad|agendad|registrad)/i
const ES_SOBRE_CONVENIO = /convenio/i

/** Ella sostiene que la tiene. "Quiero agendar" NO entra: no afirma nada. */
const AFIRMA_TENER_CITA = /(reagend|reprogram|cambiar (la|mi) cita|mover (la|mi) cita|cancelar (la|mi) cita|mi cita|la cita que|tengo (una )?cita|ten[íi]a (una )?cita|me dieron (una )?cita|ya (tengo|ten[íi]a))/i

export function detectCitaNegadaQueEllaAfirma(args: {
  agentText: string
  /** Lo que la paciente escribió en ESTE turno. */
  patientText: string
  toolsUsed: string[]
  /** Los dos caminos de escalación, igual que en el guard 7. */
  yaVaAEscalar: boolean
}): GuardResult {
  if (args.yaVaAEscalar) return { blocked: false }
  if (args.toolsUsed.includes('escalate_to_human')) return { blocked: false }

  const niega = NIEGA_CITA.test(args.agentText) && !ES_SOBRE_CONVENIO.test(args.agentText)
  if (!niega) return { blocked: false }
  if (!AFIRMA_TENER_CITA.test(args.patientText)) return { blocked: false }

  return {
    // "Hay que actuar", no "reemplazar el texto": el caller escala.
    blocked: true,
    reason: 'cita_no_encontrada',
    details: { tools_used: args.toolsUsed, consulto_agenda: args.toolsUsed.includes('get_patient_appointments') },
  }
}

// ============================================================
// GUARD 4: Cita confirmada fabricada (sin appointmentData)
// ============================================================
export function detectHallucinatedAppointmentConfirmation(args: {
  agentText: string
  hasAppointmentData: boolean
  toolsUsed: string[]
}): GuardResult {
  if (!APPOINTMENT_CONFIRMATION_CLAIM.test(args.agentText)) return { blocked: false }
  if (args.hasAppointmentData) return { blocked: false }
  return {
    blocked: true,
    replacement: 'Disculpa, hubo un problema técnico al confirmar tu cita. ¿Puedes intentar de nuevo diciendo el horario que prefieres?',
    reason: 'hallucinated_appointment_confirmation',
    details: { tools_used: args.toolsUsed },
  }
}

// ============================================================
// GUARD 5: agendó con un médico distinto al que le prometió a la paciente
//
// Red final de las tres capas del 2026-08-17. Las capas 1 y 2 (pin + servicio)
// impiden que pase cuando la paciente NOMBRA al médico. Éste cubre lo que se
// escapa: cuando el médico salió de un menú que ofreció el agente y la paciente
// eligió por número, no hay nada que pinear — pero el agente igual escribió el
// nombre, y ese nombre es una promesa.
//
// Los dos casos reales quedaban así:
//   "✅ Doctor: Dr. Jorge Dario López Isanoa"   ← lo que prometió
//   create_appointment(doctor_id: JUAN DIEGO)   ← lo que hizo
//
// Un menú NO dispara el guard: `detectarMencionDeMedico` devuelve null cuando
// hay dos o más médicos en el mismo texto, así que "1. Dra. Angélica 2. Dr.
// Juan Diego" no es una promesa y no se compara. Tampoco dispara cuando el
// agente propone el cambio de forma explícita y la paciente acepta, porque ese
// mensaje nombra a los dos.
// ============================================================
export function detectDoctorNameMismatch(args: {
  /** El mensaje que está por salir. */
  agentText: string
  /** Los últimos mensajes del AGENTE en esta conversación, del más reciente al
   *  más viejo. Acá vive la promesa: el mismatch casi nunca está en el mensaje
   *  final —que suele nombrar bien al médico de la cita— sino en el resumen
   *  "¿confirmas?" que vino antes. */
  priorAgentTexts: string[]
  /** El médico REAL de la cita que se acaba de crear (appointmentData). */
  appointmentDoctorName: string | null | undefined
  doctors: { id: string; name: string }[]
  patientName?: string | null
}): GuardResult {
  const real = (args.appointmentDoctorName ?? '').trim()
  if (!real || args.doctors.length === 0) return { blocked: false }

  const realPin = detectarMencionDeMedico(real, args.doctors)
  if (!realPin) return { blocked: false }   // no lo pudimos resolver → no inventamos un bloqueo

  // Se miran pocos mensajes hacia atrás a propósito: una mención de hace media
  // hora, de otro trámite, no es una promesa sobre ESTA cita.
  //
  // ⚠️ Se recorren TODOS los candidatos y basta UNO que discrepe. La primera
  // versión de este guard cortaba con "si la mención más reciente coincide,
  // está bien" — y no detectaba ninguno de los dos casos reales, porque el
  // mensaje final SIEMPRE coincide: el modelo lo escribe leyendo el resultado
  // de la tool. La promesa rota está en el mensaje ANTERIOR, el "¿confirmas?".
  const candidatos = [args.agentText, ...args.priorAgentTexts.slice(0, 3)]
  for (const texto of candidatos) {
    const dicho = detectarMencionDeMedico(texto ?? '', args.doctors, { nombrePaciente: args.patientName ?? null })
    if (!dicho) continue                                  // ninguno o varios (menú) → no es promesa
    if (dicho.doctor_id === realPin.doctor_id) continue   // esa mención es coherente; seguir mirando
    return {
      blocked: true,
      reason: 'doctor_name_mismatch',
      details: {
        prometido: dicho.doctor_name,
        agendado: realPin.doctor_name,
        prometido_doctor_id: dicho.doctor_id,
        agendado_doctor_id: realPin.doctor_id,
      },
    }
  }
  return { blocked: false }
}

// ============================================================
// GUARD 6: días, fechas y horarios que no salieron de una tool
//
// REQUISITO: el agente no le afirma a una paciente ningún día, fecha ni horario
// que no haya salido de una tool en ESE turno.
//
// Sale de dos casos reales del 2026-08-18, uno arriba del otro:
//   "Atiende lunes, martes, miércoles, viernes y sábado"  (atiende L-X-V)
//   "lunes 19, miércoles 21 o viernes 22 de agosto"       (19=X, 21=V, 22=S)
// Se le dio el dato compuesto en la tool y el modelo mejoró, pero eso es capa
// A. Esto es capa B: se contrasta lo que escribió contra lo que la tool dijo.
//
// LOS TRES CHEQUEOS NO PESAN IGUAL, y eso es deliberado:
//   1. fecha ↔ día    → DURO. "lunes 19" es verificable sin ninguna tool: o el
//                       19 es lunes o no lo es.
//   2. días atendidos → DURO, pero SOLO sobre afirmaciones positivas. "no
//                       atiende los martes" es correcto y no se toca.
//   3. horas          → ACOTADO. Sólo si el turno llamó check_availability Y el
//                       mensaje ofrece una lista de horarios. Fuera de ahí no
//                       opina, porque confirmar una cita ("quedó a las 8:15") y
//                       recordarla ("tenés cita a las 2:00") son la mitad de lo
//                       que hace el agente y sus horas vienen de OTRAS tools.
//                       Compara por MINUTOS, no por texto: "8:15 AM" y "8:15 de
//                       la mañana" son la misma hora.
// ============================================================

const MESES_ES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado']
const DIA_A_INDICE: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
}

/** "lunes 19 de agosto" → { dia:'lunes', d:19, mes:7 }. Sin día nombrado, no
 *  hay nada que validar y se ignora. */
export function fechasConDiaEnTexto(texto: string): { crudo: string; dia: string; d: number; mes: number }[] {
  const re = new RegExp(`\\b(${DIAS_ES.join('|')})\\s+(\\d{1,2})\\s+de\\s+(${Object.keys(MESES_ES).join('|')})\\b`, 'gi')
  const out: { crudo: string; dia: string; d: number; mes: number }[] = []
  for (const m of texto.matchAll(re)) {
    out.push({ crudo: m[0], dia: m[1].toLowerCase(), d: Number(m[2]), mes: MESES_ES[m[3].toLowerCase()] })
  }
  return out
}

/** Los días que el texto afirma que SÍ se atiende. Ignora negaciones. */
export function diasAfirmadosEnTexto(texto: string): string[] {
  const out = new Set<string>()
  // Se corta en el punto: cada oración se juzga sola.
  for (const oracion of texto.split(/[.\n]/)) {
    const o = oracion.toLowerCase()
    if (!/\b(atiende|atienden|consulta los|disponible los)\b/.test(o)) continue
    if (/\bno\s+(atiende|atienden|consulta)\b/.test(o)) continue   // "no atiende los martes" es correcto
    for (const d of DIAS_ES) {
      if (new RegExp(`\\b${d}\\b`).test(o)) out.add(d.replace('miercoles', 'miércoles').replace('sabado', 'sábado'))
    }
  }
  return [...out]
}

/** Horas del texto, en minutos desde medianoche. Entiende 12h con AM/PM. */
export function horasEnTexto(texto: string): { crudo: string; minutos: number }[] {
  const out: { crudo: string; minutos: number }[] = []
  const re = /\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?|de la mañana|de la tarde|de la noche)?/gi
  for (const m of texto.matchAll(re)) {
    let h = Number(m[1]); const min = Number(m[2])
    if (h > 23 || min > 59) continue
    const suf = (m[3] ?? '').toLowerCase().replace(/[.\s]/g, '')
    if ((suf.startsWith('pm') || suf.includes('tarde') || suf.includes('noche')) && h < 12) h += 12
    if ((suf.startsWith('am') || suf.includes('mañana')) && h === 12) h = 0
    out.push({ crudo: m[0].trim(), minutos: h * 60 + min })
  }
  return out
}

/** ¿El mensaje está OFRECIENDO horarios? (2+ horas, o pregunta cuál prefiere) */
export function pareceOfertaDeHorarios(texto: string): boolean {
  const horas = horasEnTexto(texto)
  if (horas.length >= 2) return true
  return horas.length === 1 && /\b(cuál|cual|prefer|te sirve|te queda|disponib)\b/i.test(texto)
}

export interface Guard6Args {
  agentText: string
  hechos: {
    diasQueAtiende: string[]
    fechasDeTools: string[]
    minutosDeSlots: number[]
    huboSlots: boolean
  } | null | undefined
  /** Año de referencia para resolver "19 de agosto" (hoy, en COT). */
  anioRef: number
}

export function detectDatosSinRespaldo(args: Guard6Args): GuardResult {
  const { agentText, hechos, anioRef } = args
  if (!agentText.trim()) return { blocked: false }

  // ── 1. Fecha ↔ día de la semana. No necesita tool: es aritmética. ──
  for (const f of fechasConDiaEnTexto(agentText)) {
    // Se prueba el año de referencia y el siguiente: "5 de enero" dicho en
    // diciembre cae en el año que viene y es legítimo.
    const candidatos = [anioRef, anioRef + 1].map((y) => new Date(Date.UTC(y, f.mes, f.d, 12)))
    const alguno = candidatos.some((dt) =>
      dt.getUTCMonth() === f.mes && dt.getUTCDate() === f.d && dt.getUTCDay() === DIA_A_INDICE[f.dia])
    if (!alguno) {
      const real = candidatos[0]
      return {
        blocked: true,
        reason: 'fecha_no_cae_en_ese_dia',
        details: {
          chequeo: 1,
          dicho: f.crudo,
          dia_real: real.getUTCMonth() === f.mes && real.getUTCDate() === f.d
            ? DIAS_ES[real.getUTCDay() === 0 ? 0 : real.getUTCDay() >= 3 ? real.getUTCDay() + 1 : real.getUTCDay()]
            : 'fecha inexistente',
        },
      }
    }
  }

  // ── 2. Días afirmados vs los que devolvió la tool ──
  const afirmados = diasAfirmadosEnTexto(agentText)
  const frasesDias = (hechos?.diasQueAtiende ?? []).join(' ').toLowerCase()
  if (afirmados.length > 0 && frasesDias.trim() !== '') {
    const sobran = afirmados.filter((d) => !frasesDias.includes(d) && !frasesDias.includes(d.replace('é', 'e').replace('á', 'a')))
    if (sobran.length > 0) {
      return {
        blocked: true,
        reason: 'dias_no_devueltos_por_tool',
        details: { chequeo: 2, dias_afirmados: afirmados, dias_de_la_tool: frasesDias, sobran },
      }
    }
  }

  // ── 3. Horas ofrecidas vs slots. ACOTADO: sólo con slots y con oferta. ──
  if (hechos?.huboSlots && hechos.minutosDeSlots.length > 0 && pareceOfertaDeHorarios(agentText)) {
    const validos = new Set(hechos.minutosDeSlots)
    const fuera = horasEnTexto(agentText).filter((h) => !validos.has(h.minutos))
    if (fuera.length > 0) {
      return {
        blocked: true,
        reason: 'horas_no_ofrecidas_por_tool',
        details: {
          chequeo: 3,
          horas_dichas: fuera.map((h) => h.crudo),
          slots_de_la_tool: [...validos].sort((a, b) => a - b)
            .map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`),
        },
      }
    }
  }

  return { blocked: false }
}

// ============================================================
// GUARD 9: preparación inventada
//
// El 2026-08-21, preguntado por la preparación de una ecografía transvaginal,
// el agente contestó "vejiga llena, toma agua 1 hora antes y no orines". No
// había una sola línea de preparación cargada en la base: se la inventó. Y en
// ginecología, para ese examen, la indicación suele ser la contraria.
//
// El prompt ya lleva el texto real cuando existe y una marca de "no la sabemos"
// cuando no — pero eso es capa A. Esto es capa B: si el modelo afirma una
// indicación que NO está anclada en ninguna preparación cargada de esta
// clínica, el mensaje no sale.
//
// EL ANCLAJE ES EL CRITERIO, no una lista de frases prohibidas: por eso funciona
// también para la clínica que sí cargó sus preparaciones. Si el texto que el
// modelo escribió reproduce una preparación cargada, pasa; si no reproduce
// ninguna, es de él.
// ============================================================

/** Afirmaciones que son una INDICACIÓN previa al examen, no charla general. */
const AFIRMA_PREPARACION: RegExp[] = [
  /\bvejiga\s+(llena|vac[ií]a|desocupada)\b/i,
  /\bayun[oa]s?\b|\ben ayunas\b/i,
  /\bno\s+(tener|tengas|debes tener)\s+relaciones\b/i,
  /\b\d{1,2}\s*horas?\s+antes\b/i,
  /\b\d{1,2}\s*d[ií]as?\s+antes\b/i,
  /\bno\s+(usar|uses|aplicar|apliques)\s+(óvulos|ovulos|cremas|duchas|gel)\b/i,
  /\babstinencia\b/i,
  /\bno\s+(orines|orinar)\b/i,
  /\b(toma|tomar|beber|bebe)\s+\S{0,12}\s*(agua|l[ií]quidos?)\b/i,
  /\bdepilaci[óo]n\b|\brasurar\b/i,
  /\benema\b|\blaxante\b/i,
]

const PALABRAS_VACIAS = new Set(['de','la','el','en','y','a','que','los','las','un','una','por','para','con','no','se','su','tu','del','al','lo','es','o','antes','debe','debes','tener','si'])
function contenido(texto: string): Set<string> {
  return new Set(
    texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !PALABRAS_VACIAS.has(w))
  )
}

/** ¿Lo que el agente escribió reproduce alguna preparación cargada? */
function estaAnclada(agentText: string, preparaciones: string[]): boolean {
  const dicho = contenido(agentText)
  return preparaciones.some((p) => {
    const suyo = contenido(p)
    if (suyo.size === 0) return false
    const compartidos = [...suyo].filter((w) => dicho.has(w)).length
    // 60%: tolera que el agente reordene o resuma, no que invente otra cosa.
    return compartidos / suyo.size >= 0.6
  })
}

export function detectPreparacionInventada(args: {
  agentText: string
  /** Las preparaciones cargadas de los servicios de ESTA clínica. */
  preparacionesCargadas: string[]
}): GuardResult {
  const afirma = AFIRMA_PREPARACION.some((re) => re.test(args.agentText))
  if (!afirma) return { blocked: false }
  if (estaAnclada(args.agentText, args.preparacionesCargadas)) return { blocked: false }

  return {
    blocked: true,
    // No es un "no se puede" a secas: dice qué sigue y quién lo garantiza. El
    // caller escala, así que la promesa tiene respaldo (ver guard 7).
    replacement:
      'Prefiero no darte una indicación de preparación de memoria, porque para ' +
      'cada examen es distinta y no quiero que te prepares mal 🙏 Ya le pedí al ' +
      'consultorio que te confirme exactamente qué debes tener en cuenta y te ' +
      'escriben enseguida. ¿Te ayudo con algo más mientras tanto?',
    reason: 'preparacion_inventada',
    details: { preparaciones_cargadas: args.preparacionesCargadas.length },
  }
}

// ============================================================
// GUARD 10: afirmó un convenio sin consultarlo
//
// Medido el 2026-08-21 sobre 21 corridas contra el agente real:
// `check_eps_convenio` se llamó 4 veces, y las 4 fueron con un convenio
// INVENTADO. Con nombres que suenan a aseguradora de verdad, el modelo
// contesta de memoria — y su memoria no es el catálogo de esta clínica:
//
//   "Nueva EPS"   NO está cargada en Algia   → 4 de 4: "Sí, tenemos convenio con Nueva EPS"
//   "Plan Zafiro" sí está (dentro de un combo) → 3 de 3: "sí", también sin tool
//   "COLMEDICA"   sí está                      → 4 de 4: "sí", también sin tool
//
// O sea: acierta cuando acierta por casualidad. El sesgo es hacia el "sí", y
// un "sí" falso manda a la paciente a una clínica donde no la van a recibir
// con ese convenio.
//
// Es el mismo caso que la disponibilidad y que las citas: si el dato tiene que
// ser correcto, no puede salir de la memoria del modelo. Este guard NO le
// corrige el texto a la paciente — devuelve el turno al modelo para que llame
// la tool, igual que el guard 4 con create_appointment.
// ============================================================

/** Afirma o niega que ESTA clínica tenga convenio con alguien. */
const AFIRMA_CONVENIO: RegExp[] = [
  // "tenemos/manejamos/contamos con convenio (con X)"
  /\b(no\s+)?(tenemos|manejamos|contamos con|hay|existe)\s+(un\s+)?convenio\b/i,
  // "Sí, atendemos <Nombre>" / "Claro, aceptamos <Nombre>".
  // Sin flag /i a propósito: el nombre propio en MAYÚSCULA inicial es lo que
  // distingue "sí atendemos Nueva EPS" (afirmación sobre un convenio) de
  // "sí atendemos ginecología" (una especialidad). Por eso el prefijo lleva
  // sus dos cajas escritas a mano — con `s[ií]` a secas no matcheaba "Sí",
  // que es justamente como el modelo empieza la frase.
  /\b(?:[Ss][ií]|[Cc]laro|[Pp]or supuesto|[Ee]fectivamente)[\s,.!]{0,3}\b(?:atendemos|aceptamos|trabajamos con|recibimos|manejamos)\s+(?:pacientes\s+(?:con|de)\s+)?(?![Pp]articular)[A-ZÁÉÍÓÚÑ]/,
  // "atendemos pacientes con X" / "atendemos con X"
  /\b(?:atendemos|aceptamos|manejamos)\s+(?:pacientes\s+)?(?:con|de)\s+(?!particular|Particular)[A-ZÁÉÍÓÚÑ]/,
  // "estamos afiliados a", "somos prestadores de"
  /\b(estamos afiliados|somos prestadores|estamos adscritos)\b/i,
]

/** Frases donde "convenio" aparece SIN afirmar nada — no deben disparar. */
const NO_ES_AFIRMACION = [
  // El corte determinista de convenio no reconocido: ya escaló, está bien.
  /no tengo registrado ese convenio/i,
  // Preguntar no es afirmar.
  /¿[^?]{0,80}\bconvenio\b[^?]{0,80}\?/i,
]

export function detectConvenioSinVerificar(args: {
  agentText: string
  toolsUsed: string[]
}): GuardResult {
  if (args.toolsUsed.includes('check_eps_convenio')) return { blocked: false }
  if (NO_ES_AFIRMACION.some((re) => re.test(args.agentText))) return { blocked: false }
  if (!AFIRMA_CONVENIO.some((re) => re.test(args.agentText))) return { blocked: false }
  return {
    blocked: true,
    reason: 'convenio_sin_verificar',
    details: { tools_used: args.toolsUsed },
  }
}
