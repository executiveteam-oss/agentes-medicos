// ============================================================
// Los próximos cupos libres de un médico, listos para ofrecer.
//
// 🔴 POR QUÉ EXISTE (2026-08-20)
// Cuando una paciente tocaba "Reagendar" en el recordatorio, el sistema le
// contestaba "¿Qué día y hora te quedaría mejor?" — una pregunta abierta. De
// las 21 conversaciones que pidieron cita y se fueron sin ella esa semana,
// CINCO murieron exactamente ahí: la paciente tocó un botón, un gesto de un
// segundo, y se encontró con algo que exige pensar, elegir y escribir.
//
// Después de un botón van OPCIONES CONCRETAS, no preguntas. El sistema ya sabe
// qué cita es, con qué médico y a qué hora: pedirle a ella que lo reconstruya
// es trasladarle trabajo que ya está hecho.
//
// Usa la MISMA fuente que el agente (check_availability del executor): no hay
// dos respuestas distintas a "¿qué cupos hay libres?".
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { executeTool } from '@/agents/tools/executor'
import { proximasFechasQueAtiende } from '@/lib/calendar/schedule-check'
import { formatInTimeZone } from 'date-fns-tz'

export interface CupoLibre {
  /** ISO del inicio, para agendar sin reinterpretar nada. */
  startsAt: string
  /** "jueves 21 de agosto a las 10:30 AM" — listo para el mensaje. */
  texto: string
}

/**
 * Busca hasta `cuantos` cupos libres del médico, a partir de mañana.
 *
 * Sólo consulta los días que el médico ATIENDE (proximasFechasQueAtiende), no
 * los siguientes N del calendario: preguntar por un domingo es una consulta
 * tirada a la basura, y así alcanzan 3 lecturas en vez de 14.
 */
export async function proximosCuposLibres(
  clinicId: string,
  doctorId: string,
  cuantos = 3,
): Promise<CupoLibre[]> {
  const [{ data: clinic }, { data: medico }] = await Promise.all([
    supabaseAdmin.from('clinics').select('*').eq('id', clinicId).single(),
    supabaseAdmin.from('doctors').select('*').eq('id', doctorId).eq('clinic_id', clinicId).maybeSingle(),
  ])
  if (!clinic || !medico) return []

  const hoy = formatInTimeZone(new Date(), 'America/Bogota', 'yyyy-MM-dd')
  const fechas = proximasFechasQueAtiende(medico.working_hours ?? null, hoy, 4)

  // UN cupo por DÍA, no tres seguidos del mismo.
  //
  // Tomar los primeros tres slots daba "1:00, 1:15 y 1:30 del viernes": si a la
  // paciente no le sirve esa tarde, no le sirve ninguna de las tres y volvemos
  // al punto de partida. Tres días distintos son tres opciones de verdad.
  const cupos: CupoLibre[] = []
  for (const f of fechas) {
    if (cupos.length >= cuantos) break
    const r = await executeTool(
      'check_availability',
      { preferred_date: f.fecha, doctor_id: doctorId },
      clinicId, clinic as never, medico as never,
    )
    const data = (r.data ?? {}) as { slots?: { time: string; starts_at: string }[] }
    const primero = (data.slots ?? [])[0]
    if (primero) cupos.push({ startsAt: primero.starts_at, texto: `${f.texto} a las ${primero.time}` })
  }
  return cupos
}

/**
 * El mensaje que recibe la paciente. Numerado: responder "2" es un gesto tan
 * corto como tocar el botón que la trajo hasta acá.
 */
export function mensajeConCupos(cupos: CupoLibre[], nombreMedico: string): string {
  if (cupos.length === 0) {
    // Sin cupos NO se pregunta "¿cuándo te viene bien?": se dice la verdad y se
    // deja que una persona lo resuelva. Es el caso donde el agente no puede.
    return `Con gusto te ayudo a cambiar la cita. En este momento no veo cupos libres con ${nombreMedico}, ` +
      `así que le paso tu caso a una persona del consultorio para que te ofrezca opciones. Te escriben pronto 🙏`
  }
  const lista = cupos.map((c, i) => `${i + 1}. ${c.texto}`).join('\n')
  return `Claro, te ayudo a cambiar la cita 😊\n\nEstos son los próximos cupos con ${nombreMedico}:\n\n${lista}\n\n` +
    `Respóndeme con el número que prefieras, o dime otro día si ninguno te sirve.`
}
