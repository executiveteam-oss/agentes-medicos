// ============================================================
// Avisarle a la paciente que su cita se MOVIÓ.
//
// Un solo camino, como `cancel-notify`. `notificar` decide si la paciente se
// entera; todo lo demás pasa igual.
//
// POR QUÉ EXISTE
// Hasta hoy una cita sólo se podía mover desde el agente. Cuando se conectó la
// edición desde el panel apareció el agujero: mover una cita en silencio es
// peor que cancelarla con aviso — la paciente llega el día que ya no es.
//
// POR QUÉ VA POR TEMPLATE Y NO POR TEXTO LIBRE
// Es proactivo: casi siempre cae FUERA de la ventana de 24h de Meta, donde el
// texto libre se rechaza. No hay template de reagendamiento aprobado, así que
// se usa `contacto_general` — que existe justo para esto. Todo el aviso viaja
// en {{3}}, EN UNA SOLA LÍNEA: Meta rechaza saltos de línea en parámetros.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppTemplate, sendWhatsAppMessageWithResult, getClinicCreds } from '@/lib/whatsapp/client'
import { ventanaAbierta } from '@/lib/whatsapp/ventana-24h'
import { insertPendingContact } from '@/app/actions/pending-contacts'
import { CONTACTO_TEMPLATE_NAME, TEMPLATE_LANGUAGE } from '@/lib/whatsapp/appointment-templates'
import { formatTimeForPatient } from '@/lib/utils/dates'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export interface MoveNotifyResult {
  whatsappSent: boolean
  warning?: string
}

/**
 * @param debeReconfirmar la paciente YA había confirmado la cita vieja y se le
 *   reseteó la confirmación. Si no se lo decimos, se queda pensando que está
 *   todo listo — confirmó una hora que ya no existe.
 */
export async function notifyAppointmentMoved(
  appointmentId: string,
  clinicId: string,
  opts: { motivoParaPaciente?: string | null; debeReconfirmar: boolean },
): Promise<MoveNotifyResult> {
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, ends_at, modality, calendar_sequence, patient_id, patients(name, phone), doctors(name), consultation_types(name)')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()
  if (!apt) return { whatsappSent: false, warning: 'Cita no encontrada' }

  const patient = (Array.isArray(apt.patients) ? apt.patients[0] : apt.patients) as { name: string; phone: string } | null
  const doctor = (Array.isArray(apt.doctors) ? apt.doctors[0] : apt.doctors) as { name: string } | null
  const ctName = (apt.consultation_types as unknown as { name: string } | null)?.name ?? null

  if (!patient?.phone) {
    return { whatsappSent: false, warning: 'Cita actualizada. La paciente no tiene WhatsApp — hay que avisarle a mano.' }
  }
  const creds = await getClinicCreds(clinicId)
  if (!creds) {
    return { whatsappSent: false, warning: 'Cita actualizada. WhatsApp no configurado — hay que avisarle a mano.' }
  }

  const { data: clinic } = await supabaseAdmin
    .from('clinics').select('name, address, city').eq('id', clinicId).single()

  const fecha = format(parseISO(apt.starts_at as string), "EEEE d 'de' MMMM", { locale: es })
  const hora = formatTimeForPatient(apt.starts_at as string)
  const medico = doctor?.name ?? 'tu médico'

  // El .ics viaja como LINK dentro del MISMO mensaje. Ya se hostea así (no como
  // adjunto: Meta no acepta text/calendar), así que no hace falta un segundo
  // envío para que la paciente pueda actualizar su calendario.
  //
  // Acá el UID no cambia —editar es un UPDATE sobre la misma fila— y por eso el
  // SEQUENCE más alto SÍ mueve el evento que ella ya tiene, en vez de crearle
  // otro al lado.
  let linkIcs: string | null = null
  try {
    const { generateConfirmICS } = await import('@/lib/calendar/generate-ics')
    const { hostICSAndGetLink } = await import('@/lib/calendar/host-ics')
    const ics = generateConfirmICS({
      appointmentId: apt.id as string,
      startsAt: apt.starts_at as string,
      endsAt: apt.ends_at as string,
      doctorName: medico,
      consultationType: ctName ?? 'Consulta',
      clinicName: clinic?.name ?? '',
      clinicAddress: clinic?.address ?? null,
      clinicCity: clinic?.city ?? null,
      sequence: (apt.calendar_sequence as number) ?? 0,
      isVirtual: apt.modality === 'virtual',
    })
    linkIcs = await hostICSAndGetLink({ appointmentId: apt.id as string, icsContent: ics })
  } catch (err) {
    // Sin calendario se avisa igual: saber la hora nueva importa más que el .ics.
    console.error('[notifyAppointmentMoved] .ics falló:', err instanceof Error ? err.message : err)
  }

  const motivo = opts.motivoParaPaciente?.trim()
  const partes = [
    `Tu cita con ${medico} quedó reprogramada para el ${fecha} a las ${hora}.`,
    motivo ? `Motivo: ${motivo}.` : null,
    // Ella ya había confirmado la cita vieja y esa confirmación se borró. Si no
    // se lo decimos, se queda pensando que está todo listo.
    opts.debeReconfirmar ? 'Como cambió la fecha, necesitamos que la vuelvas a confirmar.' : null,
    linkIcs ? `Aquí puedes actualizarla en el calendario de tu celular: ${linkIcs}` : null,
  ].filter(Boolean) as string[]

  // Dentro de la ventana de 24h se puede mandar texto libre, que respeta los
  // saltos de línea y se lee mucho mejor. Fuera, va por plantilla y TODO el
  // aviso viaja en {{3}} en UNA sola línea: Meta rechaza newlines en params.
  // En los dos casos es UN SOLO mensaje — el link del .ics va adentro.
  const { data: conv } = await supabaseAdmin
    .from('conversations').select('id')
    .eq('clinic_id', clinicId).eq('patient_id', apt.patient_id as string)
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  const convId = (conv as { id: string } | null)?.id ?? null
  const abierta = convId ? await ventanaAbierta(convId) : false

  try {
    if (abierta && convId) {
      const r = await sendWhatsAppMessageWithResult(
        patient.phone.replace('+', ''),
        `Hola ${patient.name.split(' ')[0]} 👋\n\n${partes.join('\n\n')}`,
        creds,
        { clinicId, conversationId: convId, sendType: 'appointment_moved' },
      )
      if (!r.ok) {
        await registrarAvisoNoEntregado(clinicId, appointmentId, patient.name, 'Meta rechazó el texto libre', {
          patientId: apt.patient_id as string, patientPhone: patient.phone,
          doctorName: medico, startsAt: apt.starts_at as string, consultationType: ctName,
        })
        return { whatsappSent: false, warning: 'Cita actualizada, pero el aviso no se entregó. Hay que contactarla a mano.' }
      }
      return { whatsappSent: true }
    }

    const r = await sendWhatsAppTemplate(
      patient.phone.replace('+', ''),
      CONTACTO_TEMPLATE_NAME,
      TEMPLATE_LANGUAGE,
      [patient.name, clinic?.name ?? 'tu consultorio', partes.join(' ')],
      null,
      creds,
    )
    if (!r.ok) {
      await registrarAvisoNoEntregado(clinicId, appointmentId, patient.name, 'Meta rechazó el envío', {
          patientId: apt.patient_id as string, patientPhone: patient.phone,
          doctorName: medico, startsAt: apt.starts_at as string, consultationType: ctName,
        })
      return { whatsappSent: false, warning: 'Cita actualizada, pero el aviso no se entregó. Hay que contactarla a mano.' }
    }
  } catch (err) {
    console.error('[notifyAppointmentMoved] envío falló:', err instanceof Error ? err.message : err)
    await registrarAvisoNoEntregado(clinicId, appointmentId, patient.name, 'error de red', {
          patientId: apt.patient_id as string, patientPhone: patient.phone,
          doctorName: medico, startsAt: apt.starts_at as string, consultationType: ctName,
        })
    return { whatsappSent: false, warning: 'Cita actualizada, pero el aviso no se entregó. Hay que contactarla a mano.' }
  }

  return { whatsappSent: true }
}

/**
 * Un aviso de cita movida que NO llegó es exactamente el caso que hay que poder
 * encontrar después, así que queda en audit_log.
 *
 * Lo natural sería una fila en `pending_contacts` —la pantalla que existe para
 * "hay que contactar a esta paciente"—, pero su CHECK sólo admite
 * reminder_failed / cancellation_no_delivery / waitlist_notification_failed.
 * Agregar un valor es una migración sobre la base del cliente y no se hace de
 * paso: por ahora el rastro es este, y el warning que ve la secretaria.
 */
async function registrarAvisoNoEntregado(
  clinicId: string, appointmentId: string, patientName: string, causa: string,
  datos?: { patientId?: string; patientPhone?: string; doctorName?: string; startsAt?: string; consultationType?: string | null },
): Promise<void> {
  // La fila de Pendientes es la que ve la secretaria. El audit_log queda igual
  // porque responde otra pregunta: "¿cuántos avisos no llegaron este mes?".
  try {
    await insertPendingContact({
      clinic_id: clinicId,
      patient_id: datos?.patientId,
      appointment_id: appointmentId,
      reason_type: 'reschedule_no_delivery',
      reason_text: `No se le pudo avisar que su cita cambió de fecha (${causa}). Sigue creyendo que es el día viejo.`,
      patient_name: patientName,
      patient_phone: datos?.patientPhone ?? '',
      doctor_name: datos?.doctorName ?? '',
      appointment_date: datos?.startsAt ?? null,
      consultation_type: datos?.consultationType ?? null,
    })
  } catch { /* no bloquear la edición por el registro */ }
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'appointment_move_notify_failed',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: { patientName, causa, nota: 'La paciente NO sabe que su cita cambió' },
    })
  } catch { /* no bloquear la edición por el registro */ }
}
