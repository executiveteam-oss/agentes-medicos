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
import { sendWhatsAppMessage, sendWhatsAppMessageWithResult, markAsRead } from '@/lib/whatsapp/client'
import type { ClinicWhatsAppCredentials } from '@/lib/whatsapp/client'
import { sanitizePatientMessage, isSupportedMessageType, isDocumentMediaType, getUnsupportedTypeMessage } from '@/lib/whatsapp/sanitize'
import { stripTimestampMarkers } from '@/lib/whatsapp/strip-timestamp-markers'
import { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } from '@/lib/agent/agent-context'
import { verifyWebhookSignature } from '@/lib/whatsapp/verify-signature'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import { trackTokenUsage, isClinicPaused } from '@/lib/api-usage'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/utils/dates'
import { syncClinicSheet } from '@/lib/google-sheets'
import { notifyStaffOfEscalation, notifyCrisis, notifyDataRightsRequest, refreshEscalationNotifications } from '@/lib/notifications/escalation-notify'
import { detectCrisis, detectHumanRequest, detectDataRightsRequest, detectPrivacyPolicyQuery, normalizeForSafety } from '@/lib/safety/crisis-patterns'
import { detectEscalateService, isPriceOnlyQuestion } from '@/lib/safety/escalate-service-matcher'
import { buildPrivacyNotice } from '@/lib/legal/privacy-notice'
import { buildContainmentMessage, DEFAULT_CRISIS_CONFIG, type CrisisConfig } from '@/lib/safety/crisis-config'
import { buildDataRightsAck } from '@/lib/safety/data-rights-config'
import { whatsappWebhookSchema } from '@/lib/validators/whatsapp'
import {
  detectHallucinatedAppointmentConfirmation,
  detectHallucinatedCancellation,
  detectHallucinatedIdentity,
  detectHallucinatedReschedule,
} from '@/lib/whatsapp/agent-guards'
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

      // 7.2.5. Bloque 4 — Recepción de archivos por feature flag.
      //
      // Si el paciente envía imagen/PDF Y la clínica tiene
      // feature_config.media_reception_enabled=true, descargamos el
      // archivo y lo agregamos al historial para que el agente reaccione.
      //
      // FLAG OFF (default para todas las clínicas hoy): respondemos
      // "solo manejo texto, te paso con un asesor" + escalamos. Es el
      // comportamiento seguro hasta que (a) Meta esté migrado y
      // (b) legal apruebe Ley 1581.
      if (isDocumentMediaType(message.type) && !hasDocsPending) {
        if (!clinicCreds) {
          console.error('[Webhook] media recibido sin clinicCreds — clínica sin token WhatsApp configurado')
          return
        }
        const featureConfig = (clinic.feature_config as Record<string, unknown> | null) ?? {}
        const mediaEnabled = featureConfig.media_reception_enabled === true

        if (!mediaEnabled) {
          // Flag apagado: respondemos amablemente + escalamos (el staff
          // ve el contexto y coordina lo que el paciente quería mandar).
          await sendWhatsAppMessage(
            message.from,
            '📎 Recibí tu archivo. Por ahora la recepción automática está en proceso de habilitación — te paso con un asesor que lo revisa contigo.',
            clinicCreds,
          )
          const conversation = await findOrCreateConversation(clinic.id, patient.id, patientPhone)
          // Guardar un mensaje placeholder para que la conversación tenga contexto
          await saveMessage(
            conversation.id,
            'patient',
            `[Paciente envió un ${message.type === 'image' ? 'imagen' : 'documento'} — recepción automática deshabilitada]`,
            message.id,
          )
          // Escalar para que el humano lo atienda
          await supabaseAdmin
            .from('conversations')
            .update({
              status: 'escalated',
              escalated_at: new Date().toISOString(),
              context: { escalation_reason: 'Paciente envió archivo — recepción de media deshabilitada (feature flag off)' },
            })
            .eq('id', conversation.id)
          // Notificación in-app persistente para el staff (campana)
          await notifyStaffOfEscalation({
            clinicId: clinic.id,
            conversationId: conversation.id,
            patientName: patient.name,
            reason: 'Paciente envió un archivo — recepción deshabilitada',
          })
          return
        }

        // FLAG ON: procesamos el archivo.
        const conversation = await findOrCreateConversation(clinic.id, patient.id, patientPhone)
        try {
          const { downloadWhatsAppMedia, uploadMediaToStorage, recordConversationMedia } =
            await import('@/lib/whatsapp/media-handler')

          const mediaPayload = message.type === 'image' ? message.image : message.document
          if (!mediaPayload?.id) {
            console.error('[Webhook] media sin id', message.type)
            await sendWhatsAppMessage(message.from, '📎 No pude descargar tu archivo. ¿Puedes enviarlo de nuevo?', clinicCreds)
            return
          }

          const download = await downloadWhatsAppMedia(mediaPayload.id, clinicCreds.accessToken)
          if (!download.ok) {
            console.error('[Webhook] error descargando media:', download.errorCode, download.error)
            await sendWhatsAppMessage(
              message.from,
              download.errorCode === 'media_expired'
                ? '📎 Tu archivo ya no está disponible. ¿Puedes enviarlo de nuevo?'
                : download.errorCode === 'size_exceeded'
                ? '📎 Tu archivo es muy grande (máximo 25MB). ¿Puedes enviarlo más liviano?'
                : download.errorCode === 'mime_not_allowed'
                ? '📎 Necesito el archivo como JPG, PNG o PDF. ¿Puedes cambiar el formato?'
                : '📎 No pude descargar tu archivo. ¿Puedes enviarlo de nuevo?',
              clinicCreds,
            )
            return
          }

          const upload = await uploadMediaToStorage({
            clinicId: clinic.id,
            conversationId: conversation.id,
            mediaId: mediaPayload.id,
            bytes: download.bytes,
            mimeType: download.mimeType,
          })
          if (!upload.ok) {
            console.error('[Webhook] error subiendo media:', upload.error)
            await sendWhatsAppMessage(message.from, '📎 Hubo un problema guardando tu archivo. Te paso con un asesor.', clinicCreds)
            return
          }

          // Determinar el contexto: si el último mensaje del agente le pidió
          // una autorización, lo etiquetamos como 'authorization'.
          const { data: lastAgentMsg } = await supabaseAdmin
            .from('messages')
            .select('content')
            .eq('conversation_id', conversation.id)
            .eq('role', 'agent')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const isAuthContext = lastAgentMsg?.content
            ? /autorizaci[oó]n|autorizad[oa]/i.test(lastAgentMsg.content as string)
            : false

          // Guardar mensaje en la conversación que el agente verá como historial.
          // Hacemos insert directo (no saveMessage) para obtener el id de retorno.
          const filename = message.type === 'document' ? (message.document?.filename ?? null) : null
          const placeholderContent = isAuthContext
            ? '📎 Autorización recibida'
            : `📎 Archivo recibido (${message.type === 'image' ? 'imagen' : (filename ?? 'documento')})`
          const { data: savedMsg } = await supabaseAdmin
            .from('messages')
            .insert({
              conversation_id: conversation.id,
              role: 'patient',
              content: placeholderContent,
              whatsapp_message_id: message.id,
            })
            .select('id')
            .single()
          const savedMessageId = (savedMsg as { id: string } | null)?.id ?? null

          await recordConversationMedia({
            clinicId: clinic.id,
            conversationId: conversation.id,
            messageId: savedMessageId,
            whatsappMediaId: mediaPayload.id,
            mediaType: message.type === 'image' ? 'image' : 'document',
            mimeType: download.mimeType,
            filename,
            storagePath: upload.storagePath,
            sizeBytes: download.sizeBytes,
            context: isAuthContext ? 'authorization' : 'document_general',
          })

          // Si es contexto de autorización: escalamos directamente.
          // El staff revisa el archivo desde el dashboard y agenda.
          if (isAuthContext) {
            await sendWhatsAppMessage(
              message.from,
              'Recibido, gracias. Voy a coordinar con el equipo y un asesor te contacta pronto para confirmar tu cita.',
              clinicCreds,
            )
            await supabaseAdmin
              .from('conversations')
              .update({
                status: 'escalated',
                escalated_at: new Date().toISOString(),
                context: { escalation_reason: 'Autorización recibida — pendiente de revisión humana' },
                last_message_at: new Date().toISOString(),
              })
              .eq('id', conversation.id)
            // Notificación in-app persistente para el staff (campana)
            await notifyStaffOfEscalation({
              clinicId: clinic.id,
              conversationId: conversation.id,
              patientName: patient.name,
              reason: 'Autorización recibida — pendiente de revisión',
            })
            return
          }

          // Caso no-autorización: el agente reacciona normalmente al
          // próximo turno (verá el placeholder en el historial).
        } catch (err) {
          console.error('[Webhook] error procesando media:', err)
          await sendWhatsAppMessage(message.from, '📎 Hubo un problema procesando tu archivo. Te paso con un asesor.', clinicCreds)
        }
        return
      }

      // 7.2.8. Quick Reply de template (recordatorio_cita): cuando la paciente
      //         toca "Confirmar"/"Reagendar"/"Cancelar", Meta manda un mensaje
      //         type:'button' (NO 'text') con message.button = { text, payload }.
      //         Tratamos el texto del botón como si fuera texto libre de la
      //         paciente para que fluya por el pipeline existente
      //         (sanitize → handleReminderResponse). Es un mensaje ENTRANTE →
      //         abre la ventana de 24h, así el agente puede responder por texto
      //         libre después (ej. ofrecer cupos tras "Reagendar").
      const buttonText = message.button?.text ?? message.button?.payload

      // 7.3. Verificar tipo de mensaje
      //      Los botones de template son válidos aunque no sean type:'text'.
      if (!buttonText && !isSupportedMessageType(message.type, hasDocsPending)) {
        // Si es audio, imagen, etc. → responder que solo maneja texto
        const unsupportedMsg = getUnsupportedTypeMessage(message.type)
        await sendWhatsAppMessage(message.from, unsupportedMsg, clinicCreds)
        return
      }

      // 8. Obtener el texto del mensaje (texto libre o texto del botón Quick Reply)
      const rawText = message.text?.body ?? buttonText
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

      // 14.5. CAPA 0 DE SEGURIDAD — determinista, corre ANTES de la regla 15
      //       (escalada) y del gate de consentimiento (paso 16). No depende del LLM.
      const crisisCfg: CrisisConfig = waConfig.crisis ?? DEFAULT_CRISIS_CONFIG
      if (crisisCfg.detection_enabled && detectCrisis(sanitizedText).matched) {
        await handleCrisis(clinic, patient, conversation, message.from, sanitizedText, clinicCreds, crisisCfg)
        return
      }
      // Ejercicio de un DERECHO sobre datos (ARCO): SIEMPRE activo — obligación
      // legal. Corre ANTES de la consulta de política, así "quiero eliminar mis
      // datos y ver la política" escala (ante duda, escalar). Precedencia:
      // crisis > derecho ARCO > consulta de política > servicio ruleado > humano.
      if (detectDataRightsRequest(sanitizedText).matched) {
        await handleDataRightsRequest(clinic, patient, conversation, message.from, sanitizedText, clinicCreds)
        return
      }
      // CONSULTA de política de privacidad (informativa, no es ejercicio de derecho).
      // Si la clínica tiene URL configurada → link (sin escalar). Si NO → cae al
      // flujo de derechos (acuse + escalación) — nunca un link roto ni medio mensaje.
      if (detectPrivacyPolicyQuery(sanitizedText).matched) {
        if (clinic.privacy_policy_url) {
          await handlePrivacyPolicyLink(clinic, conversation, message.from, clinic.privacy_policy_url, clinicCreds)
        } else {
          await handleDataRightsRequest(clinic, patient, conversation, message.from, sanitizedText, clinicCreds)
        }
        return
      }
      // Servicio con regla escalate_human (colposcopia, DIU, biopsia, posquirúrgico,
      // vulvoscopia): escala ANTES de que el LLM redacte, para que NUNCA prometa
      // agendar un servicio que la clínica reservó para validación humana.
      // Determinista, model-independent — tapa el hueco de que el modelo no lea la
      // marca 🚨 del prompt (capa A). El executor sigue como backstop (capa B).
      const escSvc = detectEscalateService(sanitizedText)
      if (escSvc.matched && !isPriceOnlyQuestion(sanitizedText)) {
        await handleEscalateService(clinic, patient, conversation, message.from, escSvc.label ?? 'ese servicio', clinicCreds)
        return
      }
      // Si matcheó el servicio PERO es solo una pregunta de precio/cobertura, no
      // se escala: sigue al LLM, que sabe dar el precio particular. Una paciente
      // preguntó "¿qué vale el mapeo?" y se quedó sin respuesta — escalar eso es
      // un falso positivo caro. Ante cualquier señal de agendar, escala igual
      // (ver BOOKING_INTENT). El executor sigue como backstop si deriva a cita.
      if (crisisCfg.detection_enabled && detectHumanRequest(sanitizedText).matched) {
        await handleHumanRequest(clinic, patient, conversation, message.from, sanitizedText, clinicCreds, crisisCfg)
        return
      }

      // 15. Si la conversación está escalada → no responder (un humano se encarga)
      if (conversation.status === 'escalated') {
        // Mensaje nuevo sobre una PENDIENTE = la paciente insiste → vuelve a
        // Atención en el momento. El reloj de re-surface (etapa 3) es para el
        // SILENCIO, no para la insistencia: escribir de nuevo es la señal más
        // fuerte de que está esperando.
        if ((conversation as { triage_state?: string | null }).triage_state === 'pendiente') {
          await supabaseAdmin.from('conversations').update({ triage_state: 'atencion' }).eq('id', conversation.id)
          console.log(`[Webhook] Pendiente con mensaje nuevo → vuelve a Atención. ID: ${conversation.id}`)
        }
        // Fix zona muerta: refresca la alerta viva con el último mensaje (o crea
        // una nueva si fue atendida). Así la campana refleja lo último que dijo
        // el paciente y re-sube. La crisis ya se manejó arriba en la Capa 0.
        await refreshEscalationNotifications({
          conversationId: conversation.id,
          clinicId: clinic.id,
          patientName: patient.name,
          latestMessage: sanitizedText,
        })
        console.log(`[Webhook] Conversación escalada, no responder (alerta refrescada). ID: ${conversation.id}`)
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

        // Notificación in-app persistente para el staff (campana)
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: sanitizedText,
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

      // Contexto del agente (existingPatient + tratantes) — FUENTE ÚNICA en
      // src/lib/agent/agent-context.ts, compartida con "devolver al agente"
      // (Etapa 3) para que el re-run use EXACTAMENTE este contexto.
      const existingPatient = buildExistingPatient(patient)
      const { tratanteMode, tratantes: resolvedTratantes } = await resolveTratantesForClinic(clinic, patient, conversation.id)

      let agentResponse: { text: string; toolsUsed: string[]; tokenUsage?: { input: number; output: number }; appointmentData?: { id: string; starts_at: string; ends_at: string; doctor_name: string; consultation_type: string | null; sequence: number }; escalate?: { reason: string; code: string } }

      const agentParams = {
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
        tratanteMode,
        tratantes: resolvedTratantes,
      }
      try {
        agentResponse = await runAppointmentAgent(agentParams)
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

      // Guard: if agent returned empty text (should never happen, but defensive)
      if (!agentResponse?.text) {
        console.error('[Webhook] Agent returned null/empty response')
        const fallback = 'Disculpa, estoy teniendo dificultades técnicas. Intenta de nuevo en unos minutos o escribe "hablar con humano". 🙏'
        try { await sendWhatsAppMessage(message.from, fallback, clinicCreds) } catch { /* */ }
        try { await saveMessage(conversation.id, 'agent', fallback) } catch { /* */ }
        return
      }

      console.log(`[Webhook] Agente respondió. Tools usadas: [${agentResponse.toolsUsed.join(', ')}]`)

      // El agente cortó determinista y pidió escalar: (a) falla DURA de
      // agendamiento (bug#4, create/reschedule rechazado por slot/horario) o
      // (b) error TÉCNICO de cualquier tool. NINGUNO se disfraza de negocio
      // normal: se escala a una persona, se avisa al staff y se audita — para
      // tener señal del problema, no un "clínica llena" silencioso.
      if (agentResponse.escalate) {
        const isTech = agentResponse.escalate.reason === 'tool_technical_error'
        await supabaseAdmin
          .from('conversations')
          .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: isTech ? 'error_tecnico_tool' : 'falla_agendamiento' } })
          .eq('id', conversation.id)
        await refreshEscalationNotifications({
          conversationId: conversation.id,
          clinicId: clinic.id,
          patientName: patient.name,
          latestMessage: isTech
            ? `⚠ El agente tuvo un error técnico (${agentResponse.escalate.code}) — revisar el sistema y atender a la paciente`
            : `⚠ El agente no pudo agendar (${agentResponse.escalate.code}) — hay que agendar a mano y revisar`,
        })
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinic.id,
          action: isTech ? 'agent_tool_error_escalated' : 'agent_booking_failure_escalated',
          actor_type: 'agent',
          target_type: 'conversation',
          target_id: conversation.id,
          details: { code: agentResponse.escalate.code, reason: agentResponse.escalate.reason, patient_phone: message.from },
        })
        await saveMessage(conversation.id, 'agent', agentResponse.text)
        await sendWhatsAppMessage(message.from, agentResponse.text, clinicCreds)
        console.warn(`[Webhook] 🚨 Escalación por ${isTech ? 'error técnico de tool' : 'falla de agendamiento'} del agente: ${agentResponse.escalate.code}`)
        return
      }

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

      // GUARD 4 (alucinación de confirmación de cita) — corregir al MODELO, no a
      // la paciente. El modelo dijo "✅ cita agendada" sin llamar create_appointment.
      // En vez de pedirle a la paciente que repita el horario (ella hizo todo bien),
      // re-corremos el turno inyectándole su propio texto + una corrección para que
      // llame la tool. La paciente no ve nada. Si en el 2º intento vuelve a alucinar,
      // AHÍ escalamos y avisamos al staff. Cada disparo se audita (frecuencia).
      {
        let apptGuard = detectHallucinatedAppointmentConfirmation({
          agentText: agentResponse.text,
          hasAppointmentData: !!agentResponse.appointmentData,
          toolsUsed: agentResponse.toolsUsed,
        })
        if (apptGuard.blocked) {
          console.error('[Webhook] GUARD hallucinated_appointment_confirmation (intento 1) — re-corriendo al modelo')
          try {
            await supabaseAdmin.from('audit_log').insert({
              clinic_id: clinic.id, action: 'hallucinated_appointment_confirmation_blocked', actor_type: 'system',
              details: { conversation_id: conversation.id, attempt: 1, escalated: false, original_response: agentResponse.text.slice(0, 300) },
            })
          } catch { /* non-critical */ }

          const hallucinatedText = agentResponse.text
          try {
            agentResponse = await runAppointmentAgent({
              ...agentParams,
              selfCorrection: {
                priorAssistantText: hallucinatedText,
                note: '[Corrección interna del sistema — la paciente NO ve este mensaje] En tu respuesta anterior dijiste que la cita quedó confirmada o agendada, pero NO llamaste la herramienta create_appointment, así que en la base de datos NO se creó ninguna cita. Llama create_appointment AHORA usando los datos que la paciente ya te dio en esta conversación: el doctor, el tipo de consulta, y la fecha y hora exactas que ella eligió. No vuelvas a escribir una confirmación con ✅ sin haber ejecutado create_appointment primero.',
              },
            })
          } catch (rerunErr) {
            console.error('[Webhook] Re-run correctivo tiró:', rerunErr instanceof Error ? rerunErr.message : rerunErr)
          }

          // ¿Corrigió (llamó la tool) o volvió a alucinar?
          apptGuard = detectHallucinatedAppointmentConfirmation({
            agentText: agentResponse.text,
            hasAppointmentData: !!agentResponse.appointmentData,
            toolsUsed: agentResponse.toolsUsed,
          })
          if (apptGuard.blocked) {
            console.error('[Webhook] 🚨 hallucinated_appointment_confirmation persistió tras re-run — escalando')
            try {
              await supabaseAdmin.from('audit_log').insert({
                clinic_id: clinic.id, action: 'hallucinated_appointment_confirmation_blocked', actor_type: 'system',
                details: { conversation_id: conversation.id, attempt: 2, escalated: true, original_response: agentResponse.text.slice(0, 300) },
              })
            } catch { /* non-critical */ }
            await supabaseAdmin.from('conversations')
              .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'falla_agendamiento' } })
              .eq('id', conversation.id)
            await refreshEscalationNotifications({
              conversationId: conversation.id,
              clinicId: clinic.id,
              patientName: patient.name,
              latestMessage: '⚠ El agente no logró agendar (alucinó la confirmación 2 veces) — hay que agendar a mano y revisar',
            })
            const escalaText = 'Dame un momentito, te comunico con alguien del equipo para dejar tu cita confirmada. 🙏'
            await saveMessage(conversation.id, 'agent', escalaText)
            await sendWhatsAppMessageWithResult(message.from, escalaText, clinicCreds, {
              clinicId: clinic.id, sendType: 'agent_reply', conversationId: conversation.id,
            })
            return
          }
          console.log(`[Webhook] Re-run correctivo OK — tools=[${agentResponse.toolsUsed.join(', ')}], appointmentData=${!!agentResponse.appointmentData}`)
        }
      }

      // Otros guards defensivos (cancelación, reagendamiento, identidad): estos SÍ
      // reemplazan el texto (no re-corren) — el re-run correctivo fue solo para la
      // confirmación de cita.
      const guardResults = [
        detectHallucinatedCancellation({
          agentText: agentResponse.text,
          toolsUsed: agentResponse.toolsUsed,
        }),
        detectHallucinatedReschedule({
          agentText: agentResponse.text,
          toolsUsed: agentResponse.toolsUsed,
        }),
        detectHallucinatedIdentity({
          agentText: agentResponse.text,
          messageHistory,
          currentPatientMsg: sanitizedText,
          patientName: patient.name,
          patientDocType: patient.document_type,
          patientDocNumber: patient.document_number,
        }),
      ]
      for (const guard of guardResults) {
        if (!guard.blocked || !guard.replacement) continue
        const originalText = agentResponse.text
        console.error(`[Webhook] BLOCKED ${guard.reason}. details:`, guard.details)
        agentResponse.text = guard.replacement
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: `${guard.reason}_blocked`,
            actor_type: 'system',
            details: {
              conversation_id: conversation.id,
              original_response: originalText.slice(0, 300),
              ...guard.details,
            },
          })
        } catch { /* non-critical */ }
        break // un guard bloqueó, no aplicar más
      }

      // Limpiar markdown que Claude pueda haber incluido (WhatsApp muestra asteriscos literales)
      const cleanText = agentResponse.text
        .replace(/\*\*(.*?)\*\*/g, '$1')  // **bold** → bold
        .replace(/\*(.*?)\*/g, '$1')      // *italic* → italic
        .replace(/_(.*?)_/g, '$1')        // _under_ → under
        .replace(/^[•●]\s*/gm, '- ')     // • bullet → - bullet
        .replace(/^#{1,3}\s*/gm, '')      // ## header → header
        .replace(/`(.*?)`/g, '$1')        // `code` → code

      // Strip DETERMINISTA del marcador de timestamp [YYYY-MM-DD HH:MM] por si el
      // modelo lo copió del historial (eco). No depende de la cláusula del prompt.
      const { text: sendText, stripped: tsStripped } = stripTimestampMarkers(cleanText)
      if (tsStripped > 0) {
        console.warn(`[Webhook] ⚠ ECO timestamp: removidos ${tsStripped} marcador(es) [YYYY-MM-DD HH:MM] de la respuesta`)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'timestamp_marker_stripped',
            actor_type: 'system',
            details: { conversation_id: conversation.id, count: tsStripped },
          })
        } catch { /* no crítico */ }
      }

      console.log(`[Webhook] Respuesta: "${sendText.slice(0, 100)}..."`)

      // 18.1. Registrar uso de tokens
      if (agentResponse.tokenUsage) {
        await trackTokenUsage(clinic.id, agentResponse.tokenUsage.input, agentResponse.tokenUsage.output)
      }

      // 19. Guardar respuesta del agente en DB (versión limpia, ya sin marcador)
      const agentMsgId = await saveMessage(conversation.id, 'agent', sendText)

      // 19. Enviar por WhatsApp. El registro del fallo (audit whatsapp_send_failed
      // + delivery_status NO ENTREGADO en el mensaje) lo hace ahora
      // recordWhatsAppSendFailure POR DENTRO del send, vía ctx — fuente única,
      // ver src/lib/whatsapp/send-failure.ts (antes vivía inline acá).
      await sendWhatsAppMessageWithResult(message.from, sendText, clinicCreds, {
        clinicId: clinic.id, sendType: 'agent_reply', conversationId: conversation.id, messageId: agentMsgId ?? undefined,
      })

      // 19.5 Calendar invite (.ics) — hosteado + link (NO adjunto: Meta no
      // acepta text/calendar y text/plain se renombra a .TXT en WhatsApp).
      // Ver src/lib/calendar/host-ics.ts y la ruta /cita/{token}.
      console.log(`[Webhook] appointmentData present: ${!!agentResponse.appointmentData}, toolsUsed: [${agentResponse.toolsUsed.join(', ')}]`)
      if (agentResponse.appointmentData) {
        try {
          const { generateConfirmICS, generateCancelICS } = await import('@/lib/calendar/generate-ics')
          const { hostICSAndGetLink } = await import('@/lib/calendar/host-ics')

          const aptData = agentResponse.appointmentData
          const isCancel = agentResponse.toolsUsed.includes('cancel_appointment')
          const isVirtual = agentResponse.text.toLowerCase().includes('virtual')

          const icsString = isCancel
            ? generateCancelICS({
                appointmentId: aptData.id,
                startsAt: aptData.starts_at,
                endsAt: aptData.ends_at,
                doctorName: aptData.doctor_name,
                consultationType: aptData.consultation_type,
                clinicName: clinic.name,
                clinicAddress: clinic.address,
                clinicCity: clinic.city,
                sequence: aptData.sequence,
              })
            : generateConfirmICS({
                appointmentId: aptData.id,
                startsAt: aptData.starts_at,
                endsAt: aptData.ends_at,
                doctorName: aptData.doctor_name,
                consultationType: aptData.consultation_type,
                clinicName: clinic.name,
                clinicAddress: clinic.address,
                clinicCity: clinic.city,
                sequence: aptData.sequence,
                isVirtual,
              })

          console.log(`[Webhook] ICS generated: ${icsString.length} bytes, isCancel=${isCancel}`)
          // Subir a Storage privado y obtener el link a nuestra ruta /cita/{token}.
          const icsLink = await hostICSAndGetLink({ appointmentId: aptData.id, icsContent: icsString })
          if (icsLink) {
            const icsText = isCancel
              // Condicional y secundario: el METHOD:CANCEL solo hace algo si
              // ella había agregado el evento (la mayoría no lo hizo).
              ? `Si la habías guardado en tu calendario, aquí la quitas:\n${icsLink}`
              : `📅 Guarda tu cita en el calendario de tu celular:\n${icsLink}\nSi no se abre solo, búscalo en tus descargas. El enlace funciona hasta el día de tu cita.`
            await sendWhatsAppMessageWithResult(message.from, icsText, clinicCreds, {
              clinicId: clinic.id, sendType: 'ics', conversationId: conversation.id,
            })
            console.log(`[Webhook] ICS link enviado: ${icsLink}`)
          } else {
            console.error('[Webhook] ICS hosting failed — no link sent')
          }
        } catch (icsErr) {
          console.error('[Webhook] ICS send failed (non-critical):', icsErr instanceof Error ? icsErr.message : icsErr)
        }
      }

      // 20. Si se escaló, marcar la conversación y notificar al equipo
      if (agentResponse.toolsUsed.includes('escalate_to_human')) {
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
            context: { escalation_reason: 'escalate_to_human' },
          })
          .eq('id', conversation.id)

        // Notificación in-app persistente para el staff (campana)
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: sanitizedText,
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
 * Verifica si el mensaje contiene alguna palabra clave de escalamiento
 * Retorna la keyword encontrada o null
 */
function checkEscalationKeywords(message: string, config: WhatsAppConfig): string | null {
  // Normaliza (minúsculas, sin tildes, sin puntuación) igual que Capa 0, y
  // matchea por PALABRA(S) COMPLETA(S), no substring: "dolor" ya NO matchea
  // dentro de "doloroso" ni "médico" dentro de "paramédico", y "medico" sin
  // tilde matchea la keyword con tilde. Esto arregla los matches PARCIALES.
  // NO resuelve el problema de vocabulario (la palabra completa "dolor" en "ya
  // no tengo dolor" sí matchea) — eso se arregla migrando escalation_keywords a
  // FRASES multi-palabra validadas por un médico (ver default-config.ts).
  const n = normalizeForSafety(message)
  for (const keyword of config.escalation_keywords) {
    const k = normalizeForSafety(keyword)
    if (!k) continue
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(n)) return keyword
  }
  return null
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
  // Frescura del hilo: reutilizar la conversación MÁS RECIENTE del paciente
  // (cualquier status) si su última actividad fue hace menos de N días. Así
  // "Resuelta" ya NO corta el hilo ni borra la memoria — solo la saca de la cola
  // humana; la frescura la maneja el TIEMPO, no el click. Config por clínica.
  const { data: clinicCfg } = await supabaseAdmin
    .from('clinics').select('feature_config').eq('id', clinicId).maybeSingle()
  const freshnessDays = ((clinicCfg?.feature_config as { conversation_freshness_days?: number } | null)?.conversation_freshness_days) ?? 7

  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const lastActivity = (existing.last_message_at as string | null) ?? (existing.created_at as string)
    const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < freshnessDays) {
      // Hilo vivo → reutilizar (con memoria). Si estaba resuelta, el bot retoma.
      if (existing.status === 'resolved') {
        await supabaseAdmin.from('conversations').update({ status: 'active', triage_state: null }).eq('id', existing.id)
        return { ...(existing as Conversation), status: 'active', triage_state: null } as Conversation
      }
      return existing as Conversation
    }
    // Última actividad hace > N días → hilo fresco (cae a crear una nueva).
  }

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
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      whatsapp_message_id: whatsappMessageId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[saveMessage] Error:', error)
    return null
  }

  // Fuente única: TODO mensaje (paciente/agente/staff) bumpea last_message_at.
  // De esto dependen el orden de la bandeja, "esperando hace Xh", el no-leído y
  // el realtime de conversations (cada mensaje dispara un UPDATE). Antes se hacía
  // suelto en algunos call sites y varios replies del agente no lo bumpeaban.
  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  return (data as { id: string }).id
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
 * Maneja un mensaje de CRISIS detectado por la Capa 0. Detección + escalación +
 * alerta 🆘 SIEMPRE (Opción B). El mensaje de contención al paciente solo se
 * envía si Algia lo aprobó clínicamente (auto_message_approved). Nunca lanza.
 */
async function handleCrisis(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
  crisisCfg: CrisisConfig,
): Promise<void> {
  // 1. Contención al paciente — SOLO si el wording fue aprobado por Algia.
  if (crisisCfg.auto_message_approved) {
    const containment = buildContainmentMessage(crisisCfg, patient.name ?? undefined)
    const savedId = await saveMessage(conversation.id, 'agent', containment)
    // sendType 'crisis_containment' → recordWhatsAppSendFailure ALERTA al staff
    // (único tipo en ALERT_ON_SEND_FAILURE). Si falla, alguien lo ve YA.
    const sentId = await sendWhatsAppMessage(patientPhone, containment, clinicCreds, {
      clinicId: clinic.id, sendType: 'crisis_containment', conversationId: conversation.id,
      messageId: savedId ?? undefined, patientName: patient.name ?? undefined,
    })
    if (!sentId) {
      console.error(`[CAPA0][CRISIS] CRÍTICO: contención NO se envió (conv ${conversation.id})`)
    }
  } else {
    console.warn(`[CAPA0][CRISIS] auto_message_approved=false — no se envía contención, solo alerta al staff (conv ${conversation.id})`)
  }

  // 2. Escalar la conversación (si no lo estaba).
  if (conversation.status !== 'escalated') {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'crisis' } })
      .eq('id', conversation.id)
  }

  // 3. Alerta 🆘 SIEMPRE (rompe idempotencia).
  await notifyCrisis({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, patientMessage })

  // 4. Audit (sin el texto sensible del paciente, pero SÍ con el target para
  //    que la traza legal identifique la conversación afectada).
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinic.id, action: 'crisis_detected', actor_type: 'system',
      target_type: 'conversation', target_id: conversation.id,
      details: { urgency: 'emergency' },
    })
  } catch { /* no crítico */ }

  console.log(`[CAPA0][CRISIS] manejada. conv ${conversation.id}`)
}

/**
 * Maneja un servicio con regla escalate_human detectado por keyword ANTES del
 * LLM. Manda un mensaje fijo de "un asesor confirma antes de agendar" + escala +
 * avisa. El LLM nunca corre → nunca promete agendar. Nunca lanza.
 */
async function handleEscalateService(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  serviceLabel: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
): Promise<void> {
  const msg = `Para ${serviceLabel}, un asesor del consultorio confirma los detalles contigo antes de agendar. Ya les avisé y te contactan pronto. 🙂`
  await saveMessage(conversation.id, 'agent', msg)
  await sendWhatsAppMessage(patientPhone, msg, clinicCreds)

  if (conversation.status !== 'escalated') {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'servicio_escalate_human' } })
      .eq('id', conversation.id)
    await notifyStaffOfEscalation({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, reason: `Servicio que requiere validación humana: ${serviceLabel}` })
  } else {
    await refreshEscalationNotifications({ conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name, latestMessage: `Servicio que requiere validación humana: ${serviceLabel}` })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinic.id, action: 'escalate_service_deterministic', actor_type: 'system',
      target_type: 'conversation', target_id: conversation.id, details: { service: serviceLabel },
    })
  } catch { /* no crítico */ }

  console.log(`[CAPA0][ESCALATE-SVC] "${serviceLabel}" escalado determinista. conv ${conversation.id}`)
}

/**
 * Responde una CONSULTA de política de privacidad con el link configurado de la
 * clínica. Informativo — NO escala. Deja una línea ofreciendo el canal para
 * ejercer derechos (eso sí escala, por el otro handler). Nunca lanza.
 */
async function handlePrivacyPolicyLink(
  clinic: Clinic,
  conversation: { id: string },
  patientPhone: string,
  url: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
): Promise<void> {
  const msg =
    `Aquí puedes ver la política de tratamiento de datos de ${clinic.name}: ${url}\n\n` +
    `Si quieres ejercer un derecho sobre tus datos (acceder, corregir, eliminar, revocar), avísame y una persona del equipo te contacta. 🔐`
  await saveMessage(conversation.id, 'agent', msg)
  await sendWhatsAppMessage(patientPhone, msg, clinicCreds)
  console.log(`[CAPA0][POLITICA] link enviado. conv ${conversation.id}`)
}

/**
 * Maneja una solicitud sobre DATOS PERSONALES (ARCO) detectada por la Capa 0.
 * El bot NUNCA cumple la solicitud (no borra/exporta/rectifica): acusa recibo,
 * escala, y alerta al staff 🔐 (que responde dentro del término legal). El acuse
 * se envía siempre (es seguro, no promete resultado). Nunca lanza.
 */
async function handleDataRightsRequest(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
): Promise<void> {
  // 1. Acuse a la paciente.
  const ack = buildDataRightsAck(clinic.name)
  await saveMessage(conversation.id, 'agent', ack)
  await sendWhatsAppMessage(patientPhone, ack, clinicCreds)

  // 2. Escalar (si no lo estaba).
  if (conversation.status !== 'escalated') {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'data_rights_request' } })
      .eq('id', conversation.id)
  }

  // 3. Alerta 🔐 SIEMPRE (rompe idempotencia; created_at arranca el término legal).
  await notifyDataRightsRequest({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, patientMessage })

  // 4. Audit con target (traza legal — sin guardar el texto sensible).
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinic.id, action: 'data_rights_request', actor_type: 'system',
      target_type: 'conversation', target_id: conversation.id,
    })
  } catch { /* no crítico */ }

  console.log(`[CAPA0][DATOS] solicitud ARCO manejada. conv ${conversation.id}`)
}

/**
 * Maneja un pedido EXPLÍCITO de humano detectado por la Capa 0. Escala + avisa.
 * El handoff no tiene gate clínico (no es wording de crisis). Nunca lanza.
 */
async function handleHumanRequest(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
  crisisCfg: CrisisConfig,
): Promise<void> {
  await saveMessage(conversation.id, 'agent', crisisCfg.human_handoff_message)
  await sendWhatsAppMessage(patientPhone, crisisCfg.human_handoff_message, clinicCreds)

  if (conversation.status === 'escalated') {
    await refreshEscalationNotifications({ conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name, latestMessage: patientMessage })
  } else {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'pedido_humano' } })
      .eq('id', conversation.id)
    await notifyStaffOfEscalation({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, reason: patientMessage })
  }
  console.log(`[CAPA0][HUMANO] manejado. conv ${conversation.id}`)
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
  // Aviso de privacidad (obligatorio por Ley 1581). Fuente única de verdad en
  // buildPrivacyNotice — la pantalla de config legal lee la MISMA, sin drift.
  const privacyNotice = buildPrivacyNotice(clinic.name)

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
