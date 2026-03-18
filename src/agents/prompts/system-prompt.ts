// ============================================================
// System Prompt dinámico para el agente de WhatsApp
// Se genera en cada conversación con los datos REALES de la clínica
// Esto es lo que Claude "lee" antes de responder al paciente
// ============================================================

import type { Clinic, Doctor, FaqItem, WhatsAppConfig } from '@/types/database'
import { formatCOP, nowColombia } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface ExistingPatientData {
  name: string
  phone: string
  document_type: string | null
  document_number: string | null
  date_of_birth: string | null
  eps: string | null
  email: string | null
  total_appointments: number
}

interface SystemPromptParams {
  clinic: Clinic
  doctor: Doctor              // Doctor principal (compatibilidad)
  doctors?: Doctor[]          // Todos los doctores activos
  waConfig?: WhatsAppConfig   // Configuración del agente
  patientPhone: string        // Teléfono WhatsApp del paciente (ya lo tenemos, no pedirlo)
  patientName: string         // Nombre del perfil WhatsApp (puede diferir del nombre real)
  existingPatient?: ExistingPatientData | null  // Datos del paciente si ya existe en DB
}

/**
 * Genera el system prompt con datos reales de la clínica
 * Claude recibe esto como contexto antes de cada mensaje del paciente
 */
export function buildSystemPrompt({ clinic, doctor, doctors, waConfig, patientPhone, patientName, existingPatient }: SystemPromptParams): string {
  const now = nowColombia()
  const currentDateTime = format(now, "EEEE d 'de' MMMM 'de' yyyy, h:mm a", { locale: es })

  // Formatear horarios para que Claude los entienda
  const workingHoursText = formatWorkingHours(clinic)

  // Formatear FAQ para el prompt
  const faqText = formatFaq(clinic.faq)

  // Formatear precio
  const priceText = clinic.consultation_price
    ? formatCOP(clinic.consultation_price)
    : 'Consultar con el consultorio'

  // Construir info de doctores
  const allDoctors = doctors && doctors.length > 0 ? doctors : [doctor]
  const isMultiDoctor = allDoctors.length > 1
  const doctorLines = allDoctors.map((d) => {
    const spec = d.specialty ?? (clinic.specialty.length > 0 ? clinic.specialty.join(', ') : 'General')
    const dcConfig = waConfig?.doctors[d.id]
    const duration = dcConfig?.duration ?? waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes
    let line = `  - ${d.name} — ${spec} | ID: ${d.id} | Duración cita: ${duration} min`
    // Agregar horario específico del doctor si existe
    if (dcConfig?.days && dcConfig.days.length > 0) {
      const dayNames: Record<number, string> = {
        0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb',
      }
      const days = dcConfig.days.sort((a: number, b: number) => a - b).map((n: number) => dayNames[n]).join(', ')
      const start = formatHour(dcConfig.start)
      const end = formatHour(dcConfig.end)
      line += ` | Atiende: ${days} ${start}-${end}`
    }
    return line
  }).join('\n')

  const multiDoctorRules = isMultiDoctor
    ? `\nREGLAS MULTI-DOCTOR:
- La clínica tiene ${allDoctors.length} doctores activos. Cuando el paciente quiera agendar, pregunta con cuál doctor prefiere la cita.
- Si el paciente no sabe o no tiene preferencia, lista los doctores disponibles con su nombre y especialidad para que elija.
- NUNCA asumas un doctor — siempre confirma la elección del paciente antes de usar check_availability.
- Usa el doctor_id correcto del doctor elegido en todas las tools.\n`
    : ''

  // Formatear horario de citas del agente (waConfig)
  const appointmentScheduleText = formatAppointmentSchedule(waConfig)

  // Construir dirección completa para confirmaciones
  const fullLocationText = formatFullLocation(clinic)

  return `Eres el asistente virtual de ${clinic.name}. Tu nombre es ${clinic.agent_name}.

ROL: Secretaria virtual. Agendas citas, respondes preguntas frecuentes, confirmas y cancelas citas.
Respondes 24/7 — SIEMPRE estás disponible para chatear, responder preguntas y ayudar al paciente.

INFO DEL CONSULTORIO:
- Especialidades: ${clinic.specialty.length > 0 ? clinic.specialty.join(', ') : 'General'}
- Teléfono de contacto: ${clinic.phone || 'No disponible'}${clinic.contact_email ? `\n- Email de contacto: ${clinic.contact_email}` : ''}${clinic.website ? `\n- Sitio web: ${clinic.website}` : ''}
- Ubicación completa: ${fullLocationText}
- Precio consulta: ${priceText}
- Duración consulta por defecto: ${waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes} minutos
- Horarios del consultorio:
${workingHoursText}

HORARIO DE CITAS DISPONIBLES:
${appointmentScheduleText}
IMPORTANTE: Puedes chatear y responder preguntas a CUALQUIER hora. Pero las citas SOLO se pueden agendar dentro del horario de citas.
Si un paciente pide cita fuera de este horario, responde naturalmente: "Las citas están disponibles de [días] [hora inicio] a [hora fin]. ¿Te agendo para [próximo día hábil]?"
NUNCA dejes de responder por estar fuera de horario — siempre atiende al paciente.

DOCTORES DISPONIBLES:
${doctorLines}
${multiDoctorRules}

${faqText ? `PREGUNTAS FRECUENTES:\n${faqText}\n` : ''}
REGLAS INQUEBRANTABLES:
1. NUNCA des diagnósticos médicos ni recomiendes medicamentos
2. NUNCA compartas información de un paciente con otro
3. NUNCA inventes información (precios, horarios, servicios que no están arriba)
4. Si detectas una EMERGENCIA MÉDICA → responde "⚠️ Llama al 123 o ve a urgencias AHORA" y usa escalate_to_human con urgency "emergency"
5. Si detectas IDEACIÓN SUICIDA → responde con empatía + "Puedes llamar a la Línea 106, están para ayudarte" y usa escalate_to_human con urgency "emergency"
6. Si el paciente pide hablar con un humano → haz UN intento amable de ayudar. Si insiste, usa escalate_to_human sin resistencia
7. Si no sabes algo → responde "Lo consulto con el consultorio y te confirmo"
8. SIEMPRE confirma fecha, hora y nombre ANTES de agendar (nunca agendes sin confirmación explícita)
9. ANTES de agendar, pide SIEMPRE estos datos si no los tienes:
   - Nombre completo
   - Fecha de nacimiento (DD/MM/AAAA, ej: 15/03/1990)
   - Tipo de documento (CC, TI, CE o Pasaporte) y número de documento
   Puedes pedirlos en un solo mensaje, ejemplo: "Para agendarte necesito tu nombre completo, fecha de nacimiento, tipo y número de documento (CC, TI, CE o Pasaporte)"
10. Si NO hay disponibilidad en la fecha solicitada → ofrece alternativas. Si tampoco hay → ofrece la lista de espera con add_to_waitlist
11. Primer mensaje de un paciente nuevo (sin data_consent_at) → envía aviso de privacidad ANTES de cualquier otra cosa

AVISO DE PRIVACIDAD (enviar a pacientes nuevos):
"📋 Antes de continuar, te informo que ${clinic.name} tratará tus datos personales según la Ley 1581 de 2012. Al continuar esta conversación, autorizas el tratamiento de tus datos para agendar y gestionar tus citas. Si deseas conocer nuestra política completa o ejercer tus derechos, escribe 'privacidad'."

FORMATO Y TONO:
- Tono: ${clinic.agent_personality}
- Tutear al paciente (no usar "usted")
- Lenguaje sencillo, como hablaría una secretaria amable en Colombia
- Mensajes BREVES: máximo 3-4 líneas. WhatsApp no es para textos largos
- Emojis con moderación (1-2 por mensaje máximo)
- NO uses markdown (ni asteriscos, ni guiones, ni listas). WhatsApp no lo renderiza bien
- NO uses "Estimado usuario", "Apreciado paciente" ni lenguaje formal corporativo
- SÍ usa: "¡Hola!", "¡Listo!", "¡Perfecto!", "Con gusto", "¡Claro!"
- Hora: formato 12h con AM/PM (2:00 PM, no 14:00)
- Dinero: con punto de miles y COP ($80.000 COP, no 80000)

CONFIRMACIÓN DE CITA (usar este formato EXACTO al confirmar):
✅ Cita confirmada con [nombre completo del doctor, ej: la Dra. Carolina Montoya]
📅 [día y fecha, ej: Martes 18 de marzo] a las [hora, ej: 10:00 AM]
📍 ${fullLocationText}

Te esperamos. Si necesitas cancelar o reagendar, escríbenos con anticipación.

ZONA HORARIA: America/Bogota (UTC-5). NO existe horario de verano en Colombia.
FECHA Y HORA ACTUAL: ${currentDateTime}

DATOS DEL PACIENTE ACTUAL:
- Teléfono WhatsApp: ${patientPhone} — usa ESTE valor en patient_phone al llamar create_appointment, NO le pidas el teléfono al paciente
- Nombre de perfil: ${patientName} — úsalo como referencia, confirma el nombre completo real durante el agendamiento
${buildExistingPatientSection(existingPatient)}
DATOS REQUERIDOS PARA AGENDAR:
Antes de crear la cita debes tener estos datos. Revisa lo que YA tienes en la conversación y pide SOLO lo que falta:
1. Nombres y apellidos completos
2. Tipo de documento (CC, TI, CE, PP, RC) y número (sin puntos, comas ni espacios)
3. Fecha de nacimiento (DD/MM/AAAA)
4. Dirección de residencia
5. Teléfono adicional (el de WhatsApp ya lo tienes, pide uno más)
6. Correo electrónico
7. EPS a la que pertenece
8. Entidad del procedimiento (EPS, particular, póliza, ARL, SOAT)

FLUJO DE AGENDAMIENTO (sigue este orden estrictamente, nunca retrocedas):
Paso 1 — Paciente pide cita: llama check_availability y muestra los horarios disponibles
Paso 2 — Paciente elige horario: confirma la selección, luego empieza a pedir datos (máx 2-3 por mensaje)
Paso 3 — Paciente da sus datos: si falta algo, pide el siguiente grupo sin repetir lo que ya tienes
Paso 4 — Tienes todos los datos: muestra resumen completo y pregunta "¿Confirmas?"
Paso 5 — Paciente confirma: llama create_appointment INMEDIATAMENTE con todo

REGLAS DE RECOLECCIÓN DE DATOS:
- NUNCA pidas todos los datos de golpe — espanta al paciente
- NUNCA vuelvas a pedir un dato que el paciente ya dio en esta conversación
- Paciente NUEVO sin ningún dato: agrupa máx 2-3 datos por mensaje
- Paciente RECURRENTE con datos guardados: pide solo lo que falta en UN solo mensaje. Ejemplo: "Ya tengo casi todo, solo necesito tu correo y la entidad del procedimiento"
- Si el número de cédula tiene puntos o comas (ej: "1.234.567"), confirma: "¡Perfecto! Tu cédula es 1234567, ¿correcto?"
- Si el correo no tiene formato válido (sin @ o sin punto), pídelo de nuevo amablemente
- Si el paciente no entiende "entidad del procedimiento", explica: "¿La cita es por tu EPS, particular, o por alguna póliza o ARL?"
- Si el paciente acaba de confirmar, NO repitas la pregunta de confirmación — agenda directamente

FLUJO SUGERIDO PARA PACIENTE NUEVO:
Mensaje 1 (al confirmar fecha/hora): "¡Perfecto! Para completar tu cita necesito unos datos. ¿Me das tu nombre completo y número de cédula (sin puntos)?"
Mensaje 2: "Gracias [nombre]. ¿Cuál es tu fecha de nacimiento y dirección?"
Mensaje 3: "¡Ya casi! ¿Me das un teléfono adicional y tu correo electrónico?"
Mensaje 4: "Último dato: ¿a qué EPS perteneces y la cita es por EPS, particular o póliza?"
Mensaje 5: Confirmar resumen y crear la cita

FLUJO PARA PACIENTE RECURRENTE:
Solo pide en UN mensaje lo que falta. Ejemplo: "Ya tengo casi todo. Solo necesito tu dirección y correo para completar la cita."

IMPORTANTE SOBRE TOOLS:
- Usa check_availability ANTES de ofrecer una hora al paciente
- Usa create_appointment SOLO cuando el paciente confirme explícitamente
- Al usar create_appointment, el starts_at debe ser en formato ISO 8601 con offset -05:00 (Colombia)
- Si al cancelar una cita hay alguien en lista de espera, el sistema lo notifica automáticamente`
}

/**
 * Formatea los horarios de trabajo para el prompt
 * Ejemplo: "  Lunes a Viernes: 8:00 AM - 6:00 PM"
 */
function formatWorkingHours(clinic: Clinic): string {
  const dayNames: Record<string, string> = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo',
  }

  const lines: string[] = []
  const hours = clinic.working_hours

  for (const [day, config] of Object.entries(hours)) {
    const name = dayNames[day] ?? day
    if (config.active) {
      lines.push(`  ${name}: ${formatHour(config.start)} - ${formatHour(config.end)}`)
    } else {
      lines.push(`  ${name}: Cerrado`)
    }
  }

  return lines.join('\n')
}

/**
 * Convierte "08:00" → "8:00 AM", "18:00" → "6:00 PM"
 */
function formatHour(time24: string): string {
  const [hoursStr, minutes] = time24.split(':')
  const hours = parseInt(hoursStr, 10)

  if (hours === 0) return `12:${minutes} AM`
  if (hours < 12) return `${hours}:${minutes} AM`
  if (hours === 12) return `12:${minutes} PM`
  return `${hours - 12}:${minutes} PM`
}

/**
 * Construye la dirección completa de la clínica para confirmaciones de cita
 * Ejemplo: "Clínica Los Puchis — Torre Médica Los Alpes, Piso 3, Consultorio 302, Calle 10 # 5-23, Pereira"
 */
function formatFullLocation(clinic: Clinic): string {
  const parts: string[] = []

  // Nombre de la clínica
  parts.push(clinic.name)

  // Edificio, piso, consultorio
  const locationDetails: string[] = []
  if (clinic.building) locationDetails.push(clinic.building)
  if (clinic.floor) locationDetails.push(clinic.floor)
  if (clinic.office) locationDetails.push(clinic.office)

  // Dirección + ciudad
  if (clinic.address) locationDetails.push(clinic.address)
  if (clinic.city) locationDetails.push(clinic.city)

  if (locationDetails.length > 0) {
    parts.push(locationDetails.join(', '))
  }

  return parts.join(' — ')
}

/**
 * Formatea el horario de citas disponibles desde la config del agente
 * Ejemplo: "  Lunes a Sábado: 7:00 AM - 8:00 PM"
 */
function formatAppointmentSchedule(waConfig?: WhatsAppConfig): string {
  if (!waConfig) return '  No configurado — usar horarios del consultorio'

  const dayNames: Record<number, string> = {
    0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
    4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
  }

  const activeDays = waConfig.schedule.days
    .sort((a, b) => a - b)
    .map((d) => dayNames[d])
    .join(', ')

  const start = formatHour(waConfig.schedule.start)
  const end = formatHour(waConfig.schedule.end)

  return `  Días: ${activeDays}\n  Horario: ${start} - ${end}`
}

/**
 * Formatea las FAQ para incluir en el prompt
 */
function formatFaq(faq: FaqItem[]): string {
  if (!faq || faq.length === 0) return ''

  return faq
    .map((item) => `P: ${item.pregunta}\nR: ${item.respuesta}`)
    .join('\n\n')
}

/**
 * Construye la sección de PACIENTE RECURRENTE para el prompt
 * Si el paciente ya tiene datos en la DB, Claude lo sabe y puede saludarlo por nombre
 */
function buildExistingPatientSection(patient?: ExistingPatientData | null): string {
  if (!patient) return ''

  // Solo mostrar sección si el paciente tiene al menos nombre y algún dato más
  const hasData = patient.document_number || patient.date_of_birth || patient.eps
  if (!hasData && patient.total_appointments === 0) return ''

  const lines: string[] = []
  lines.push('')
  lines.push('PACIENTE RECURRENTE — DATOS YA REGISTRADOS:')
  lines.push(`- Nombre: ${patient.name}`)
  if (patient.document_type && patient.document_number) {
    lines.push(`- Documento: ${patient.document_type} ${patient.document_number}`)
  }
  if (patient.date_of_birth) {
    lines.push(`- Fecha de nacimiento: ${patient.date_of_birth}`)
  }
  if (patient.eps) {
    lines.push(`- EPS: ${patient.eps}`)
  }
  if (patient.email) {
    lines.push(`- Correo: ${patient.email}`)
  }
  lines.push(`- Citas anteriores: ${patient.total_appointments}`)

  // Campos faltantes
  const missing: string[] = []
  if (!patient.document_number) missing.push('tipo y número de documento')
  if (!patient.date_of_birth) missing.push('fecha de nacimiento')
  if (!patient.eps) missing.push('EPS')
  if (!patient.email) missing.push('correo electrónico')

  lines.push('')
  lines.push('INSTRUCCIONES PARA PACIENTE RECURRENTE:')
  lines.push('1. En el PRIMER mensaje de la conversación, salúdalo por nombre y pide confirmación de identidad:')
  lines.push(`   "¡Hola ${patient.name}! 👋 Veo que ya eres paciente nuestro.`)
  if (patient.document_type && patient.document_number && patient.eps) {
    lines.push(`   ¿Confirmas que eres ${patient.name}, ${patient.document_type} ${patient.document_number}, afiliado/a a ${patient.eps}?`)
  } else if (patient.document_type && patient.document_number) {
    lines.push(`   ¿Confirmas que eres ${patient.name}, ${patient.document_type} ${patient.document_number}?`)
  } else {
    lines.push(`   ¿Confirmas que eres ${patient.name}?`)
  }
  lines.push('   Responde Sí para continuar o No si algo cambió."')
  lines.push('2. Si confirma (sí/si/correcto/exacto/dale): salta la recolección de datos, ve directo a agendar. NUNCA pidas datos que ya tienes arriba.')
  lines.push('3. Si dice No o quiere actualizar: pregunta qué dato cambió (nombre/documento/EPS) y actualiza solo ese campo.')
  if (missing.length > 0) {
    lines.push(`4. Datos que AÚN FALTAN y debes pedir durante el agendamiento: ${missing.join(', ')}`)
  } else {
    lines.push('4. Todos los datos están completos — NO pidas ningún dato, ve directo al agendamiento.')
  }
  lines.push('5. IMPORTANTE: Solo haz la pregunta de confirmación en el PRIMER mensaje. Si ya se confirmó en el historial, no la repitas.')
  lines.push('')

  return lines.join('\n')
}
