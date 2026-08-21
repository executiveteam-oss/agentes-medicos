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
import { registrarEstadosDeEntrega } from '@/lib/whatsapp/delivery-status'
import { sanitizePatientMessage, isSupportedMessageType, isDocumentMediaType, getUnsupportedTypeMessage } from '@/lib/whatsapp/sanitize'
import { nombreMedicoParaPaciente } from '@/lib/utils/normalize-name'
import { detectarTipoDeRespuesta, buscarCitaConRecordatorioPendiente } from '@/lib/whatsapp/reminder-response'
import { stripTimestampMarkers } from '@/lib/whatsapp/strip-timestamp-markers'
import { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } from '@/lib/agent/agent-context'
import { verifyWebhookSignature } from '@/lib/whatsapp/verify-signature'
import { runAppointmentAgent } from '@/agents/appointment-agent'
import { trackTokenUsage, isClinicPaused } from '@/lib/api-usage'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/utils/dates'
import { syncClinicSheet } from '@/lib/google-sheets'
import { notifyStaffOfEscalation, notifyCrisis, notifyDataRightsRequest, refreshEscalationNotifications } from '@/lib/notifications/escalation-notify'
import { escalarConversacion, mensajeEscalacionFallida } from '@/lib/conversations/escalar'
import { serviciosPendientes, type ContextPendientes } from '@/lib/conversations/pendientes'
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
import { ESCALATION_REASONS, escalationContext } from '@/lib/conversations/escalation-reasons'
import { detectarMencionDeMedico, leerPin, contextConPin } from '@/lib/agent/doctor-pin'
import { detectDoctorNameMismatch, detectDatosSinRespaldo, detectPromesaDeHumanoSinEscalar, detectCitaNegadaQueEllaAfirma, detectPreparacionInventada } from '@/lib/whatsapp/agent-guards'
import type { ToolCallAudit } from '@/lib/safety/tool-input-audit'
import { stripInternalMonologue } from '@/lib/whatsapp/strip-internal-monologue'

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

      // ── ESTADOS DE ENTREGA ────────────────────────────────────
      // Meta manda acá el sent/delivered/read/failed de lo que enviamos NOSOTROS.
      // Antes se descartaba junto con todo lo que no fuera un mensaje entrante,
      // y por eso "Meta aceptó el envío" era lo único que el sistema sabía: un
      // resumen aceptado y no entregado se veía idéntico a uno que llegó.
      if (value.statuses && value.statuses.length > 0) {
        const clinicDelStatus = await findClinicByPhoneId(value.metadata.phone_number_id)
        const n = await registrarEstadosDeEntrega(value.statuses, clinicDelStatus?.id ?? null)
        console.log(`[Webhook] Estados de entrega registrados: ${n}/${value.statuses.length}`)
      }

      // Sin mensaje entrante no hay nada más que hacer con este change.
      if (!value.messages || value.messages.length === 0) {
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
          // Sin token no hay forma de responderle. Lo único que queda es que no
          // se pierda: un console.error se evapora, y esto es una paciente que
          // mandó un archivo y del que NADIE puede enterarse nunca.
          console.error('[Webhook] media recibido sin clinicCreds — clínica sin token WhatsApp configurado')
          try {
            await supabaseAdmin.from('audit_log').insert({
              clinic_id: clinic.id,
              action: 'media_sin_credenciales',
              actor_type: 'patient',
              target_type: 'patient',
              target_id: patient.id,
              details: {
                tipo: message.type,
                nota: 'La paciente mandó un archivo y la clínica no tiene WhatsApp configurado: no se le pudo acusar recibo ni escalar.',
              },
            })
          } catch { /* no crítico */ }
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
              context: escalationContext(
                conversation.context,
                ESCALATION_REASONS.MEDIA_DISABLED,
                `Tipo de archivo: ${message.type}`,
              ),
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
          // Si la clínica PIDIÓ un documento para una cita, eso manda sobre la
          // heurística del texto: el template dice "orden médica", no
          // "autorización", así que buscar esa palabra lo clasificaría mal.
          // Y si hay EXACTAMENTE una cita esperando, el archivo se ata sola;
          // con varias queda sin atar y la secretaria elige — adivinar sería peor.
          const citasEsperando = await citasEsperandoDocumento(patient.id, clinic.id)
          const aptDelDocumento = citasEsperando.length === 1 ? citasEsperando[0] : null
          const isAuthContext = citasEsperando.length > 0
            ? true
            : lastAgentMsg?.content
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
            appointmentId: aptDelDocumento,
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
                context: escalationContext(
                  conversation.context,
                  ESCALATION_REASONS.AUTHORIZATION_REVIEW,
                  // El nombre del archivo, NO el servicio ni el convenio: si el
                  // detalle entra en el motivo, cada caso es su propio grupo.
                  filename ?? `Archivo ${message.type}`,
                ),
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

          // Caso no-autorización: acuse + escalar.
          //
          // Acá decía "el agente reacciona normalmente al próximo turno (verá el
          // placeholder en el historial)" y hacía `return` sin responder nada.
          // Pero si la paciente no vuelve a escribir NO HAY próximo turno: el
          // archivo quedaba guardado y la conversación muerta. Pasó tres veces
          // (11, 14 y 17/08) y las tres se quedaron sin una sola respuesta.
          //
          // No se le pasa al modelo a propósito: no sabemos qué mandó ni para
          // qué, así que cualquier cosa que redacte sobre el contenido sería
          // inventada. Lo único cierto es que llegó — eso se acusa, y lo mira
          // una persona.
          const acuse =
            '📎 Recibí tu archivo, gracias. Ya lo tenemos.\n' +
            'Una persona del consultorio lo revisa y te escribe por acá.'
          await sendWhatsAppMessageWithResult(message.from, acuse, clinicCreds, {
            clinicId: clinic.id, sendType: 'agent_reply', conversationId: conversation.id,
          })
          await saveMessage(conversation.id, 'agent', acuse)
          await supabaseAdmin
            .from('conversations')
            .update({
              status: 'escalated',
              escalated_at: new Date().toISOString(),
              context: escalationContext(
                conversation.context,
                ESCALATION_REASONS.MEDIA_RECEIVED,
                filename ?? `Archivo ${message.type}`,
              ),
              last_message_at: new Date().toISOString(),
            })
            .eq('id', conversation.id)
          await notifyStaffOfEscalation({
            clinicId: clinic.id,
            conversationId: conversation.id,
            patientName: patient.name,
            reason: 'Mandó un archivo — hay que ver qué necesita',
          })
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

      // La paciente RESPONDIÓ: se apaga el reloj del contacto general. Ese
      // pendiente existe para hacer visible el silencio, y ya no hay silencio.
      await limpiarPendiente(conversation.id, 'contacto_enviado_at')

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
        await handleEscalateService(clinic, patient, conversation, message.from, escSvc.label ?? 'ese servicio', escSvc.key ?? 'desconocido', clinicCreds)
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

      // 15.4. GATE DE CONSENTIMIENTO — manda el aviso y SIGUE.
      //
      // Antes esto vivía después del recordatorio y del NPS, y hacía `return`:
      // la paciente recibía el aviso de la Ley 1581 y su mensaje se descartaba.
      // El 2026-08-18 cinco pacientes tocaron "Confirmar"/"Cancelar" y sólo
      // recibieron el aviso legal — una de ellas cancelaba una cita que quedó
      // activa. El aviso es una obligación, no una respuesta.
      //
      // Va ANTES del recordatorio a propósito: así el aviso sale igual aunque
      // el mensaje se resuelva ahí abajo y corte. La Capa 0 (crisis, ARCO)
      // sigue arriba de todo — quien está en crisis no espera a un aviso legal.
      if (!patient.data_consent_at) {
        await handleNewPatient(clinic, patient, message.from, conversation.id, clinicCreds)
        // Sin `return`: el mensaje sigue su curso y se responde de verdad.
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

      // 16.5. Verificar palabras clave de escalamiento
      const escalationMatch = checkEscalationKeywords(sanitizedText, waConfig)
      if (escalationMatch) {
        const escalationMsg = `Entiendo que necesitas ayuda urgente. Voy a pasar tu mensaje a alguien del consultorio para que te atienda lo antes posible. 🙏`
        await saveMessage(conversation.id, 'agent', escalationMsg)
        await sendWhatsAppMessage(message.from, escalationMsg, clinicCreds)
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
            // Antes este camino NO estampaba motivo: quedaba indistinguible de
            // una conversación sin causa registrada. Y es el que más falsos
            // positivos produce, porque la lista la escribe la clínica y ahí
            // entran palabras de uso diario ("médico" ya disparó una).
            context: escalationContext(
              conversation.context,
              ESCALATION_REASONS.KEYWORD,
              escalationMatch,
            ),
          })
          .eq('id', conversation.id)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'conversation_escalated',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            details: { reason: ESCALATION_REASONS.KEYWORD, keyword: escalationMatch, urgency: 'high' },
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

      let agentResponse: { text: string; toolsUsed: string[]; toolCalls: ToolCallAudit[]; tokenUsage?: { input: number; output: number }; appointmentData?: { id: string; starts_at: string; ends_at: string; doctor_name: string; consultation_type: string | null; sequence: number }; escalate?: { reason: string; code: string }; hechosDeTools?: { diasQueAtiende: string[]; fechasDeTools: string[]; minutosDeSlots: number[]; huboSlots: boolean }; contratoDeSalida?: { origen: string; descartados: number; descartadosTexto: string[] } }

      // ── PIN DEL MÉDICO (capa 1) ─────────────────────────────────────
      // Si la paciente nombra un médico, deja de ser texto y pasa a ser una
      // restricción que el executor hace cumplir. Se resuelve contra el set
      // CERRADO de médicos de esta clínica, y ante cualquier ambigüedad no se
      // pinea (ver doctor-pin.ts: pinear al equivocado sería peor que no
      // pinear, porque además bloquearía al correcto).
      //
      // El primero gana: una vez pineado no se sobreescribe con menciones
      // posteriores. Si la paciente realmente quiere cambiar de médico, eso lo
      // resuelve una persona — no un match de texto a mitad de conversación.
      let pinMedico = leerPin(conversation.context as Record<string, unknown> | null)
      if (!pinMedico) {
        const detectado = detectarMencionDeMedico(sanitizedText, doctors, { nombrePaciente: patient.name })
        if (detectado) {
          pinMedico = detectado
          const ctxConPin = contextConPin(conversation.context as Record<string, unknown> | null, detectado)
          await supabaseAdmin.from('conversations').update({ context: ctxConPin }).eq('id', conversation.id)
          conversation.context = ctxConPin as typeof conversation.context
          console.log(`[Webhook] 📌 Médico pineado: ${detectado.doctor_name}`)
          try {
            await supabaseAdmin.from('audit_log').insert({
              clinic_id: clinic.id, action: 'doctor_pinned', actor_type: 'system',
              target_type: 'conversation', target_id: conversation.id,
              details: { doctor_id: detectado.doctor_id, doctor_name: detectado.doctor_name },
            })
          } catch { /* non-critical */ }
        }
      }

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
        // La paciente YA está resuelta acá. Las tools que preguntan por SUS
        // datos usan este id, no el teléfono que escriba el modelo.
        patientId: patient.id,
        existingPatient,
        tratanteMode,
        tratantes: resolvedTratantes,
        pinMedico,
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
        // Mapeo explícito: un `else` que agrupaba todo mandaba cualquier motivo
        // nuevo a 'falla_agendamiento', que es falso y arruina la agrupación del
        // informe de escalaciones.
        const motivoEsc =
          agentResponse.escalate.reason === 'tool_technical_error' ? ESCALATION_REASONS.TOOL_ERROR
          : agentResponse.escalate.reason === 'convenio_no_reconocido' ? ESCALATION_REASONS.UNKNOWN_CONVENIO
          : agentResponse.escalate.reason === 'clinica_no_operativa' ? ESCALATION_REASONS.CLINIC_NOT_OPERATING
          : agentResponse.escalate.reason === 'servicio_no_existe_con_medico' ? ESCALATION_REASONS.SERVICE_NOT_WITH_DOCTOR
          : ESCALATION_REASONS.BOOKING_FAILURE
        // Se captura acá porque adentro del closure TS pierde el narrowing.
        const codigoEsc = agentResponse.escalate.code
        // Escalar PRIMERO. El texto que sigue depende de que esto haya entrado:
        // si la conversación no queda marcada, no hay nadie del otro lado y
        // prometer una persona sería mentir (patrón 1).
        const escalacion = await escalarConversacion({
          conversationId: conversation.id,
          clinicId: clinic.id,
          motivo: motivoEsc,
          detalle: codigoEsc,
          contextPrevio: conversation.context,
          notificar: () => refreshEscalationNotifications({
            conversationId: conversation.id,
            clinicId: clinic.id,
            patientName: patient.name,
            latestMessage:
              motivoEsc === ESCALATION_REASONS.TOOL_ERROR
                ? `⚠ El agente tuvo un error técnico (${codigoEsc}) — revisar el sistema y atender a la paciente`
                : motivoEsc === ESCALATION_REASONS.UNKNOWN_CONVENIO
                  ? `⚠ La paciente dijo un convenio que NO tenemos registrado — confirmar si existe cobertura ANTES de mandarla a particular`
                  : `⚠ El agente no pudo agendar (${codigoEsc}) — hay que agendar a mano y revisar`,
          }),
        })
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinic.id,
          action:
            motivoEsc === ESCALATION_REASONS.TOOL_ERROR ? 'agent_tool_error_escalated'
            : motivoEsc === ESCALATION_REASONS.UNKNOWN_CONVENIO ? 'agent_unknown_convenio_escalated'
            : 'agent_booking_failure_escalated',
          actor_type: 'agent',
          target_type: 'conversation',
          target_id: conversation.id,
          // El teléfono NO va completo: el CLAUDE.md lo prohíbe y el target_id ya
          // identifica la conversación para cualquier traza.
          details: { code: agentResponse.escalate.code, reason: agentResponse.escalate.reason },
        })
        // El texto del agente promete una persona. Sólo sale si la hay.
        const textoEsc = escalacion.ok
          ? agentResponse.text
          : mensajeEscalacionFallida(clinic.phone)
        await saveMessage(conversation.id, 'agent', textoEsc)
        await sendWhatsAppMessage(message.from, textoEsc, clinicCreds)
        console.warn(`[Webhook] 🚨 Escalación del agente (${motivoEsc}): ${codigoEsc}${escalacion.ok ? '' : ' — ⚠️ NO SE PUDO ESCALAR'}`)
        return
      }

      // ⚰️ ACÁ VIVÍA EL "POST-CITA LOCKOUT" — no lo revivas.
      //
      // Cortaba el turno cuando el agente llamaba check_availability teniendo
      // una cita ya confirmada, y respondía un texto fijo. Estaba mal de dos
      // formas distintas:
      //
      // 1. EL VERBO. check_availability es una LECTURA: no escribe, no promete
      //    y no puede hacer daño. Lo único peligroso es crear una cita de más,
      //    y eso nunca lo miró. Consecuencia: a quien quería MOVER su cita se
      //    le cortaba la consulta de horarios, que es justo lo que necesitaba.
      //
      // 2. EL LUGAR. Acá las tools YA CORRIERON (runAppointmentAgent, arriba).
      //    Un guard en este punto no puede impedir una escritura: la fila ya
      //    está en la base. Lo único que lograría es tragarse el mensaje de
      //    confirmación y dejar una cita fantasma que la paciente no conoce.
      //    Si algún día hace falta bloquear una segunda cita, va en el
      //    executor ANTES del insert, junto a los otros BLOCKED_BY_*.
      //
      // Además dependía de matchear palabras ("otra cita", "adicional") para
      // detectar la excepción, así que "modificar" y "reprogramar" caían del
      // lado equivocado. Disparó 4 veces en 4 meses, las 4 contra pacientes
      // que estaban pidiendo algo legítimo, y nunca bloqueó una escritura.
      //
      // La capa A (regla del prompt) sigue viva y ahora habla del verbo
      // correcto: mirar horarios siempre se puede; crear una SEGUNDA cita
      // requiere que la paciente la pida.

      // GUARD 6 (días/fechas/horarios sin respaldo de tool) — corrige al MODELO.
      //
      // Mismo patrón que el guard 4: el mensaje no sale, se le devuelve al
      // modelo su propio texto con la corrección y se re-corre el turno. Si en
      // el 2º intento vuelve a inventar, AHÍ se escala. La paciente no ve nada
      // de esto: el error es nuestro y no se le traslada.
      //
      // TODO bloqueo se audita con el texto que se iba a enviar, qué chequeo lo
      // frenó y qué decía la tool. Sin eso, un guard que corta de más se
      // descubre por una paciente sin respuesta, no por una query.
      {
        const anioRef = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 4))
        let g6 = detectDatosSinRespaldo({ agentText: agentResponse.text, hechos: agentResponse.hechosDeTools, anioRef })
        if (g6.blocked) {
          const auditar = async (intento: number, escalado: boolean) => {
            try {
              await supabaseAdmin.from('audit_log').insert({
                clinic_id: clinic.id, action: 'datos_sin_respaldo_blocked', actor_type: 'system',
                target_type: 'conversation', target_id: conversation.id,
                details: {
                  intento, escalado,
                  chequeo: (g6.details as { chequeo?: number })?.chequeo ?? null,
                  motivo: g6.reason,
                  detalle: g6.details ?? null,
                  texto_bloqueado: agentResponse.text.slice(0, 600),
                  hechos_de_tools: agentResponse.hechosDeTools ?? null,
                  tools_usadas: agentResponse.toolsUsed,
                },
              })
            } catch { /* non-critical */ }
          }
          console.error(`[Webhook] 🚨 GUARD 6 ${g6.reason} (chequeo ${(g6.details as {chequeo?:number})?.chequeo}) — re-corriendo al modelo`)
          await auditar(1, false)

          const textoMalo = agentResponse.text
          try {
            agentResponse = await runAppointmentAgent({
              ...agentParams,
              selfCorrection: {
                priorAssistantText: textoMalo,
                note: '[Corrección interna del sistema — la paciente NO ve este mensaje] En tu respuesta anterior afirmaste un día, una fecha o un horario que NO salió de ninguna tool en este turno: ' +
                  JSON.stringify(g6.details ?? {}) +
                  '. Reescribí el mensaje usando ÚNICAMENTE los días, fechas y horarios que las tools devolvieron, copiados tal cual. Si no tenés el dato, NO lo inventes: pedí disculpas y ofrecé verificarlo.',
              },
            })
          } catch (e) {
            console.error('[Webhook] Re-run guard 6 falló:', e instanceof Error ? e.message : e)
          }

          g6 = detectDatosSinRespaldo({ agentText: agentResponse.text, hechos: agentResponse.hechosDeTools, anioRef })
          if (g6.blocked) {
            console.error('[Webhook] 🚨 GUARD 6 persistió tras re-run — escalando')
            await auditar(2, true)
            agentResponse = {
              ...agentResponse,
              text: 'Disculpá, quiero confirmarte los horarios exactos antes de decirte algo equivocado. Ya le pasé tu caso a una persona del consultorio y te escriben enseguida 🙏',
            }
            await supabaseAdmin.from('conversations')
              .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: escalationContext(conversation.context, ESCALATION_REASONS.BOOKING_FAILURE, `datos_sin_respaldo:${g6.reason}`) })
              .eq('id', conversation.id)
            await refreshEscalationNotifications({
              conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name,
              latestMessage: `⚠️ El agente afirmó días/fechas/horarios que no salieron de una tool (${g6.reason}). Revisar con la paciente.`,
            })
          }
        }
      }

      // GUARD 5 (médico distinto al prometido) — va ANTES del guard 4 porque
      // acá la cita YA existe: el daño no es un mensaje falso sino una fila en
      // la agenda del médico equivocado, ocupando un cupo real.
      //
      // NO se cancela automáticamente, a propósito. Un falso positivo del guard
      // cancelaría una cita buena, y eso no se deshace: la paciente ya recibió
      // el .ics y se organizó. Escalar es reversible; cancelar no. La persona
      // que la tome ve en la alerta exactamente qué se prometió y qué se agendó.
      if (agentResponse.appointmentData) {
        const mismatch = detectDoctorNameMismatch({
          agentText: agentResponse.text,
          priorAgentTexts: messageHistory.filter((m) => m.role === 'agent').slice(-3).reverse().map((m) => m.content),
          appointmentDoctorName: agentResponse.appointmentData.doctor_name,
          doctors,
          patientName: patient.name,
        })
        if (mismatch.blocked) {
          const d = (mismatch.details ?? {}) as { prometido?: string; agendado?: string }
          console.error(`[Webhook] 🚨 GUARD 5 doctor_name_mismatch — prometido="${d.prometido}" agendado="${d.agendado}"`)
          try {
            await supabaseAdmin.from('audit_log').insert({
              clinic_id: clinic.id, action: 'doctor_name_mismatch_blocked', actor_type: 'system',
              target_type: 'appointment', target_id: agentResponse.appointmentData.id,
              details: { ...mismatch.details, conversation_id: conversation.id, appointment_id: agentResponse.appointmentData.id },
            })
          } catch { /* non-critical */ }

          // La paciente NO recibe la confirmación equivocada. Y no se le pide
          // que repita nada: el error es nuestro.
          agentResponse = {
            ...agentResponse,
            text: `Disculpá, tuve un cruce con el médico de tu cita y no quiero confirmarte algo equivocado. ` +
                  `Ya le pasé tu caso a una persona del consultorio para que lo revise y te confirme bien. Te escriben enseguida 🙏`,
            appointmentData: undefined,
          }
          await supabaseAdmin.from('conversations')
            .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: escalationContext(conversation.context, ESCALATION_REASONS.BOOKING_FAILURE, `medico_prometido=${d.prometido} agendado=${d.agendado}`) })
            .eq('id', conversation.id)
          await refreshEscalationNotifications({
            conversationId: conversation.id,
            clinicId: clinic.id,
            patientName: patient.name,
            latestMessage: `⚠️ Cita creada con médico distinto al prometido: se le dijo ${d.prometido} y quedó con ${d.agendado}. Revisar cita ${agentResponse.appointmentData?.id ?? ''}`,
          })
        }
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
              .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: escalationContext(conversation.context, ESCALATION_REASONS.BOOKING_FAILURE) })
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
      // Strip DETERMINISTA del monólogo interno. El loop de tools acumula el
      // texto de TODAS las iteraciones (appointment-agent: collectedTexts) y las
      // une con '\n\n', así que el razonamiento intermedio viaja pegado a la
      // respuesta. A una paciente le llegó "Debo llamar create_appointment ahora
      // con los datos confirmados". Va acá, junto al strip del timestamp, porque
      // es el mismo tipo de problema: algo que el modelo emite y ella no debe ver.
      const { text: sinMonologo, removidos: monologosRemovidos } = stripInternalMonologue(cleanText)
      if (monologosRemovidos > 0) {
        console.warn(`[Webhook] ⚠ MONÓLOGO INTERNO: removidos ${monologosRemovidos} bloque(s) antes de enviar`)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'internal_monologue_stripped',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            // El contador es la señal: si sube, el modelo está narrando de más y
            // hay que mirar el prompt además de este filtro.
            details: { bloques: monologosRemovidos },
          })
        } catch { /* no crítico */ }
      }

      // El CONTRATO DE SALIDA ya eligió qué bloque del loop lee la paciente
      // (src/lib/agent/contrato-de-salida.ts). Registramos qué regla decidió y
      // qué quedó afuera: sin esto, "¿el contrato le está borrando algo a
      // alguien?" sólo se puede contestar mirando logs que caducan. El texto
      // descartado se guarda recortado —es texto del agente, no de la paciente—
      // y sólo cuando efectivamente se descartó algo.
      const contrato = agentResponse.contratoDeSalida
      if (contrato && contrato.descartados > 0) {
        console.log(`[Webhook] contrato de salida: origen=${contrato.origen}, descartados=${contrato.descartados}`)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'contrato_salida_descarto',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            details: {
              origen: contrato.origen,
              descartados: contrato.descartados,
              bloques: contrato.descartadosTexto.slice(0, 3).map((b) => b.slice(0, 300)),
            },
          })
        } catch { /* no crítico */ }
      }

      // `let` y no `const`: el guard 9 puede reemplazar este texto ANTES de
      // guardarlo y enviarlo (los guards 7 y 8 corren después del envío porque
      // sólo escalan; éste cambia lo que la paciente lee).
      const strippedTs = stripTimestampMarkers(sinMonologo)
      let sendText = strippedTs.text
      const tsStripped = strippedTs.stripped
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

      // 18.9 GUARD 9 — afirmó una preparación que nadie cargó.
      //
      // Va ACÁ, sobre `sendText`, y no en el bucle de guards de arriba, porque
      // además de reemplazar el texto tiene que ESCALAR: el mensaje le promete
      // a la paciente que el consultorio le confirma la indicación, y una
      // promesa sin respaldo es exactamente lo que el guard 7 existe para
      // impedir. Reemplazar sin escalar sería crear el bug de al lado.
      const preparacionesCargadas = (consultationTypes ?? [])
        .map((ct) => (ct as { preparacion?: string | null }).preparacion ?? '')
        .filter((t) => t.trim().length > 0)
      const g9 = detectPreparacionInventada({ agentText: sendText, preparacionesCargadas })
      if (g9.blocked && g9.replacement) {
        console.warn(`[Webhook] 🚨 Guard 9: preparación inventada (cargadas=${preparacionesCargadas.length}) → reemplazar y escalar`)
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'preparacion_inventada_bloqueada',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            details: {
              texto_que_lo_activo: sendText.slice(0, 500),
              preparaciones_cargadas: preparacionesCargadas.length,
            },
          })
        } catch { /* no crítico */ }
        sendText = g9.replacement
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
            context: escalationContext(conversation.context, ESCALATION_REASONS.PROMISE_WITHOUT_ESCALATION),
          })
          .eq('id', conversation.id)
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: 'Preguntó por la preparación de un examen y no la tenemos cargada — hay que confirmársela',
        })
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
              // Se explica solo: el agente ya NO lo anuncia antes. Este mensaje
              // sale DESPUÉS de que el archivo existe de verdad, así que si el
              // hosting falla la paciente no queda esperando nada.
              : `📅 Guarda tu cita en el calendario de tu celular:\n${icsLink}\nÁbrelo y toca "Agregar" y te recuerda solita antes de la cita. Si no se abre, búscalo en tus descargas — el enlace funciona hasta el día de tu cita.`
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
            context: escalationContext(conversation.context, ESCALATION_REASONS.AGENT_TOOL),
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

      // 20.05 GUARD 7 — prometió una persona y no escaló.
      //
      // Corre DESPUÉS del envío a propósito: no reemplaza el texto. La promesa
      // que la paciente ya leyó es correcta —alguien tiene que contactarla—;
      // lo único que faltaba era cumplirla. Lo que se arregla es el estado de
      // la conversación, no el mensaje.
      const g7 = detectPromesaDeHumanoSinEscalar({
        agentText: sendText,
        toolsUsed: agentResponse.toolsUsed,
        // Los DOS caminos de escalación: la tool y el corte determinista.
        yaVaAEscalar: agentResponse.toolsUsed.includes('escalate_to_human') || Boolean(agentResponse.escalate),
        // Si hay un servicio ruleado marcado y sin gestionar, la frase "un
        // asesor confirma los detalles" TIENE respaldo: el servicio quedó
        // registrado y la conversación está en la pestaña Servicios. Misma
        // fuente que la cola — serviciosPendientes, no leer el context a mano.
        tieneServicioPendiente: serviciosPendientes(conversation.context as ContextPendientes).length > 0,
      })
      if (g7.blocked) {
        console.warn('[Webhook] 🚨 Guard 7: prometió una persona sin escalar → escalando')
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
            context: escalationContext(conversation.context, ESCALATION_REASONS.PROMISE_WITHOUT_ESCALATION),
          })
          .eq('id', conversation.id)
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: 'El agente le prometió que alguien la contactaría — hay que cumplirlo',
        })
        // Con el texto que lo activó, para poder medir falsos positivos en una
        // semana. Sin esto el guard es una caja negra que nadie puede evaluar.
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'promesa_sin_escalar_detectada',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            details: {
              texto_que_lo_activo: sendText.slice(0, 500),
              familia: (g7.details as { familia?: string } | undefined)?.familia ?? null,
              tools_used: agentResponse.toolsUsed,
            },
          })
        } catch { /* no crítico */ }
      }

      // 20.06 GUARD 8 — negó una cita que ella sostiene que tiene.
      //
      // Igual que el 7: no reemplaza el texto, escala. Un vacío del tool no es
      // una certeza — significa que no la encontramos, no que ella se equivoque.
      const g8 = detectCitaNegadaQueEllaAfirma({
        agentText: sendText,
        patientText: sanitizedText,
        toolsUsed: agentResponse.toolsUsed,
        yaVaAEscalar: agentResponse.toolsUsed.includes('escalate_to_human') || Boolean(agentResponse.escalate) || g7.blocked,
      })
      if (g8.blocked) {
        console.warn('[Webhook] 🚨 Guard 8: negó una cita que la paciente afirma tener → escalando')
        await supabaseAdmin
          .from('conversations')
          .update({
            status: 'escalated',
            escalated_at: new Date().toISOString(),
            context: escalationContext(conversation.context, ESCALATION_REASONS.APPOINTMENT_NOT_FOUND),
          })
          .eq('id', conversation.id)
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: 'Dice que tiene una cita y el sistema no la encuentra — verificar en el HIS',
        })
        try {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinic.id,
            action: 'cita_negada_que_ella_afirma',
            actor_type: 'system',
            target_type: 'conversation',
            target_id: conversation.id,
            details: {
              texto_del_agente: sendText.slice(0, 400),
              texto_de_la_paciente: sanitizedText.slice(0, 300),
              // Si es false, el modelo negó SIN consultar la agenda: eso no es
              // un no-encuentro, es una afirmación sin respaldo.
              consulto_agenda: (g8.details as { consulto_agenda?: boolean } | undefined)?.consulto_agenda ?? null,
              tools_used: agentResponse.toolsUsed,
            },
          })
        } catch { /* no crítico */ }
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
              // Los ARGUMENTOS, con los campos sensibles ocultos. Sin esto, para
              // auditar el caso MEDPLUS hubo que deducir el insurer_type leyendo
              // el texto de la respuesta — y una deducción no es una traza.
              tool_calls: agentResponse.toolCalls,
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
  conversation: { id: string; status: string; context?: Record<string, unknown> | null },
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
    // Crisis: se escala con chequeo y reintento, pero el MENSAJE NO cambia
    // nunca. Las líneas de ayuda salen aunque la escalación falle — es lo
    // único que esta persona necesita ahora. El fallo queda en audit_log.
    await escalarConversacion({
      conversationId: conversation.id, clinicId: clinic.id,
      motivo: ESCALATION_REASONS.CRISIS, contextPrevio: conversation.context,
    })
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
  conversation: { id: string; status: string; context?: Record<string, unknown> | null },
  patientPhone: string,
  serviceLabel: string,
  serviceKey: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
): Promise<void> {
  // ¿Este servicio YA estaba marcado en esta conversación?
  const ctx = (conversation.context ?? {}) as Record<string, unknown>
  const marcados = Array.isArray(ctx.servicios_marcados) ? (ctx.servicios_marcados as string[]) : []
  const yaMarcado = marcados.includes(serviceKey)

  // Si insiste, NO repetir el mismo mensaje ni quedarse mudo: reconocer que ya
  // quedó marcado y seguir disponible para lo demás.
  const msg = yaMarcado
    ? `Ya le pasé tu solicitud de ${serviceLabel} al equipo, te contactan pronto. 🙂 Mientras tanto, ¿te ayudo con algo más?`
    : `Para ${serviceLabel}, un asesor del consultorio confirma los detalles contigo antes de agendar. Ya les avisé y te contactan pronto. 🙂`
  await saveMessage(conversation.id, 'agent', msg)
  await sendWhatsAppMessage(patientPhone, msg, clinicCreds)

  if (!yaMarcado) {
    // NO se toca `status`. Un servicio ruleado NO es una conversación tomada por
    // una persona: es un ítem marcado dentro de una conversación VIVA. Va a la
    // pestaña Atención por el eje B (triage_state) y el agente sigue respondiendo
    // por el eje A. Son los dos ejes de la bandeja, que acá venían fusionados: al
    // escalar el status, la paciente que preguntaba OTRA cosa se quedaba sin
    // respuesta (caso real: pidió mapeo → escaló; dijo "o una transvaginal" →
    // nadie le contestó, y esa sí se puede agendar).
    //
    // La seguridad no depende de esto: el executor bloquea create_appointment de
    // un servicio ruleado SIN mirar el estado de la conversación
    // (executor.ts:532, sin flags y sin acceso al status). Callar al agente era
    // redundante para la garantía y caro para la conversación.
    await supabaseAdmin
      .from('conversations')
      .update({
        triage_state: 'atencion',
        context: {
          ...ctx,
          escalation_reason: ESCALATION_REASONS.SERVICE_RULE,
          servicios_marcados: [...marcados, serviceKey],
          // CUÁNDO se marcó el primero. La cola de Atención se ordena por el
          // que espera hace más, y estas conversaciones NO tienen un mensaje
          // sin responder —el agente contesta—, así que sin este reloj caían al
          // final de la lista: justo lo contrario de por qué las pusimos ahí.
          servicios_marcados_at: (ctx.servicios_marcados_at as string | undefined) ?? new Date().toISOString(),
        },
      })
      .eq('id', conversation.id)
    await notifyStaffOfEscalation({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, reason: `Servicio que requiere validación humana: ${serviceLabel}` })
  } else {
    await refreshEscalationNotifications({ conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name, latestMessage: `Insiste con ${serviceLabel}` })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinic.id, action: 'escalate_service_deterministic', actor_type: 'system',
      target_type: 'conversation', target_id: conversation.id,
      details: { service: serviceLabel, service_key: serviceKey, ya_marcado: yaMarcado, corta_el_agente: false },
    })
  } catch { /* no crítico */ }

  console.log(`[CAPA0][ESCALATE-SVC] "${serviceLabel}" marcado (yaMarcado=${yaMarcado}). Agente SIGUE activo. conv ${conversation.id}`)
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
  conversation: { id: string; status: string; context?: Record<string, unknown> | null },
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
    // Derecho ARCO: obligación legal (Ley 1581). Chequeo, reintento y
    // audit_log si falla — no puede perderse en silencio.
    await escalarConversacion({
      conversationId: conversation.id, clinicId: clinic.id,
      motivo: ESCALATION_REASONS.DATA_RIGHTS, contextPrevio: conversation.context,
    })
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
  conversation: { id: string; status: string; context?: Record<string, unknown> | null },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
  crisisCfg: CrisisConfig,
): Promise<void> {
  // ORDEN INVERTIDO (2026-08-20): primero se escala, después se promete.
  //
  // Acá el mensaje salía ANTES del update. "Ya le pedí al equipo que te
  // contacte" se enviaba aunque la escalación no entrara, y la conversación
  // quedaba en `active`, sin marca y fuera de toda bandeja. Cinco pacientes
  // recibieron esa promesa entre el 12 y el 13/08 sin que nadie las viera.
  let escalacionOk = true
  if (conversation.status === 'escalated') {
    // Ya estaba escalada: sólo se refresca la alerta. No hay promesa nueva que
    // sostener, así que un fallo acá no cambia lo que ella lee.
    try {
      await refreshEscalationNotifications({ conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name, latestMessage: patientMessage })
    } catch (e) { console.error('[CAPA0][HUMANO] refresh de alerta falló:', e) }
  } else {
    const r = await escalarConversacion({
      conversationId: conversation.id,
      clinicId: clinic.id,
      motivo: ESCALATION_REASONS.HUMAN_REQUEST,
      contextPrevio: conversation.context,
      notificar: () => notifyStaffOfEscalation({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, reason: patientMessage }),
    })
    escalacionOk = r.ok
  }

  const textoHumano = escalacionOk
    ? crisisCfg.human_handoff_message
    : mensajeEscalacionFallida(clinic.phone)
  await saveMessage(conversation.id, 'agent', textoHumano)
  await sendWhatsAppMessage(patientPhone, textoHumano, clinicCreds)
  console.log(`[CAPA0][HUMANO] manejado. conv ${conversation.id}${escalacionOk ? '' : ' — ⚠️ NO SE PUDO ESCALAR'}`)
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
  const tipo = detectarTipoDeRespuesta(messageText)
  if (!tipo) return false

  // La cita que está contestando: la que ya recibió UN recordatorio, venga de
  // la ventana que venga. Antes esto exigía la de 24h y perdía los botones del
  // recordatorio de 72h — ver el comentario de reminder-response.ts.
  const pendingAppointment = await buscarCitaConRecordatorioPendiente(patientId, clinicId)

  if (!pendingAppointment) return false // No hay recordatorio pendiente

  if (tipo === 'confirmacion') {
    // Marcar como confirmada
    await supabaseAdmin
      .from('appointments')
      .update({ reminder_confirmed: true, confirmation_received: true })
      .eq('id', pendingAppointment.id)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('appointment_id', pendingAppointment.id)

    const response = '✅ ¡Perfecto, tu cita está confirmada! Te esperamos. Si necesitas algo más, escríbeme.'
    await saveMessage(conversationId, 'agent', response)
    await sendWhatsAppMessage(whatsappFrom, response, clinicCreds)

    console.log(`[Webhook] Recordatorio CONFIRMADO para cita ${pendingAppointment.id}`)
  } else if (tipo === 'cancelacion') {
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
    // CAMBIAR — se le ofrecen CUPOS CONCRETOS, no una pregunta.
    //
    // Antes esto contestaba "¿Qué día y hora te quedaría mejor?" y ahí murieron
    // 5 de las 21 conversaciones que pidieron cita y se fueron sin ella en una
    // semana. La paciente tocó un botón —un gesto de un segundo— y recibía algo
    // que exige pensar, elegir y escribir. Después de un botón van opciones.
    //
    // El context se MERGEA, no se pisa: sobrescribirlo entero borraba el motivo
    // de escalación si la conversación tenía uno.
    const { data: convActual } = await supabaseAdmin
      .from('conversations').select('context').eq('id', conversationId).maybeSingle()
    const contextActual = (convActual as { context?: Record<string, unknown> } | null)?.context
    await supabaseAdmin
      .from('conversations')
      .update({
        context: {
          ...((contextActual ?? {}) as Record<string, unknown>),
          wants_to_reschedule: true,
          appointment_id: pendingAppointment.id,
        },
      })
      .eq('id', conversationId)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'rescheduled' })
      .eq('appointment_id', pendingAppointment.id)

    // Los cupos salen de la MISMA fuente que usa el agente. Si no hay ninguno,
    // mensajeConCupos deriva a una persona en vez de preguntar al aire.
    const { proximosCuposLibres, mensajeConCupos } = await import('@/lib/calendar/proximos-cupos')
    const { data: medicoDeLaCita } = await supabaseAdmin
      .from('doctors').select('name').eq('id', pendingAppointment.doctor_id ?? '').maybeSingle()
    const cupos = pendingAppointment.doctor_id
      ? await proximosCuposLibres(clinicId, pendingAppointment.doctor_id, 3)
      : []
    const response = mensajeConCupos(
      cupos,
      nombreMedicoParaPaciente((medicoDeLaCita?.name as string) ?? '', null),
    )
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
  return (await citasEsperandoDocumento(patientId, clinicId)).length > 0
}

/**
 * Citas de esta paciente que están ESPERANDO un documento.
 *
 * Sin filtro de fecha a propósito: la orden médica se pide DESPUÉS de la
 * consulta —para radicar la cuenta—, así que la cita que la espera casi siempre
 * ya pasó. El filtro `starts_at >= now()` original servía para el caso previo
 * (documentos antes de agendar) y dejaba afuera justo este.
 */
async function citasEsperandoDocumento(patientId: string, clinicId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('documents_requested', true)
    .eq('documents_received', false)
    .in('status', ['confirmed', 'rescheduled', 'completed'])
    .order('starts_at', { ascending: false })
    .limit(5)
  return (data ?? []).map((a) => (a as { id: string }).id)
}


/**
 * Apaga un reloj de pendiente en la conversación. Lo llama el webhook cuando
 * llega lo que se estaba esperando: la orden médica (archivo recibido) o la
 * respuesta al contacto general (cualquier mensaje de la paciente).
 *
 * Si no queda ningún pendiente, la conversación sale de la cola de Atención —
 * salvo que esté escalada de verdad, donde el triage lo decide el status.
 */
async function limpiarPendiente(
  conversationId: string,
  campo: 'orden_medica_pedida_at' | 'contacto_enviado_at',
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('conversations').select('context, status, triage_state').eq('id', conversationId).maybeSingle()
    const ctx = { ...((data?.context ?? {}) as Record<string, unknown>) }
    if (!ctx[campo]) return
    delete ctx[campo]

    const { pendientesDe } = await import('@/lib/conversations/pendientes')
    const quedan = pendientesDe(ctx as never).length
    const patch: Record<string, unknown> = { context: ctx }
    // Sin pendientes y sin escalación real → vuelve a la vista del agente.
    if (quedan === 0 && data?.status !== 'escalated' && data?.triage_state === 'atencion') {
      patch.triage_state = null
    }
    await supabaseAdmin.from('conversations').update(patch).eq('id', conversationId)
  } catch (err) {
    console.error('[limpiarPendiente] no crítico:', err instanceof Error ? err.message : err)
  }
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
    // Sin filtro de futuro: la orden médica se pide DESPUÉS de la consulta, para
    // radicar la cuenta. Con `starts_at >= now()` la cita que la espera —que ya
    // pasó— quedaba afuera y el documento nunca se marcaba como recibido.
    .in('status', ['confirmed', 'rescheduled', 'completed'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!appointment) return

  // Marcar documentos como recibidos
  await supabaseAdmin
    .from('appointments')
    .update({
      documents_received: true,
      documents_received_at: new Date().toISOString(),
    })
    .eq('id', appointment.id)

  // Se apaga el reloj de la orden médica: ya llegó lo que se estaba esperando.
  await limpiarPendiente(conversationId, 'orden_medica_pedida_at')

  const response =
    `✅ ¡Recibimos tu documento, ${patientName}! Ya lo tenemos en tu expediente. ` +
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
