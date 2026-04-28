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
import type { ClinicWhatsAppCredentials } from '@/lib/whatsapp/client'
import { sanitizePatientMessage, isSupportedMessageType, isDocumentMediaType, getUnsupportedTypeMessage } from '@/lib/whatsapp/sanitize'
import { verifyWebhookSignature } from '@/lib/whatsapp/verify-signature'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import { trackTokenUsage, isClinicPaused } from '@/lib/api-usage'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/utils/dates'
import { syncClinicSheet } from '@/lib/google-sheets'
import { notifyEscalationContact } from '@/lib/whatsapp/escalation-notify'
import { whatsappWebhookSchema } from '@/lib/validators/whatsapp'
import type { Clinic, ConsultationType, Doctor, Conversation, Patient, Message, WhatsAppConfig } from '@/types/database'

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

  if (mode !== 'subscribe' || !token || !challenge) {
    console.warn('[Webhook] Verificación fallida — parámetros incompletos')
    return NextResponse.json({ error: 'Token no válido' }, { status: 403 })
  }

  // Verificar contra el token global (env) O contra tokens de clínicas individuales
  const globalToken = process.env.WHATSAPP_VERIFY_TOKEN
  let tokenValid = token === globalToken

  if (!tokenValid) {
    // Buscar si alguna clínica tiene este verify token
    const { data: clinicMatch } = await supabaseAdmin
      .from('clinics')
      .select('id')
      .eq('whatsapp_verify_token', token)
      .limit(1)
      .maybeSingle()
    tokenValid = !!clinicMatch
  }

  if (tokenValid) {
    console.log('[Webhook] Verificación exitosa')
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
  //    Intentar extraer phone_number_id del body para usar app_secret de la clínica
  let clinicAppSecret: string | null = null
  try {
    const parsed = JSON.parse(rawBody)
    const phoneNumberId = parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
    if (phoneNumberId) {
      const { data } = await supabaseAdmin
        .from('clinics')
        .select('whatsapp_app_secret')
        .eq('whatsapp_phone_id', phoneNumberId)
        .maybeSingle()
      clinicAppSecret = data?.whatsapp_app_secret ?? null
    }
  } catch { /* no bloquear si falla */ }

  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature, clinicAppSecret)) {
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

      // 3.2. Construir credenciales WhatsApp de la clínica (si las tiene, sino usa env vars)
      const clinicCreds: ClinicWhatsAppCredentials | null =
        clinic.whatsapp_access_token && clinic.whatsapp_phone_id
          ? { phoneNumberId: clinic.whatsapp_phone_id, accessToken: clinic.whatsapp_access_token }
          : null

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

      // 4.5. Cargar tipos de consulta activos de la clínica
      const consultationTypes = await findActiveConsultationTypes(clinic.id)

      // 5. Marcar mensaje como leído (checks azules ✓✓)
      await markAsRead(message.id, clinicCreds)

      // 6. Normalizar teléfono del paciente
      const patientPhone = normalizePhone(message.from)
      const patientName = contact?.profile?.name ?? 'Paciente'
      console.log(`[Webhook] Paciente: ${patientName}, tel: ${patientPhone.slice(0, 6)}***`)

      // 7. Buscar o crear paciente (necesario antes de verificar docs pendientes)
      const patient = await findOrCreatePatient(clinic.id, patientPhone, patientName)

      // 7.1. Verificar si el paciente tiene documentos pendientes (para aceptar media)
      const hasDocsPending = await patientHasPendingDocuments(patient.id, clinic.id)

      // 7.2. Si es media (image/document) y hay docs pendientes → marcar como recibidos
      if (isDocumentMediaType(message.type) && hasDocsPending) {
        const conversation = await findOrCreateConversation(clinic.id, patient.id, patientPhone)
        await handleDocumentReceived(patient.id, clinic.id, message.from, conversation.id, patient.name, clinicCreds)
        return
      }

      // 7.3. Verificar tipo de mensaje
      if (!isSupportedMessageType(message.type, hasDocsPending)) {
        // Si es audio, imagen, etc. → responder que solo maneja texto
        const unsupportedMsg = getUnsupportedTypeMessage(message.type)
        await sendWhatsAppMessage(message.from, unsupportedMsg, clinicCreds)
        return
      }

      // 8. Obtener el texto del mensaje
      const rawText = message.text?.body
      if (!rawText) return

      // 9. Sanitizar el mensaje (anti-inyección, límite de caracteres)
      const sanitizedText = sanitizePatientMessage(rawText)

      // 10. Buscar o crear conversación
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
        sanitizedText, patient.id, clinic.id, message.from, conversation.id, clinicCreds
      )
      if (reminderHandled) {
        // Sync Google Sheets tras respuesta a recordatorio
        try { syncClinicSheet(clinic.id, ['appointments']) } catch { /* no crítico */ }
        return
      }

      // 15.7. Detectar respuesta NPS (número 1-10 tras followup post-consulta)
      const npsHandled = await handleNpsResponse(
        sanitizedText, patient.id, clinic.id, message.from, conversation.id, patient.name, clinicCreds
      )
      if (npsHandled) return

      // 16. Si es paciente nuevo (sin consentimiento) → enviar aviso de privacidad
      if (!patient.data_consent_at) {
        await handleNewPatient(clinic, patient, message.from, conversation.id, clinicCreds)
        return
      }

      // 16.5. Verificar palabras clave de escalamiento
      const escalationMatch = checkEscalationKeywords(sanitizedText, waConfig)
      if (escalationMatch) {
        const escalationMsg = `Entiendo que necesitas ayuda urgente. Voy a pasar tu mensaje a alguien del consultorio para que te atienda lo antes posible. 🙏`
        await saveMessage(conversation.id, 'agent', escalationMsg)
        await sendWhatsAppMessage(message.from, escalationMsg, clinicCreds)
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

        // Notificar al contacto de escalamiento
        notifyEscalationContact({
          clinicId: clinic.id,
          patientName: patient.name,
          patientPhone: message.from,
          lastPatientMessage: sanitizedText,
          clinicCreds,
        })

        console.log(`[Webhook] Escalado por keyword: "${escalationMatch}"`)
        return
      }

      // 17. Verificar si la clínica está pausada por exceder tokens
      if (await isClinicPaused(clinic.id)) {
        const pausedMsg = 'Nuestro asistente virtual está temporalmente fuera de servicio. Por favor comunícate directamente con el consultorio.'
        await saveMessage(conversation.id, 'agent', pausedMsg)
        await sendWhatsAppMessage(message.from, pausedMsg, clinicCreds)
        console.warn(`[Webhook] Clínica ${clinic.id} pausada — token limit excedido`)
        return
      }

      // 18. Ejecutar el agente de IA
      console.log(`[Webhook] Ejecutando agente con mensaje: "${sanitizedText.slice(0, 50)}..."`)

      // Construir datos de paciente recurrente (si tiene datos registrados)
      const existingPatient = (patient.data_consent_at && (patient.document_number || patient.total_appointments > 0))
        ? {
            name: patient.name,
            phone: patient.phone,
            document_type: patient.document_type,
            document_number: patient.document_number,
            date_of_birth: patient.date_of_birth,
            eps: patient.eps,
            email: patient.email,
            total_appointments: patient.total_appointments ?? 0,
            no_show_count: patient.no_show_count ?? 0,
          }
        : null

      let agentResponse: { text: string; toolsUsed: string[]; tokenUsage?: { input: number; output: number } }

      try {
        agentResponse = await runAppointmentAgent({
          patientMessage: sanitizedText,
          messageHistory,
          clinic,
          doctor,
          doctors,
          waConfig,
          consultationTypes,
          patientPhone,
          patientName: patient.name,
          existingPatient,
        })
      } catch (agentError) {
        // Claude API falló (rate limit, 500, network, etc.)
        // El paciente DEBE recibir un mensaje — nunca dejarlo sin respuesta.
        const errMsg = agentError instanceof Error ? agentError.message : String(agentError)
        console.error(`[Webhook] ❌ AGENTE FALLÓ: ${errMsg}`)
        console.error(`[Webhook] Stack:`, agentError instanceof Error ? agentError.stack : '')

        const fallbackText = 'Disculpa, estoy teniendo dificultades técnicas en este momento. Intenta de nuevo en unos minutos o escribe "hablar con humano" si es urgente. 🙏'

        // Intentar enviar el fallback por WhatsApp
        try {
          await sendWhatsAppMessage(message.from, fallbackText, clinicCreds)
        } catch (sendErr) {
          console.error('[Webhook] Fallback WhatsApp también falló:', sendErr instanceof Error ? sendErr.message : sendErr)
        }

        // Guardar en DB para que staff vea qué pasó
        try { await saveMessage(conversation.id, 'agent', fallbackText) } catch { /* */ }
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'agent_error',
            actor_type: 'agent',
            details: { error: errMsg, conversation_id: conversation.id, patient_message: sanitizedText.slice(0, 200) },
          })
        } catch { /* */ }

        // No re-throw — el webhook debe retornar 200 a Meta
        return
      }

      console.log(`[Webhook] Agente respondió. Tools usadas: [${agentResponse.toolsUsed.join(', ')}]`)

      // POST-CITA LOCKOUT DEFENSIVO:
      // Bloquea si el agente intenta re-agendar tras una cita confirmada,
      // SALVO que el paciente haya pedido explícitamente otra cita.
      const recentAgentMsgs = messageHistory.filter((m) => m.role === 'agent').slice(-5)
      const recentPatientMsgs = messageHistory.filter((m) => m.role === 'patient').slice(-10)
      const alreadyConfirmed = recentAgentMsgs.some((m) => m.content.includes('✅') && /cita (confirmada|agendada|creada)/i.test(m.content))
      const patientAskedForAnother = recentPatientMsgs.some((m) => {
        const t = m.content.toLowerCase()
        return /otra (cita|consulta)|adicional|una m[aá]s|tambi[eé]n.*cita|agendar otra|otra para/i.test(t)
      })
      const agentAskedAboutAnother = recentAgentMsgs.some((m) => /cita adicional|otra cita/i.test(m.content))
      const confirmedAnother = agentAskedAboutAnother && recentPatientMsgs.some((m) => /^(s[ií]|dale|claro|ok|sip|ajá)/i.test(m.content.trim()))

      if (
        alreadyConfirmed &&
        agentResponse.toolsUsed.includes('check_availability') &&
        !agentResponse.text.includes('✅') &&
        !patientAskedForAnother &&
        !confirmedAnother
      ) {
        console.warn(`[Webhook] ⚠️ POST-CITA LOCKOUT: agente intentó re-agendar sin pedido explícito. Bloqueando.`)
        const lockoutText = 'Tu cita ya está confirmada. ¿Necesitas agregar algún dato o agendar una cita diferente?'
        await saveMessage(conversation.id, 'agent', lockoutText)
        await sendWhatsAppMessage(message.from, lockoutText, clinicCreds)
        return
      }

      // Limpiar markdown que Claude pueda haber incluido (WhatsApp muestra asteriscos literales)
      const cleanText = agentResponse.text
        .replace(/\*\*(.*?)\*\*/g, '$1')  // **bold** → bold
        .replace(/\*(.*?)\*/g, '$1')      // *italic* → italic
        .replace(/_(.*?)_/g, '$1')        // _under_ → under
        .replace(/^[•●]\s*/gm, '- ')     // • bullet → - bullet
        .replace(/^#{1,3}\s*/gm, '')      // ## header → header
        .replace(/`(.*?)`/g, '$1')        // `code` → code

      console.log(`[Webhook] Respuesta: "${cleanText.slice(0, 100)}..."`)

      // 18.1. Registrar uso de tokens
      if (agentResponse.tokenUsage) {
        await trackTokenUsage(clinic.id, agentResponse.tokenUsage.input, agentResponse.tokenUsage.output)
      }

      // 19. Guardar respuesta del agente en DB (versión limpia)
      await saveMessage(conversation.id, 'agent', cleanText)

      // 19. Enviar respuesta por WhatsApp
      const sendResult = await sendWhatsAppMessage(message.from, cleanText, clinicCreds)
      if (!sendResult) {
        console.error('[Webhook] FALLÓ el envío por WhatsApp — la respuesta se guardó en DB pero el paciente no la recibió')
      }

      // 20. Si se escaló, marcar la conversación y notificar al equipo
      if (agentResponse.toolsUsed.includes('escalate_to_human')) {
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)

        // Notificar al contacto de escalamiento (fire-and-forget)
        notifyEscalationContact({
          clinicId: clinic.id,
          patientName: patient.name,
          patientPhone: message.from,
          lastPatientMessage: sanitizedText,
          clinicCreds,
        })
      }

      // 20.1 Staff notifications for appointment changes via WhatsApp
      if (agentResponse.toolsUsed.includes('cancel_appointment') || agentResponse.toolsUsed.includes('reschedule_appointment')) {
        try {
          const { notifyStaffOfAppointmentChange } = await import('@/lib/notifications/create-notification')
          await notifyStaffOfAppointmentChange({
            clinicId: clinic.id,
            conversationId: conversation.id,
            patientName: patient.name,
            patientId: patient.id,
            toolsUsed: agentResponse.toolsUsed,
          })
        } catch (notifErr) {
          console.error('[Webhook] Staff notification failed (non-critical):', notifErr instanceof Error ? notifErr.message : notifErr)
        }
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
    .maybeSingle()

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
    escalation_keywords: ['urgencia', 'emergencia', 'hablar con alguien', 'sangrado', 'humano', 'persona real', 'quiero hablar con alguien'],
    doctors: {},
    automations: {
      post_consulta: { enabled: false },
      reactivacion: { enabled: false, days_inactive: 90 },
    },
  }
  const raw = (clinic.whatsapp_config as WhatsAppConfig | null)
  if (!raw) return DEFAULT
  return { ...DEFAULT, ...raw, automations: { ...DEFAULT.automations, ...(raw.automations ?? {}) } }
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
 * Carga los tipos de consulta activos de la clínica
 * Se pasan al agente para que conozca las opciones disponibles por doctor
 */
async function findActiveConsultationTypes(clinicId: string): Promise<ConsultationType[]> {
  const { data } = await supabaseAdmin
    .from('consultation_types')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('doctor_id, created_at')

  return (data ?? []) as ConsultationType[]
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
    .maybeSingle()

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
    .maybeSingle()

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
  conversationId: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<void> {
  // Aviso de privacidad (obligatorio por Ley 1581)
  const privacyNotice =
    `📋 Antes de continuar, te informo que ${clinic.name} tratará tus datos personales ` +
    `según la Ley 1581 de 2012. Al continuar esta conversación, autorizas el tratamiento ` +
    `de tus datos para agendar y gestionar tus citas. Si deseas conocer nuestra política ` +
    `completa o ejercer tus derechos, escribe "privacidad".`

  await sendWhatsAppMessage(whatsappFrom, privacyNotice, clinicCreds)
  await saveMessage(conversationId, 'agent', privacyNotice)

  // Marcar consentimiento (al continuar = acepta)
  await supabaseAdmin
    .from('patients')
    .update({ data_consent_at: new Date().toISOString() })
    .eq('id', patient.id)

  // Mensaje de bienvenida
  const welcome = clinic.welcome_message
    ?? `¡Hola! 👋 Soy ${clinic.agent_name}, asistente virtual de ${clinic.name}. ¿En qué te puedo ayudar?`

  await sendWhatsAppMessage(whatsappFrom, welcome, clinicCreds)
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
  conversationId: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<boolean> {
  // Normalizar respuesta
  const normalized = messageText.toLowerCase().trim()

  // Detectar tipo de respuesta
  const isConfirmation = /^(s[ií]|si|yes|confirmo|confirmar|dale|claro|ok|listo)$/i.test(normalized)
  const isCancellation = /^(no|cancelar|cancelo|no puedo)$/i.test(normalized)
  const isReschedule = /^(cambiar|reagendar|reprogramar|cambio|mover)$/i.test(normalized)

  if (!isConfirmation && !isCancellation && !isReschedule) return false

  // Buscar citas con recordatorio enviado pero sin confirmar
  const { data: pendingAppointment } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, doctor_id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('reminder_24h_sent', true)
    .is('reminder_confirmed', null)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

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
    await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

    console.log(`[Webhook] Recordatorio CONFIRMADO para cita ${pendingAppointment.id}`)
  } else if (isCancellation) {
    // Cancelar cita de verdad — liberar slot y notificar waitlist
    await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        reminder_confirmed: false,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'reminder_declined',
      })
      .eq('id', pendingAppointment.id)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'cancelled' })
      .eq('appointment_id', pendingAppointment.id)
      .eq('type', '24h')

    // Notificar al siguiente en lista de espera
    try {
      const { notifyHighestPriorityWaitlistPatient } = await import('@/app/actions/priority')
      if (pendingAppointment.doctor_id) {
        await notifyHighestPriorityWaitlistPatient(clinicId, pendingAppointment.doctor_id)
      }
    } catch (err) {
      console.error('[Webhook] Error notificando waitlist tras cancelación:', err)
    }

    const response = 'Tu cita ha sido cancelada. Si cambias de opinión puedes agendar nuevamente escribiéndonos.'
    await saveMessage(conversationId, 'agent', response)
    await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

    console.log(`[Webhook] Cita ${pendingAppointment.id} CANCELADA vía recordatorio`)
  } else {
    // CAMBIAR — rutear al agente de IA para reagendamiento
    // Marcar conversación con flag wants_to_reschedule para que el agente lo detecte
    await supabaseAdmin
      .from('conversations')
      .update({
        context: { wants_to_reschedule: true, appointment_id: pendingAppointment.id },
      })
      .eq('id', conversationId)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'rescheduled' })
      .eq('appointment_id', pendingAppointment.id)
      .eq('type', '24h')

    const response = 'Claro, con gusto te ayudo a cambiar la cita. ¿Qué día y hora te quedaría mejor?'
    await saveMessage(conversationId, 'agent', response)
    await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

    console.log(`[Webhook] Paciente pidió CAMBIAR cita ${pendingAppointment.id}`)
  }

  // Recalcular probabilidad de no-show
  const { calculateNoShowProbability } = await import('@/lib/utils/noshow')
  await calculateNoShowProbability(patientId, clinicId)

  return true
}

// ============================================================
// NPS RESPONSE — Detecta calificación 1-10 post-consulta
// ============================================================

async function handleNpsResponse(
  messageText: string,
  patientId: string,
  clinicId: string,
  whatsappFrom: string,
  conversationId: string,
  patientName: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<boolean> {
  // Solo procesar si el mensaje es un número del 1 al 10
  const trimmed = messageText.trim()
  const score = parseInt(trimmed, 10)
  if (isNaN(score) || score < 1 || score > 10 || trimmed !== String(score)) return false

  // Buscar cita completada reciente con followup enviado pero sin NPS
  // Ventana: citas de las últimas 48h (para dar margen de respuesta)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('status', 'completed')
    .eq('followup_sent', true)
    .is('nps_score', null)
    .gte('starts_at', twoDaysAgo)
    .order('starts_at', { ascending: false })
    .limit(1)
    .single()

  if (!appointment) return false

  // Guardar el NPS score
  await supabaseAdmin
    .from('appointments')
    .update({ nps_score: score })
    .eq('id', appointment.id)

  const response =
    `¡Gracias ${patientName}! Tu opinión nos ayuda a mejorar. ` +
    `Si tienes algún comentario adicional, con gusto lo escuchamos. ¡Hasta pronto! 🙏`

  await saveMessage(conversationId, 'agent', response)
  await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

  console.log(`[Webhook] NPS score ${score} registrado para cita ${appointment.id}`)
  return true
}

// ============================================================
// DOCUMENT FLOW — Detectar y procesar documentos recibidos
// ============================================================

/**
 * Verifica si el paciente tiene alguna cita futura con documentos pendientes
 */
async function patientHasPendingDocuments(patientId: string, clinicId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('documents_requested', true)
    .eq('documents_received', false)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())
    .limit(1)

  return (data?.length ?? 0) > 0
}

/**
 * Marca los documentos como recibidos para la cita pendiente más próxima
 * y envía confirmación al paciente
 */
async function handleDocumentReceived(
  patientId: string,
  clinicId: string,
  whatsappFrom: string,
  conversationId: string,
  patientName: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<void> {
  // Buscar la cita más próxima con documentos pendientes
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('documents_requested', true)
    .eq('documents_received', false)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .single()

  if (!appointment) return

  // Marcar documentos como recibidos
  await supabaseAdmin
    .from('appointments')
    .update({
      documents_received: true,
      documents_received_at: new Date().toISOString(),
    })
    .eq('id', appointment.id)

  const response =
    `✅ ¡Recibimos tu documento, ${patientName}! Ya lo tenemos en tu expediente para tu próxima cita. ` +
    `Si necesitas enviar algo más, hazlo por este mismo chat.`

  await saveMessage(conversationId, 'agent', response)
  await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'documents_received',
      actor_type: 'patient',
      target_type: 'appointment',
      target_id: appointment.id,
      details: { patient_id: patientId },
    })
  } catch { /* no crítico */ }

  console.log(`[Webhook] Documentos recibidos para cita ${appointment.id}`)
}
