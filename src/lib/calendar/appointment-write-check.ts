// ============================================================
// UNA sola respuesta a "¿se puede ESCRIBIR esta cita?".
//
// Hermana de isSlotFree (slot-availability.ts), que responde "¿está libre?".
// Ésta responde la pregunta completa que hay que hacerse antes de un INSERT.
//
// POR QUÉ EXISTE
// --------------
// create_appointment hacía los chequeos. reschedule_appointment hacía dos.
// Nadie lo notó hasta que una paciente pidió mover su cita a un viernes a las
// 13:00 con un médico que los viernes atiende 07:30–11:00: la fila entró en la
// base, y el guard que lo detectó escaló SEIS SEGUNDOS DESPUÉS. Detectar no es
// impedir.
//
// 🔴 Y AL BUSCAR SI FALTABA ALGÚN OTRO CHEQUEO, FALTABA (2026-08-20)
// El escritor resolvía el horario del día con getDoctorDaySchedule —sólo
// working_hours del médico— mientras el LECTOR (check_availability y la agenda
// del dashboard) lo resuelve con resolverDisponibilidadDia, que además mira
// EXCEPCIONES DE FECHA, festivos, whatsapp_config per-doctor y el horario de la
// clínica. Con una excepción cargada ("este jueves atiendo 07:00–11:00") el
// agente ofrecía la hora y el executor la rechazaba: el día abierto para el
// lector y cerrado para el escritor.
//
// Por eso acá NO se re-decide a qué hora atiende un médico: se le pregunta a
// traerDisponibilidadDia, la misma función que usa la pantalla. Un solo lugar
// contesta "¿atiende ese día y a qué horas?" — bloqueos, festivos, excepciones
// y horario base incluidos.
//
// La duración también vive acá: reschedule la calculaba sin el escalón
// per-doctor de whatsapp_config, así que la MISMA cita duraba distinto según si
// la creabas o la movías.
// ============================================================
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { BUSY_STATUSES, isSlotFree, type BusyAppointment } from './slot-availability'
import { isRangeWithinSchedule, isFutureStart } from './schedule-check'
import { SLOT_GRID_MINUTES } from './time-slots'
import { traerDisponibilidadDia } from './fetch-day-availability'
import type { Clinic, WhatsAppConfig } from '@/types/database'

const TIMEZONE = 'America/Bogota'

/** Por qué no se puede escribir. Cada valor tiene su texto y su código. */
export type MotivoNoEscribible =
  | 'slot_taken'
  | 'fuera_de_grilla'
  | 'in_the_past'
  | 'agenda_closed'
  | 'blocked_date'
  | 'out_of_schedule'

export interface CitaEscribible {
  ok: true
  /** Calculado acá para que los dos caminos usen la MISMA duración. */
  endsAt: string
  duracionMinutos: number
}

export interface CitaNoEscribible {
  ok: false
  outcome: MotivoNoEscribible
  /** Familia del error para el loop del modelo. `blocked_date` y
   *  `out_of_schedule` tienen la suya porque NO deben escalar. */
  errorCode: 'SLOT_JUST_TAKEN' | 'BLOCKED_BY_SCHEDULE' | 'BLOCKED_BY_DATE' | 'BLOCKED_OUT_OF_SCHEDULE'
  messageForPatient: string
  instructionForLlm: string
  /** Lo que va a `audit_log.details`. El caller le agrega lo suyo. */
  auditDetails: Record<string, unknown>
}

export type ResultadoEscritura = CitaEscribible | CitaNoEscribible

export interface ArgsEscritura {
  clinic: Clinic
  doctorId: string
  /** ISO 8601, como va a la DB. */
  startsAt: string
  /** Manda sobre todo lo demás para la duración, si el tipo la define. */
  consultationTypeId?: string | null
  now: Date
  /** Al MOVER una cita, su propia fila no cuenta como conflicto consigo misma. */
  excluirAppointmentId?: string | null
}

/**
 * La duración de la cita, con la MISMA precedencia en los dos caminos:
 * tipo de consulta > config per-doctor > default de whatsapp_config > clínica.
 *
 * reschedule se saltaba los dos escalones del medio, así que una cita sin tipo
 * con un médico de duración propia se movía con el largo equivocado.
 */
async function duracionDeLaCita(
  clinic: Clinic,
  doctorId: string,
  consultationTypeId?: string | null,
): Promise<number> {
  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null
  const docConfig = waConfig?.doctors?.[doctorId]
  const base = docConfig?.duration ?? waConfig?.appointment?.default_duration ?? clinic.consultation_duration_minutes

  if (!consultationTypeId) return base
  const { data: ct } = await supabaseAdmin
    .from('consultation_types')
    .select('duration_minutes')
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinic.id)
    .maybeSingle()
  return ct?.duration_minutes ?? base
}

/**
 * ¿Se puede escribir esta cita? Un solo `await` para el caller.
 * Devuelve `{ ok: true, endsAt }` o el motivo con todo lo necesario para
 * responderle al modelo y auditar.
 */
export async function puedeEscribirseLaCita(args: ArgsEscritura): Promise<ResultadoEscritura> {
  const { clinic, doctorId, startsAt, consultationTypeId, now, excluirAppointmentId } = args
  const clinicId = clinic.id

  const duracionMinutos = await duracionDeLaCita(clinic, doctorId, consultationTypeId)
  const endsAt = new Date(Date.parse(startsAt) + duracionMinutos * 60_000).toISOString()

  const startZoned = toZonedTime(parseISO(startsAt), TIMEZONE)
  const endZoned = toZonedTime(parseISO(endsAt), TIMEZONE)
  const dateStr = format(startZoned, 'yyyy-MM-dd')
  const startHHMM = format(startZoned, 'HH:mm')
  const endHHMM = format(endZoned, 'HH:mm')

  // (0) ¿La hora EXISTE como cupo? Los cupos caen siempre en :00/:15/:30/:45
  //     (time-slots.ts). Una hora fuera de la grilla no la ofreció nunca
  //     check_availability, así que el modelo la inventó.
  //
  //     Va ANTES del chequeo de ocupación a propósito: 08:07 no está "ocupada",
  //     no existe. Decirle a la paciente que ese horario ya se tomó sería
  //     mentirle sobre un horario que nadie tuvo nunca.
  //
  //     Ojo: 08:15 SÍ es un cupo válido — la grilla es de 15 minutos, no de 30.
  const minutosDelDia = startZoned.getHours() * 60 + startZoned.getMinutes()
  if (minutosDelDia % SLOT_GRID_MINUTES !== 0) {
    return {
      ok: false,
      outcome: 'fuera_de_grilla',
      errorCode: 'BLOCKED_OUT_OF_SCHEDULE',
      messageForPatient: 'Ese horario no está disponible. ¿Buscamos otro?',
      instructionForLlm:
        `Esa hora (${startHHMM}) no existe como cupo: la agenda va de ${SLOT_GRID_MINUTES} en ${SLOT_GRID_MINUTES} minutos. ` +
        'NO la inventes. Ofrecele a la paciente los cupos de cupos_disponibles, que son reales.',
      auditDetails: {
        outcome: 'fuera_de_grilla', starts_at: startsAt, start_hhmm: startHHMM,
        grilla_minutos: SLOT_GRID_MINUTES, llm_attempted_anyway: true,
      },
    }
  }

  // (1) ¿Está libre? Misma lógica de solapamiento que check_availability.
  let queryDia = supabaseAdmin
    .from('appointments')
    .select('starts_at, ends_at, status')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', [...BUSY_STATUSES])
    .gte('starts_at', `${dateStr}T00:00:00-05:00`)
    .lte('starts_at', `${dateStr}T23:59:59-05:00`)
  if (excluirAppointmentId) queryDia = queryDia.neq('id', excluirAppointmentId)
  const { data: dayAppts } = await queryDia

  if (!isSlotFree(startsAt, endsAt, (dayAppts ?? []) as BusyAppointment[])) {
    return {
      ok: false,
      outcome: 'slot_taken',
      errorCode: 'SLOT_JUST_TAKEN',
      // 🔴 ACÁ DECÍA "se acaba de ocupar", Y ERA MENTIRA (2026-08-20).
      //
      // Los cuatro choques medidos del 15 al 19/08 fueron contra citas de
      // iSalud creadas el 10/07 — llevaban MÁS DE UN MES ocupando el cupo.
      // No se ocupó mientras hablaban: nunca estuvo libre. El texto le
      // explicaba a la paciente una carrera que no existió.
      //
      // Y el que bloquea trae la salida: el caller adjunta los cupos reales.
      messageForPatient: 'Esa hora ya está ocupada 🙏',
      instructionForLlm:
        'Ese horario ya está ocupado. NO digas que "se acaba de ocupar" ni que fue mientras hablaban: ' +
        'puede llevar semanas tomado. NO escales y NO llames check_availability — los cupos ya vienen ' +
        'en cupos_disponibles. Ofrecele esa lista.',
      auditDetails: { outcome: 'slot_taken', starts_at: startsAt, ends_at: endsAt },
    }
  }

  // (2) Futura.
  if (!isFutureStart(startsAt, now)) {
    return {
      ok: false,
      outcome: 'in_the_past',
      errorCode: 'BLOCKED_BY_SCHEDULE',
      messageForPatient: 'Esa fecha ya pasó. ¿Buscamos un horario disponible próximamente?',
      instructionForLlm:
        'La fecha/hora pedida ya pasó. NO escribas la cita. Usá check_availability para ofrecer horarios futuros.',
      auditDetails: { outcome: 'in_the_past', starts_at: startsAt, llm_attempted_anyway: true },
    }
  }

  // (3) ¿Atiende ese día, y a qué horas? NO se decide acá.
  //
  // Se le pregunta a la MISMA función que usan check_availability y la agenda
  // del dashboard. Trae resueltos, en este orden: clínica no operativa →
  // festivo → fecha bloqueada → agenda cerrada → horario manual → EXCEPCIÓN DE
  // FECHA → horario base (médico > whatsapp_config > clínica).
  const disp = await traerDisponibilidadDia(clinicId, doctorId, dateStr, clinic)

  if (disp.bloqueo) {
    // Los que el agente resuelve solo (ofrece otra fecha) vs. los que ameritan
    // que una persona mire. El motivo ya viene redactado por el resolver.
    const esDeNegocio = disp.bloqueo.tipo === 'festivo'
      || disp.bloqueo.tipo === 'fecha_bloqueada_medico'
      || disp.bloqueo.tipo === 'fecha_bloqueada_clinica'
    return {
      ok: false,
      outcome: esDeNegocio ? 'blocked_date' : 'agenda_closed',
      errorCode: esDeNegocio ? 'BLOCKED_BY_DATE' : 'BLOCKED_BY_SCHEDULE',
      messageForPatient: esDeNegocio
        ? 'Ese día no hay atención. ¿Buscamos otra fecha?'
        : 'La agenda de ese médico está cerrada en este momento. ¿Buscamos con otro médico?',
      instructionForLlm: esDeNegocio
        ? 'Ese día está bloqueado (no hay atención). NO agendes ahí y NO escales: decile a la paciente ' +
          'que ese día no hay atención y ofrecele otra fecha.'
        : 'La agenda del médico está cerrada. NO agendes con él. Ofrecé otro médico de la misma ' +
          'especialidad o avisá que no hay agenda.',
      auditDetails: {
        outcome: esDeNegocio ? 'blocked_date' : 'agenda_closed',
        tipo_bloqueo: disp.bloqueo.tipo, motivo: disp.bloqueo.motivo,
        starts_at: startsAt, date: dateStr, llm_attempted_anyway: true,
      },
    }
  }

  // (4) Entra COMPLETA en una franja de ESE día — las que devolvió el resolver,
  //     que ya contemplan la excepción de fecha si la hay.
  if (!isRangeWithinSchedule(startHHMM, endHHMM, { active: disp.atiende, blocks: disp.franjas })) {
    return {
      ok: false,
      outcome: 'out_of_schedule',
      // Código PROPIO, separado de BLOCKED_BY_SCHEDULE — igual que BLOCKED_BY_DATE.
      //
      // BLOCKED_BY_SCHEDULE es "falla dura" (booking-failure.ts): corta el turno,
      // escala a una persona y la paciente oye "Uy, tuve un inconveniente para
      // agendar tu cita". Para fecha pasada o agenda cerrada eso está bien.
      //
      // Para un horario fuera de la franja NO: el agente lo resuelve ofreciendo
      // los cupos reales de ese médico. El intento igual queda en audit_log con
      // llm_attempted_anyway: true, que es por donde se detecta si el modelo
      // empieza a pedir horas imposibles.
      errorCode: 'BLOCKED_OUT_OF_SCHEDULE',
      messageForPatient: 'Ese horario no está dentro de la agenda del médico. ¿Buscamos otro?',
      instructionForLlm:
        'El horario cae fuera de la franja del médico o la cita no entra completa. NO escribas la cita y NO ' +
        'escales. Ofrecele a la paciente los cupos que vienen en cupos_disponibles, que son de ESE médico.',
      auditDetails: {
        outcome: 'out_of_schedule', starts_at: startsAt, ends_at: endsAt,
        start_hhmm: startHHMM, end_hhmm: endHHMM, date: dateStr,
        day_active: disp.atiende, blocks: disp.franjas,
        por_excepcion: !!disp.excepcion, llm_attempted_anyway: true,
      },
    }
  }

  return { ok: true, endsAt, duracionMinutos }
}
