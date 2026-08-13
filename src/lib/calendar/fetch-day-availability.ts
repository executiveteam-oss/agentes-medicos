// ============================================================
// Trae de la base lo que `resolverDisponibilidadDia` necesita para decidir.
//
// La separación es a propósito: acá viven las queries, allá la decisión. Así la
// lógica —que es la parte con matices y la que ya tuvo bugs— se testea sin base
// de datos, y este archivo queda tan chico que se audita de un vistazo.
//
// Lo llaman los dos lados: el executor del agente y la agenda del dashboard.
// Nadie más debería consultar working_hours + blocked_dates + agenda_closed por
// su cuenta para responder esta misma pregunta.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Clinic, WhatsAppConfig } from '@/types/database'

/** Lo mínimo que hace falta de la clínica. `operational_status` es lo que
 *  distingue "a qué hora abre" de "hoy está abierta". */
export type ClinicParaDisponibilidad = Pick<Clinic, 'working_hours' | 'whatsapp_config'> & {
  operational_status?: string | null
  operational_status_message?: string | null
}
import {
  resolverDisponibilidadDia, nombreDiaSemana,
  type DisponibilidadDelDia, type DatosDelDia,
} from '@/lib/calendar/day-availability'

/**
 * Festivos que APLICAN a esta clínica en un rango de fechas.
 *
 * "Aplican" = está en el calendario nacional Y la clínica no lo destapó. Por
 * defecto festivo = cerrado; una fila en clinic_holiday_overrides con
 * works=true significa que esa clínica sí atiende ese día.
 *
 * Devuelve un mapa fecha → nombre para que el llamador no tenga que buscar.
 */
export async function traerFestivos(
  clinicId: string,
  desde: string,
  hasta: string,
  countryCode = 'CO',
): Promise<Map<string, string>> {
  const [{ data: festivos }, { data: overrides }] = await Promise.all([
    supabaseAdmin
      .from('national_holidays')
      .select('holiday_date, name')
      .eq('country_code', countryCode)
      .gte('holiday_date', desde).lte('holiday_date', hasta),
    supabaseAdmin
      .from('clinic_holiday_overrides')
      .select('holiday_date, works')
      .eq('clinic_id', clinicId)
      .gte('holiday_date', desde).lte('holiday_date', hasta),
  ])

  const atiende = new Set(
    (overrides ?? []).filter((o) => o.works === true).map((o) => o.holiday_date as string),
  )
  const m = new Map<string, string>()
  for (const f of festivos ?? []) {
    const fecha = f.holiday_date as string
    if (atiende.has(fecha)) continue   // la clínica destapó ese festivo
    m.set(fecha, f.name as string)
  }
  return m
}

/** Día de la semana de una fecha 'YYYY-MM-DD' en COT, sin correrse por TZ.
 *  Se ancla al MEDIODÍA: parseISO de una fecha sin hora da medianoche UTC, y en
 *  Vercel (TZ=UTC) eso devolvía el día ANTERIOR en Bogotá — el bug que hacía que
 *  "lunes" leyera la config del domingo y el médico apareciera sin atender. */
export function indiceDiaSemanaCOT(fecha: string): number {
  return new Date(`${fecha}T12:00:00-05:00`).getUTCDay()
}

/**
 * Disponibilidad de UN médico en UNA fecha.
 * `clinic` se pasa entero porque ya lo tienen los dos llamadores — evita una
 * query redundante en el camino del agente, que corre por cada mensaje.
 */
export async function traerDisponibilidadDia(
  clinicId: string,
  doctorId: string,
  fecha: string,
  clinic: ClinicParaDisponibilidad,
): Promise<DisponibilidadDelDia> {
  const [{ data: medico }, { data: bloqueos }, festivos] = await Promise.all([
    supabaseAdmin
      .from('doctors')
      .select('name, working_hours, agenda_closed, agenda_closed_reason, agenda_closed_until, schedule_type, manual_availability_message')
      .eq('id', doctorId).eq('clinic_id', clinicId).maybeSingle(),
    supabaseAdmin
      .from('blocked_dates')
      .select('doctor_id, reason')
      .eq('clinic_id', clinicId)
      .lte('start_date', fecha).gte('end_date', fecha)
      .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
      .limit(1),
    traerFestivos(clinicId, fecha, fecha),
  ])

  const nombreFestivo = festivos.get(fecha)
  return resolverDisponibilidadDia(armarDatos(
    clinicId, doctorId, fecha, clinic, medico, bloqueos?.[0] ?? null,
    nombreFestivo ? { nombre: nombreFestivo } : null,
  ))
}

/**
 * Varios días de un mismo médico, en DOS queries totales.
 *
 * La grilla de la semana necesita 7 días: hacerlo con `traerDisponibilidadDia`
 * en un loop serían 14 consultas por cada vez que la secretaria cambia de
 * semana o de médico. El médico se trae una vez y los bloqueos del rango
 * también.
 */
export async function traerDisponibilidadRango(
  clinicId: string,
  doctorId: string,
  fechas: string[],
  clinic: ClinicParaDisponibilidad,
): Promise<Record<string, DisponibilidadDelDia>> {
  if (fechas.length === 0) return {}
  const desde = fechas.reduce((a, b) => (a < b ? a : b))
  const hasta = fechas.reduce((a, b) => (a > b ? a : b))

  const [{ data: medico }, { data: bloqueos }, festivos] = await Promise.all([
    supabaseAdmin
      .from('doctors')
      .select('name, working_hours, agenda_closed, agenda_closed_reason, agenda_closed_until, schedule_type, manual_availability_message')
      .eq('id', doctorId).eq('clinic_id', clinicId).maybeSingle(),
    supabaseAdmin
      .from('blocked_dates')
      .select('doctor_id, reason, start_date, end_date')
      .eq('clinic_id', clinicId)
      .lte('start_date', hasta).gte('end_date', desde)
      .or(`doctor_id.eq.${doctorId},doctor_id.is.null`),
    traerFestivos(clinicId, desde, hasta),
  ])

  const out: Record<string, DisponibilidadDelDia> = {}
  for (const fecha of fechas) {
    // El bloqueo del médico gana sobre el de la clínica: es más específico y su
    // mensaje nombra al médico, que es lo que la secretaria necesita leer.
    const delDia = (bloqueos ?? [])
      .filter((b) => (b.start_date as string) <= fecha && (b.end_date as string) >= fecha)
      .sort((a, b) => (a.doctor_id ? 0 : 1) - (b.doctor_id ? 0 : 1))[0] ?? null
    const nombreFestivo = festivos.get(fecha)
    out[fecha] = resolverDisponibilidadDia(armarDatos(
      clinicId, doctorId, fecha, clinic, medico, delDia,
      nombreFestivo ? { nombre: nombreFestivo } : null,
    ))
  }
  return out
}

// ---- armado del input puro ----

type FilaMedico = {
  name: string; working_hours: unknown | null
  agenda_closed: boolean | null; agenda_closed_reason: string | null; agenda_closed_until: string | null
  schedule_type: string | null; manual_availability_message: string | null
} | null

function armarDatos(
  _clinicId: string,
  doctorId: string,
  fecha: string,
  clinic: ClinicParaDisponibilidad,
  medico: FilaMedico,
  fechaBloqueada: { doctor_id: string | null; reason: string | null } | null,
  festivo: { nombre: string } | null,
): DatosDelDia {
  const wa = clinic.whatsapp_config as WhatsAppConfig | null
  const cfg = wa?.doctors?.[doctorId]
  const indice = indiceDiaSemanaCOT(fecha)
  return {
    fecha,
    diaSemana: nombreDiaSemana(indice),
    indiceDiaSemana: indice,
    medico: medico
      ? {
          nombre: medico.name,
          working_hours: medico.working_hours,
          agenda_closed: medico.agenda_closed ?? false,
          agenda_closed_reason: medico.agenda_closed_reason,
          agenda_closed_until: medico.agenda_closed_until,
          schedule_type: medico.schedule_type,
          manual_availability_message: medico.manual_availability_message,
        }
      : null,
    fechaBloqueada: fechaBloqueada ? { doctor_id: fechaBloqueada.doctor_id, reason: fechaBloqueada.reason } : null,
    configWhatsApp: cfg ? { days: cfg.days, start: cfg.start, end: cfg.end } : null,
    horarioClinica: clinic.working_hours,
    festivo,
    estadoClinica: (clinic.operational_status && clinic.operational_status !== 'operando')
      ? {
          estado: clinic.operational_status as 'contingencia' | 'cerrado',
          mensaje: clinic.operational_status_message ?? null,
        }
      : null,
  }
}
