'use server'

// ============================================================
// Contactar a una paciente por iniciativa de la clínica.
//
// DOS CASOS, UNA REGLA: el canal lo decide el SISTEMA, no la secretaria.
//   · La paciente escribió en las últimas 24h → texto libre. Sin template, sin
//     aprobación de Meta, cualquier redacción.
//   · Fuera de esa ventana → template aprobado.
// Ella escribe el motivo y aprieta enviar; no tiene por qué saber qué es una
// ventana de conversación. Hoy `sendStaffMessage` falla con "Error enviando
// mensaje por WhatsApp" cuando la ventana está cerrada, sin decir por qué ni
// ofrecer salida.
//
// Y TODO LO QUE SALE Y ESPERA RESPUESTA DEJA RASTRO: la conversación pasa a
// Atención con su reloj, igual que un servicio ruleado. Un mensaje que sale y
// nadie contesta es el mismo agujero silencioso que attendance_outcome — la
// secretaria escribió, nadie respondió, nadie se enteró.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { ventanaAbierta } from '@/lib/whatsapp/ventana-24h'
import { checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import { sendWhatsAppMessageWithResult, sendWhatsAppTemplate, getClinicCreds } from '@/lib/whatsapp/client'
import {
  CONTACTO_TEMPLATE_NAME, CONTACTO_TEMPLATE_BODY,
  ORDEN_TEMPLATE_NAME, ORDEN_TEMPLATE_BODY, TEMPLATE_LANGUAGE,
} from '@/lib/whatsapp/appointment-templates'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import type { ContextPendientes } from '@/lib/conversations/pendientes'


/** Rellena {{1}}, {{2}}… en orden. Solo para la VISTA PREVIA — el envío real
 *  manda los parámetros y Meta arma el texto con la plantilla aprobada. */
export async function renderTemplate(body: string, params: string[]): Promise<string> {
  return params.reduce((txt, v, i) => txt.replaceAll(`{{${i + 1}}}`, v), body)
}


export interface PreviewContacto {
  ok: boolean
  error?: string
  /** Lo que la paciente va a ver, ya armado. */
  texto?: string
  /** 'libre' = texto tal cual · 'template' = plantilla aprobada. */
  canal?: 'libre' | 'template'
}

/**
 * VISTA PREVIA — el mensaje completo, con el nombre de la clínica y el motivo
 * puesto. Sin esto la secretaria manda a ciegas algo que sale con la marca de
 * la clínica.
 */
export async function previewContactoGeneral(
  conversationId: string,
  motivo: string,
): Promise<PreviewContacto> {
  try {
    const clinicId = await checkWritePermission('conversations')
    if (!motivo.trim()) return { ok: false, error: 'Escribí el motivo del mensaje' }

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, patients(name, first_name)')
      .eq('id', conversationId).eq('clinic_id', clinicId).maybeSingle()
    if (!conv) return { ok: false, error: 'Conversación no encontrada' }

    const { data: clinic } = await supabaseAdmin.from('clinics').select('name').eq('id', clinicId).single()
    const paciente = (conv.patients as unknown as { name: string; first_name: string | null } | null)
    const nombre = (paciente?.first_name || paciente?.name || 'Hola').split(' ')[0]

    const abierta = await ventanaAbierta(conversationId)
    const texto = abierta
      ? motivo.trim()
      : await renderTemplate(CONTACTO_TEMPLATE_BODY, [nombre, (clinic?.name as string) ?? '', motivo.trim()])

    return { ok: true, texto, canal: abierta ? 'libre' : 'template' }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Envía el contacto general y marca la conversación como esperando respuesta. */
export async function enviarContactoGeneral(
  conversationId: string,
  motivo: string,
): Promise<{ ok: boolean; error?: string; canal?: 'libre' | 'template' }> {
  try {
    const clinicId = await checkWritePermission('conversations')
    if (!motivo.trim()) return { ok: false, error: 'Escribí el motivo del mensaje' }

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, whatsapp_phone, context, patients(name, first_name)')
      .eq('id', conversationId).eq('clinic_id', clinicId).maybeSingle()
    if (!conv) return { ok: false, error: 'Conversación no encontrada' }

    const creds = await getClinicCreds(clinicId)
    if (!creds) return { ok: false, error: 'La clínica no tiene WhatsApp configurado' }

    const { data: clinic } = await supabaseAdmin.from('clinics').select('name').eq('id', clinicId).single()
    const paciente = (conv.patients as unknown as { name: string; first_name: string | null } | null)
    const nombre = (paciente?.first_name || paciente?.name || 'Hola').split(' ')[0]
    const telefono = (conv.whatsapp_phone as string).replace('+', '')

    const abierta = await ventanaAbierta(conversationId)
    let enviado = false
    let textoGuardado = ''

    if (abierta) {
      textoGuardado = motivo.trim()
      const r = await sendWhatsAppMessageWithResult(telefono, textoGuardado, creds,
        { clinicId, conversationId, sendType: 'contacto_general' })
      enviado = r.ok
    } else {
      const r = await sendWhatsAppTemplate(telefono, CONTACTO_TEMPLATE_NAME, TEMPLATE_LANGUAGE,
        [nombre, (clinic?.name as string) ?? '', motivo.trim()], null, creds,
        { clinicId, conversationId, sendType: 'contacto_general' })
      enviado = r.ok
      textoGuardado = await renderTemplate(CONTACTO_TEMPLATE_BODY, [nombre, (clinic?.name as string) ?? '', motivo.trim()])
    }

    if (!enviado) {
      return { ok: false, error: abierta
        ? 'WhatsApp rechazó el mensaje. Quedó registrado el fallo.'
        : `WhatsApp rechazó la plantilla "${CONTACTO_TEMPLATE_NAME}". ¿Está aprobada en Meta?` }
    }

    // Queda en el hilo, para que la próxima persona vea qué se le dijo.
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId, role: 'staff', content: textoGuardado, message_type: 'text',
    })
    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

    await marcarPendiente(conversationId, clinicId, 'contacto_enviado_at')

    revalidatePath('/dashboard/conversations')
    revalidatePath(`/dashboard/conversations/${conversationId}`)
    return { ok: true, canal: abierta ? 'libre' : 'template' }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Pide la ORDEN MÉDICA de una cita concreta. Siempre por template: es
 * post-consulta y casi nunca hay ventana abierta.
 */
export async function solicitarOrdenMedica(
  appointmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')

    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, patient_id, documents_requested, consultation_types(name), patients(name, first_name, phone)')
      .eq('id', appointmentId).eq('clinic_id', clinicId).maybeSingle()
    if (!apt) return { ok: false, error: 'Cita no encontrada' }

    const paciente = (apt.patients as unknown as { name: string; first_name: string | null; phone: string } | null)
    if (!paciente?.phone) return { ok: false, error: 'La paciente no tiene teléfono en la ficha' }

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, context')
      .eq('clinic_id', clinicId).eq('patient_id', apt.patient_id as string)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle()
    if (!conv) return { ok: false, error: 'La paciente no tiene conversación de WhatsApp' }

    const creds = await getClinicCreds(clinicId)
    if (!creds) return { ok: false, error: 'La clínica no tiene WhatsApp configurado' }

    const { data: clinic } = await supabaseAdmin.from('clinics').select('name').eq('id', clinicId).single()
    const nombre = (paciente.first_name || paciente.name).split(' ')[0]
    const servicio = (apt.consultation_types as unknown as { name: string } | null)?.name ?? 'consulta'

    const params = [
      nombre,
      (clinic?.name as string) ?? '',
      formatDateForPatient(apt.starts_at as string),
      formatTimeForPatient(apt.starts_at as string),
      servicio,
    ]
    const r = await sendWhatsAppTemplate(paciente.phone.replace('+', ''), ORDEN_TEMPLATE_NAME,
      TEMPLATE_LANGUAGE, params, null, creds,
      { clinicId, conversationId: conv.id as string, sendType: 'solicitud_orden' })
    if (!r.ok) {
      return { ok: false, error: `WhatsApp rechazó la plantilla "${ORDEN_TEMPLATE_NAME}". ¿Está aprobada en Meta?` }
    }

    await supabaseAdmin.from('messages').insert({
      conversation_id: conv.id as string, role: 'staff', message_type: 'text',
      content: await renderTemplate(ORDEN_TEMPLATE_BODY, params),
    })
    // La cita queda esperando el documento: el webhook usa esto para atar el
    // archivo que llegue, sin adivinar por el texto del último mensaje.
    await supabaseAdmin.from('appointments')
      .update({ documents_requested: true }).eq('id', appointmentId).eq('clinic_id', clinicId)
    await marcarPendiente(conv.id as string, clinicId, 'orden_medica_pedida_at')

    revalidatePath('/dashboard/agenda')
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Marca la conversación como esperando algo: va a Atención y arranca su reloj.
 * NO pisa el timestamp si ya existe — el reloj corre desde la PRIMERA vez.
 */
async function marcarPendiente(
  conversationId: string,
  clinicId: string,
  campo: 'orden_medica_pedida_at' | 'contacto_enviado_at',
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('conversations').select('context, status').eq('id', conversationId).maybeSingle()
  const ctx = ((data?.context ?? {}) as ContextPendientes & Record<string, unknown>)
  if (ctx[campo]) return   // ya estaba esperando: no reinicia el reloj

  const patch: Record<string, unknown> = {
    context: { ...ctx, [campo]: new Date().toISOString() },
  }
  // Una conversación escalada de verdad (crisis, pedido de humano) NO se toca:
  // su triage vive en el status y el agente tiene que seguir callado.
  if (data?.status !== 'escalated') patch.triage_state = 'atencion'

  await supabaseAdmin.from('conversations').update(patch).eq('id', conversationId).eq('clinic_id', clinicId)
}
