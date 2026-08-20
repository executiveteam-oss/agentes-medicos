// ============================================================
// UNA sola respuesta a "¿se puede ESCRIBIR esta cita?".
//
// Hermana de isSlotFree (slot-availability.ts), que responde "¿está libre?".
// Ésta responde la pregunta completa que hay que hacerse antes de un INSERT:
// libre + futura + agenda abierta + día no bloqueado + dentro de la franja
// del médico.
//
// POR QUÉ EXISTE
// --------------
// create_appointment hacía los cinco chequeos. reschedule_appointment hacía
// dos. Nadie lo notó hasta que una paciente pidió mover su cita a un viernes
// a las 13:00 con un médico que los viernes atiende 07:30–11:00: la fila entró
// en la base, y el guard que lo detectó escaló SEIS SEGUNDOS DESPUÉS. Detectar
// no es impedir.
//
// La divergencia no fue un descuido puntual: es lo que pasa siempre que la
// misma pregunta se responde en dos lugares. Por eso esto no se copia al
// segundo camino — se extrae, y los dos la importan. La regla que alguien
// agregue el mes que viene vale para agendar Y para mover sin que nadie tenga
// que acordarse.
//
// El orden de los chequeos replica el de create_appointment (slot primero) a
// propósito: era el camino en producción y no se le cambia el comportamiento
// de arrastre.
// ============================================================
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { BUSY_STATUSES, isSlotFree, type BusyAppointment } from './slot-availability'
import { getDoctorDaySchedule, dayKeyFromIndex, isRangeWithinSchedule, isFutureStart } from './schedule-check'

const TIMEZONE = 'America/Bogota'

/** Por qué no se puede escribir. Cada valor tiene su texto y su código. */
export type MotivoNoEscribible =
  | 'slot_taken'
  | 'in_the_past'
  | 'agenda_closed'
  | 'blocked_date'
  | 'out_of_schedule'

export interface CitaEscribible {
  ok: true
}

export interface CitaNoEscribible {
  ok: false
  outcome: MotivoNoEscribible
  /** Familia del error para el loop del modelo. `blocked_date` tiene la suya
   *  porque NO debe escalar: que la clínica cierre un día es negocio corriente. */
  errorCode: 'SLOT_JUST_TAKEN' | 'BLOCKED_BY_SCHEDULE' | 'BLOCKED_BY_DATE' | 'BLOCKED_OUT_OF_SCHEDULE'
  messageForPatient: string
  instructionForLlm: string
  /** Lo que va a `audit_log.details`. El caller le agrega lo suyo. */
  auditDetails: Record<string, unknown>
}

export type ResultadoEscritura = CitaEscribible | CitaNoEscribible

export interface ArgsEscritura {
  clinicId: string
  doctorId: string
  /** ISO 8601, como va a la DB. */
  startsAt: string
  endsAt: string
  now: Date
  /** Al MOVER una cita, su propia fila no cuenta como conflicto consigo misma. */
  excluirAppointmentId?: string | null
}

/**
 * ¿Se puede escribir esta cita? Un solo `await` para el caller, cinco chequeos
 * adentro. Devuelve `{ ok: true }` o el motivo con todo lo necesario para
 * responderle al modelo y auditar.
 */
export async function puedeEscribirseLaCita(args: ArgsEscritura): Promise<ResultadoEscritura> {
  const { clinicId, doctorId, startsAt, endsAt, now, excluirAppointmentId } = args

  const startZoned = toZonedTime(parseISO(startsAt), TIMEZONE)
  const endZoned = toZonedTime(parseISO(endsAt), TIMEZONE)
  const dateStr = format(startZoned, 'yyyy-MM-dd')
  const startHHMM = format(startZoned, 'HH:mm')
  const endHHMM = format(endZoned, 'HH:mm')
  const dayKey = dayKeyFromIndex(startZoned.getDay())

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
      messageForPatient: 'Ese horario se acaba de ocupar. ¿Buscamos otro?',
      instructionForLlm:
        'Ese horario se ocupó mientras hablaban. DEBES: (1) disculparte ("Disculpa, ese horario ' +
        'se acaba de ocupar mientras hablábamos") (2) usar check_availability (3) ofrecer 2-3 ' +
        'opciones nuevas. NUNCA actúes como si nunca hubieras propuesto el horario original.',
      auditDetails: { outcome: 'slot_taken', starts_at: startsAt, ends_at: endsAt },
    }
  }

  // El resto necesita al médico.
  const { data: medico } = await supabaseAdmin
    .from('doctors')
    .select('name, working_hours, agenda_closed')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .single()
  const nombreMedico = medico?.name ?? ''

  // (2) Futura.
  if (!isFutureStart(startsAt, now)) {
    return {
      ok: false,
      outcome: 'in_the_past',
      errorCode: 'BLOCKED_BY_SCHEDULE',
      messageForPatient: 'Esa fecha ya pasó. ¿Buscamos un horario disponible próximamente?',
      instructionForLlm:
        'La fecha/hora pedida ya pasó. NO escribas la cita. Usá check_availability para ofrecer horarios futuros.',
      auditDetails: { outcome: 'in_the_past', doctor_name: nombreMedico, starts_at: startsAt, llm_attempted_anyway: true },
    }
  }

  // (3) Agenda del médico cerrada.
  if (medico?.agenda_closed) {
    return {
      ok: false,
      outcome: 'agenda_closed',
      errorCode: 'BLOCKED_BY_SCHEDULE',
      messageForPatient: 'La agenda de ese médico está cerrada en este momento. ¿Buscamos con otro médico?',
      instructionForLlm:
        'La agenda del médico está cerrada. NO agendes con él. Ofrecé otro médico de la misma especialidad o avisá que no hay agenda.',
      auditDetails: { outcome: 'agenda_closed', doctor_name: nombreMedico, starts_at: startsAt, llm_attempted_anyway: true },
    }
  }

  // (4) Fecha bloqueada (del médico o de toda la clínica).
  const { data: blockedRows } = await supabaseAdmin
    .from('blocked_dates')
    .select('id, doctor_id, reason')
    .eq('clinic_id', clinicId)
    .lte('start_date', dateStr)
    .gte('end_date', dateStr)
    .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
    .limit(1)

  if (blockedRows && blockedRows.length > 0) {
    return {
      ok: false,
      outcome: 'blocked_date',
      // Código PROPIO a propósito: los otros motivos son señal de que el modelo
      // intentó algo que no debía y escalan. Éste no — que la clínica cierre un
      // día es información de negocio y el agente la resuelve solo.
      errorCode: 'BLOCKED_BY_DATE',
      messageForPatient: 'Ese día no hay atención. ¿Buscamos otra fecha?',
      instructionForLlm:
        'Ese día está bloqueado (no hay atención). NO agendes ahí. Decile a la paciente que ese día no hay ' +
        'atención y usá check_availability para ofrecerle otra fecha. NO escales: esto lo resolvés vos.',
      auditDetails: {
        outcome: 'blocked_date', doctor_name: nombreMedico, starts_at: startsAt, date: dateStr,
        blocked_by: blockedRows[0].doctor_id ? 'doctor' : 'clinic',
        reason: blockedRows[0].reason ?? null, llm_attempted_anyway: true,
      },
    }
  }

  // (5) Entra COMPLETA en una franja del médico ese día.
  const daySched = getDoctorDaySchedule(medico?.working_hours ?? null, dayKey)
  if (!isRangeWithinSchedule(startHHMM, endHHMM, daySched)) {
    return {
      ok: false,
      outcome: 'out_of_schedule',
      // Código PROPIO, separado de BLOCKED_BY_SCHEDULE — igual que BLOCKED_BY_DATE.
      //
      // BLOCKED_BY_SCHEDULE es "falla dura" (booking-failure.ts): corta el turno,
      // escala a una persona y la paciente oye "Uy, tuve un inconveniente para
      // agendar tu cita". Para fecha pasada o agenda cerrada eso está bien.
      //
      // Para un horario fuera de la franja NO: el agente puede resolverlo solo
      // llamando check_availability con ESE médico y ofreciendo horas válidas.
      // Escalarlo le deja a la paciente un "hubo un problema" en vez de un
      // horario, y le manda a una secretaria algo que el agente arregla.
      // El intento igual queda en audit_log con llm_attempted_anyway: true, que
      // es por donde se detecta si el modelo empieza a pedir horas imposibles.
      errorCode: 'BLOCKED_OUT_OF_SCHEDULE',
      messageForPatient: 'Ese horario no está dentro de la agenda del médico. ¿Buscamos otro?',
      instructionForLlm:
        'El horario cae fuera de la franja del médico o la cita no entra completa. NO escribas la cita y NO ' +
        'escales. Llamá check_availability con ESE MISMO médico (el de la cita, no otro) y ofrecele a la ' +
        'paciente 2-3 horarios válidos. Si querés, decile en qué franja atiende ese día.',
      auditDetails: {
        outcome: 'out_of_schedule', doctor_name: nombreMedico, starts_at: startsAt, ends_at: endsAt,
        day: dayKey, start_hhmm: startHHMM, end_hhmm: endHHMM,
        day_active: daySched.active, blocks: daySched.blocks, llm_attempted_anyway: true,
      },
    }
  }

  return { ok: true }
}
