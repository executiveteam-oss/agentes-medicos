// ============================================================
// Webhook de WhatsApp — El punto de entrada de TODO el sistema
//
// FLUJO COMPLETO:
// 1. Meta/WhatsApp envía un POST con el mensaje del paciente
// 2. Procesamos el mensaje completo (Claude + DB + WhatsApp)
// 3. Respondemos 200 al terminar
//    a. Validar payload
//    b. Identificar clínica por whatsapp_phone_id
//    c. Buscar o crear paciente
//    d. Buscar o crear conversación
//    e. Guardar mensaje del paciente en DB
//    f. Si la conversación está escalada → no responder (un humano se encarga)
//    g. Si es paciente nuevo → enviar aviso de privacidad (Ley 1581)
//    h. Sanitizar mensaje → ejecutar agente → guardar respuesta → enviar por WhatsApp
//
// También maneja GET para la verificación inicial del webhook por Meta
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, markAsRead } from '@/lib/whatsapp/client'
import { sanitizePatientMessage, isSupportedMessageType, getUnsupportedTypeMessage } from '@/lib/whatsapp/sanitize'
import { verifyWebhookSignature } from '@/lib/whatsapp/verify-signature'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import { trackTokenUsage, isClinicPaused } from '@/lib/api-usage'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/utils/dates'
import { syncClinicSheet } from '@/lib/google-sheets'
import { whatsappWebhookSchema } from '@/lib/validators/whatsapp'
import type { Clinic, Doctor, Conversation, Patient, Message, WhatsAppConfig } from '@/types/database'

// Máximo tiempo de ejecución en Vercel (en segundos)
// El plan gratuito de Vercel permite hasta 60s para serverless functions
export const maxDuration = 30

// ============================================================
// GET — Verificación del webhook (Meta lo llama UNA vez al configurar)
// Meta envía un token y espera que se lo devolvamos para confirmar
// ============================================================
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Verificar que el token coincida con el nuestro
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verificación exitosa')
    // Meta espera que devolvamos el challenge como texto plano
    return new NextResponse(challenge, { status: 200 })
  }

  console.warn('[Webhook] Verificación fallida — token no coincide')
  return NextResponse.json({ error: 'Token no válido' }, { status: 403 })
}

// ============================================================
// POST — Recibe mensajes de WhatsApp
// Procesamos el mensaje ANTES de responder 200
// Meta permite hasta 15 segundos, Claude responde en ~2-3s
// ============================================================
export async function POST(request: NextRequest) {
  // 1. Leer el body como texto para verificar la firma HMAC
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  // 2. Verificar firma HMAC de Meta (X-Hub-Signature-256)
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[Webhook] Firma HMAC inválida — posible solicitud falsificada')
    return NextResponse.json({ error: 'Firma inválida' }, { status: 403 })
  }

  // 3. Rate limit por IP (general) antes de parsear
  const ip = getClientIp(request)
  const ipLimit = checkRateLimit(`webhook:ip:${ip}`, RATE_LIMITS.general)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // 4. Parsear el body
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // 5. Rate limit por teléfono del remitente (30 req/min)
  try {
    const parsed = whatsappWebhookSchema.safeParse(body)
    if (parsed.success) {
      const phone = parsed.data.entry[0]?.changes[0]?.value?.messages?.[0]?.from
      if (phone) {
        const phoneLimit = checkRateLimit(`webhook:phone:${phone}`, RATE_LIMITS.webhook)
        if (!phoneLimit.allowed) {
          console.warn(`[Webhook] Rate limit excedido para teléfono: ${phone.slice(0, 5)}***`)
          return NextResponse.json({ status: 'rate_limited' }, { status: 429 })
        }
      }
    }
  } catch { /* no bloquear si falla el rate limit check */ }

  // 6. Procesar el mensaje completo antes de responder
  //    Esto garantiza que el código se ejecuta en Vercel
  try {
    await processWebhook(body)
  } catch (error) {
    console.error('[Webhook] Error en procesamiento:', error)
  }

  // 3. Responder 200 (Meta acepta hasta 15s de espera)
  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// ============================================================
// PROCESAMIENTO PRINCIPAL — Corre en background
// ============================================================
async function processWebhook(body: unknown): Promise<void> {
  // 1. Validar el payload con Zod
  const parsed = whatsappWebhookSchema.safeParse(body)
  if (!parsed.success) {
    console.warn('[Webhook] Payload inválido:', parsed.error.message)
    return
  }

  const payload = parsed.data

  // 2. Extraer el mensaje (puede haber múltiples entries/changes, procesamos el primero)
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change

      // Ignorar actualizaciones de estado (delivered, read, etc.)
      if (!value.messages || value.messages.length === 0) {
        console.log('[Webhook] Sin mensajes (probablemente status update), ignorando')
        continue
      }

      const message = value.messages[0]
      const contact = value.contacts?.[0]
      const phoneNumberId = value.metadata.phone_number_id

      console.log(`[Webhook] Mensaje recibido — tipo: ${message.type}, de: ${message.from.slice(0, 5)}***, phone_id: ${phoneNumberId}`)

      // 3. Identificar la clínica por el phone_number_id de WhatsApp
      const clinic = await findClinicByPhoneId(phoneNumberId)
      if (!clinic) {
        console.error(`[Webhook] Clínica no encontrada para phone_id: ${phoneNumberId}`)
        return
      }
      console.log(`[Webhook] Clínica: ${clinic.name}`)

      // 3.5. Cargar configuración del agente
      const waConfig = getWhatsAppConfig(clinic)

      // 4. Obtener doctores activos (filtrados por config)
      const doctors = await findActiveDoctors(clinic.id, waConfig)
      if (doctors.length === 0) {
        console.error(`[Webhook] No hay doctor activo para clínica: ${clinic.id}`)
        return
      }
      // Doctor principal = primero (para compatibilidad)
      const doctor = doctors[0]

      // 5. Marcar mensaje como leído (checks azules ✓✓)
      await markAsRead(message.id)

      // 6. Normalizar teléfono del paciente
      const patientPhone = normalizePhone(message.from)
      const patientName = contact?.profile?.name ?? 'Paciente'
      console.log(`[Webhook] Paciente: ${patientName}, tel: ${patientPhone.slice(0, 6)}***`)

      // 7. Verificar tipo de mensaje
      if (!isSupportedMessageType(message.type)) {
        // Si es audio, imagen, etc. → responder que solo maneja texto
        const unsupportedMsg = getUnsupportedTypeMessage(message.type)
        await sendWhatsAppMessage(message.from, unsupportedMsg)
        return
      }

      // 8. Obtener el texto del mensaje
      const rawText = message.text?.body
      if (!rawText) return

      // 9. Sanitizar el mensaje (anti-inyección, límite de caracteres)
      const sanitizedText = sanitizePatientMessage(rawText)

      // 10. Buscar o crear paciente
      const patient = await findOrCreatePatient(clinic.id, patientPhone, patientName)

      // 11. Buscar o crear conversación
      const conversation = await findOrCreateConversation(clinic.id, patient.id, patientPhone)

      // 12. Cargar historial ANTES de guardar el mensaje actual
      //     Si cargamos después, el mensaje que acabamos de recibir ya estaría en DB
      //     y llegaría duplicado a Claude (una vez del historial, otra del push explícito)
      const messageHistory = await getMessageHistory(conversation.id)
      console.log(`[Webhook] Historial cargado: ${messageHistory.length} mensajes`)

      // 13. Guardar mensaje del paciente en DB (después de cargar historial)
      await saveMessage(conversation.id, 'patient', sanitizedText, message.id)

      // 14. Actualizar último mensaje de la conversación
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id)

      // 15. Si la conversación está escalada → no responder (un humano se encarga)
      if (conversation.status === 'escalated') {
        console.log(`[Webhook] Conversación escalada, no responder. ID: ${conversation.id}`)
        return
      }

      // 15.5. Detectar respuesta a recordatorio ("sí"/"no" a confirmación de cita)
      const reminderHandled = await handleReminderResponse(
        sanitizedText, patient.id, clinic.id, message.from, conversation.id
      )
      if (reminderHandled) {
        // Sync Google Sheets tras respuesta a recordatorio
        try { syncClinicSheet(clinic.id, ['appointments']) } catch { /* no crítico */ }
        return
      }

      // 16. Si es paciente nuevo (sin consentimiento) → enviar aviso de privacidad
      if (!patient.data_consent_at) {
        await handleNewPatient(clinic, patient, message.from, conversation.id)
        return
      }

      // 16.5. Verificar horario de atención (antes de invocar Claude)
      if (!isWithinOperatingHours(waConfig)) {
        const oohMsg = waConfig.schedule.out_of_hours_message
        await saveMessage(conversation.id, 'agent', oohMsg)
        await sendWhatsAppMessage(message.from, oohMsg)
        console.log(`[Webhook] Fuera de horario, mensaje automático enviado`)
        return
      }

      // 16.6. Verificar palabras clave de escalamiento
      const escalationMatch = checkEscalationKeywords(sanitizedText, waConfig)
      if (escalationMatch) {
        const escalationMsg = `Entiendo que necesitas ayuda urgente. Voy a pasar tu mensaje a alguien del consultorio para que te atienda lo antes posible. 🙏`
        await saveMessage(conversation.id, 'agent', escalationMsg)
        await sendWhatsAppMessage(message.from, escalationMsg)
        await supabaseAdmin
          .from('conversations')
          .update({ status: 'escalated', escalated_at: new Date().toISOString() })
          .eq('id', conversation.id)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'conversation_escalated',
            actor_type: 'system',
            details: { reason: `Palabra clave: "${escalationMatch}"`, urgency: 'high' },
          })
        } catch { /* no crítico */ }
        console.log(`[Webhook] Escalado por keyword: "${escalationMatch}"`)
        return
      }

      // 17. Verificar si la clínica está pausada por exceder tokens
      if (await isClinicPaused(clinic.id)) {
        const pausedMsg = 'Nuestro asistente virtual está temporalmente fuera de servicio. Por favor comunícate directamente con el consultorio.'
        await saveMessage(conversation.id, 'agent', pausedMsg)
        await sendWhatsAppMessage(message.from, pausedMsg)
        console.warn(`[Webhook] Clínica ${clinic.id} pausada — token limit excedido`)
        return
      }

      // 18. Ejecutar el agente de IA
      console.log(`[Webhook] Ejecutando agente con mensaje: "${sanitizedText.slice(0, 50)}..."`)

      const agentResponse = await runAppointmentAgent({
        patientMessage: sanitizedText,
        messageHistory,
        clinic,
        doctor,
        doctors,
        waConfig,
        patientPhone,
        patientName: patient.name,
      })
      console.log(`[Webhook] Agente respondió. Tools usadas: [${agentResponse.toolsUsed.join(', ')}]`)
      console.log(`[Webhook] Respuesta: "${agentResponse.text.slice(0, 100)}..."`)

      // 18.1. Registrar uso de tokens
      if (agentResponse.tokenUsage) {
        await trackTokenUsage(clinic.id, agentResponse.tokenUsage.input, agentResponse.tokenUsage.output)
      }

      // 19. Guardar respuesta del agente en DB
      await saveMessage(conversation.id, 'agent', agentResponse.text)

      // 19. Enviar respuesta por WhatsApp
      const sendResult = await sendWhatsAppMessage(message.from, agentResponse.text)
      if (!sendResult) {
        console.error('[Webhook] FALLÓ el envío por WhatsApp — la respuesta se guardó en DB pero el paciente no la recibió')
      }

      // 20. Si se escaló, marcar la conversación
      if (agentResponse.toolsUsed.includes('escalate_to_human')) {
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)
      }

      // 21. Registrar en auditoría
      try {
        await supabaseAdmin
          .from('audit_log')
          .insert({
            clinic_id: clinic.id,
            action: 'message_processed',
            actor_type: 'agent',
            details: {
              tools_used: agentResponse.toolsUsed,
              conversation_id: conversation.id,
            },
          })
      } catch { /* no crítico */ }
    }
  }
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

/**
 * Busca la clínica por el ID del número de WhatsApp
 * Este ID viene en cada mensaje y nos dice a qué clínica pertenece
 */
async function findClinicByPhoneId(phoneNumberId: string): Promise<Clinic | null> {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('*')
    .eq('whatsapp_phone_id', phoneNumberId)
    .single()

  return data as Clinic | null
}

/**
 * Extrae y normaliza la config de WhatsApp de la clínica
 */
function getWhatsAppConfig(clinic: Clinic): WhatsAppConfig {
  const DEFAULT: WhatsAppConfig = {
    schedule: {
      start: '07:00',
      end: '20:00',
      days: [1, 2, 3, 4, 5, 6],
      out_of_hours_message: 'Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana.',
    },
    appointment: { default_duration: 30, max_duration: 60 },
    escalation_keywords: ['urgencia', 'dolor', 'emergencia', 'hablar con alguien', 'médico', 'sangrado'],
    doctors: {},
  }
  return (clinic.whatsapp_config as WhatsAppConfig | null) ?? DEFAULT
}

/**
 * Verifica si la hora actual (Colombia) está dentro del horario de atención
 */
function isWithinOperatingHours(config: WhatsAppConfig): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const currentDay = now.getDay() // 0=dom, 1=lun, ..., 6=sáb

  if (!config.schedule.days.includes(currentDay)) return false

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = config.schedule.start.split(':').map(Number)
  const [endH, endM] = config.schedule.end.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

/**
 * Verifica si el mensaje contiene alguna palabra clave de escalamiento
 * Retorna la keyword encontrada o null
 */
function checkEscalationKeywords(message: string, config: WhatsAppConfig): string | null {
  const normalized = message.toLowerCase()
  for (const keyword of config.escalation_keywords) {
    if (normalized.includes(keyword.toLowerCase())) {
      return keyword
    }
  }
  return null
}

/**
 * Obtiene doctores activos, filtrando por la config de WhatsApp
 * Si un doctor está marcado como inactivo en config.doctors, se excluye
 */
async function findActiveDoctors(clinicId: string, config: WhatsAppConfig): Promise<Doctor[]> {
  const { data } = await supabaseAdmin
    .from('doctors')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const allDoctors = (data ?? []) as Doctor[]

  // Filtrar por config: si doctor tiene config explícita con active=false, excluir
  return allDoctors.filter((doc) => {
    const docConfig = config.doctors[doc.id]
    return docConfig ? docConfig.active : true
  })
}

/**
 * Busca un paciente por teléfono. Si no existe, lo crea.
 * Los pacientes se crean automáticamente cuando escriben por primera vez.
 */
async function findOrCreatePatient(
  clinicId: string,
  phone: string,
  name: string
): Promise<Patient> {
  // Buscar paciente existente
  const { data: existing } = await supabaseAdmin
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()

  if (existing) return existing as Patient

  // Crear paciente nuevo
  const { data: newPatient, error } = await supabaseAdmin
    .from('patients')
    .insert({
      clinic_id: clinicId,
      name,
      phone,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[findOrCreatePatient] Error:', error)
    throw new Error('Error creando paciente')
  }

  // Registrar en auditoría
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'patient_registered',
        actor_type: 'system',
        target_type: 'patient',
        target_id: newPatient.id,
        details: { source: 'whatsapp_auto' },
      })
  } catch { /* no crítico */ }

  return newPatient as Patient
}

/**
 * Busca una conversación activa. Si no existe, crea una nueva.
 * Cada paciente tiene UNA conversación activa por clínica.
 */
async function findOrCreateConversation(
  clinicId: string,
  patientId: string,
  phone: string
): Promise<Conversation> {
  // Buscar conversación activa o escalada
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .in('status', ['active', 'escalated'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) return existing as Conversation

  // Crear conversación nueva
  const { data: newConversation, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      whatsapp_phone: phone,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[findOrCreateConversation] Error:', error)
    throw new Error('Error creando conversación')
  }

  return newConversation as Conversation
}

/**
 * Guarda un mensaje en la base de datos
 */
async function saveMessage(
  conversationId: string,
  role: 'patient' | 'agent' | 'staff',
  content: string,
  whatsappMessageId?: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      whatsapp_message_id: whatsappMessageId ?? null,
    })

  if (error) {
    console.error('[saveMessage] Error:', error)
  }
}

/**
 * Carga los últimos 20 mensajes de una conversación (contexto para Claude)
 *
 * Ordenamos DESCENDENTE y limitamos a 20 para obtener los MÁS RECIENTES,
 * luego revertimos al orden cronológico. Si usáramos ascending+limit(20)
 * obtendríamos los primeros 20 (los más viejos), perdiendo el contexto reciente.
 */
async function getMessageHistory(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }) // más recientes primero
    .limit(20)

  if (error) {
    console.error('[getMessageHistory] Error:', error)
    return []
  }

  // Revertir para que Claude reciba el historial en orden cronológico
  return ((data ?? []) as Message[]).reverse()
}

/**
 * Maneja el primer mensaje de un paciente nuevo:
 * 1. Envía aviso de privacidad (Ley 1581 de 2012)
 * 2. Marca el consentimiento en la DB
 * 3. Envía el mensaje de bienvenida
 *
 * Nota: en un sistema más robusto, esperaríamos confirmación explícita.
 * Para el MVP, "continuar la conversación" = aceptar.
 */
async function handleNewPatient(
  clinic: Clinic,
  patient: Patient,
  whatsappFrom: string,
  conversationId: string
): Promise<void> {
  // Aviso de privacidad (obligatorio por Ley 1581)
  const privacyNotice =
    `📋 Antes de continuar, te informo que ${clinic.name} tratará tus datos personales ` +
    `según la Ley 1581 de 2012. Al continuar esta conversación, autorizas el tratamiento ` +
    `de tus datos para agendar y gestionar tus citas. Si deseas conocer nuestra política ` +
    `completa o ejercer tus derechos, escribe "privacidad".`

  await sendWhatsAppMessage(whatsappFrom, privacyNotice)
  await saveMessage(conversationId, 'agent', privacyNotice)

  // Marcar consentimiento (al continuar = acepta)
  await supabaseAdmin
    .from('patients')
    .update({ data_consent_at: new Date().toISOString() })
    .eq('id', patient.id)

  // Mensaje de bienvenida
  const welcome = clinic.welcome_message
    ?? `¡Hola! 👋 Soy ${clinic.agent_name}, asistente virtual de ${clinic.name}. ¿En qué te puedo ayudar?`

  await sendWhatsAppMessage(whatsappFrom, welcome)
  await saveMessage(conversationId, 'agent', welcome)
}

/**
 * Detecta si el paciente está respondiendo a un recordatorio de cita
 * Busca citas con recordatorio enviado pero sin confirmar
 * Si el mensaje es "sí"/"no", procesa la confirmación
 * @returns true si se manejó como respuesta a recordatorio
 */
async function handleReminderResponse(
  messageText: string,
  patientId: string,
  clinicId: string,
  whatsappFrom: string,
  conversationId: string
): Promise<boolean> {
  // Normalizar respuesta
  const normalized = messageText.toLowerCase().trim()

  // Solo procesar si parece una respuesta de confirmación
  const isConfirmation = /^(s[ií]|si|yes|confirmo|confirmar|dale|claro|ok|listo)$/i.test(normalized)
  const isCancellation = /^(no|cancelar|cancelo|no puedo)$/i.test(normalized)

  if (!isConfirmation && !isCancellation) return false

  // Buscar citas con recordatorio enviado pero sin confirmar
  const { data: pendingAppointment } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('reminder_24h_sent', true)
    .is('reminder_confirmed', null)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .single()

  if (!pendingAppointment) return false // No hay recordatorio pendiente

  if (isConfirmation) {
    // Marcar como confirmada
    await supabaseAdmin
      .from('appointments')
      .update({ reminder_confirmed: true, confirmation_received: true })
      .eq('id', pendingAppointment.id)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('appointment_id', pendingAppointment.id)
      .eq('type', '24h')

    const response = '✅ ¡Perfecto, tu cita está confirmada! Te esperamos. Si necesitas algo más, escríbeme.'
    await saveMessage(conversationId, 'agent', response)
    await sendWhatsAppMessage(whatsappFrom, response)

    console.log(`[Webhook] Recordatorio CONFIRMADO para cita ${pendingAppointment.id}`)
  } else {
    // Marcar como no confirmada
    await supabaseAdmin
      .from('appointments')
      .update({ reminder_confirmed: false })
      .eq('id', pendingAppointment.id)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'cancelled' })
      .eq('appointment_id', pendingAppointment.id)
      .eq('type', '24h')

    const response = '😔 Entendido. ¿Te gustaría reagendar tu cita para otro día? Escríbeme la fecha que prefieras.'
    await saveMessage(conversationId, 'agent', response)
    await sendWhatsAppMessage(whatsappFrom, response)

    console.log(`[Webhook] Recordatorio RECHAZADO para cita ${pendingAppointment.id}`)
  }

  // Recalcular probabilidad de no-show
  const { calculateNoShowProbability } = await import('@/lib/utils/noshow')
  await calculateNoShowProbability(patientId, clinicId)

  return true
}
