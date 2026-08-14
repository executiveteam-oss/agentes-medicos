'use server'

// ============================================================
// Excepciones de horario por fecha — "este martes atiendo distinto".
//
// Permiso: `whatsapp`, NO `settings`. Es la misma deuda documentada de doctores
// y horarios: cambiarlo a 'settings' por prolijidad deja SOLO a Admin editando
// y le saca el acceso a Coordinadora de un día para otro.
//
// Las citas que quedan fuera del horario nuevo NO se tocan: se cuentan y se
// devuelven para que una persona decida. Cancelar o mover automáticamente una
// cita que una paciente ya tiene confirmada es exactamente lo que no puede
// hacer un cambio de configuración.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import { validateBlocks, stripEmptyBlocks } from '@/lib/utils/working-hours'
import type { WorkingBlock } from '@/types/database'

export interface ExcepcionHorario {
  id: string
  doctor_id: string
  exception_date: string
  blocks: WorkingBlock[]
  reason: string | null
}

/** Una cita que quedó fuera del horario nuevo. Informativa: no se toca nada. */
export interface CitaFuera {
  id: string
  hora: string
  paciente: string
  servicio: string | null
}

const aMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export async function getExcepciones(doctorId: string): Promise<ExcepcionHorario[]> {
  const clinicId = await checkWritePermission('whatsapp')
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const { data } = await supabaseAdmin
    .from('doctor_schedule_exceptions')
    .select('id, doctor_id, exception_date, blocks, reason')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    // Las pasadas no se muestran: ya no cambian nada y ensucian la lista.
    .gte('exception_date', hoy)
    .order('exception_date', { ascending: true })
  return (data ?? []) as ExcepcionHorario[]
}

/**
 * Crea o actualiza la excepción de un médico para UNA fecha.
 *
 * Devuelve las citas que quedan fuera del horario nuevo — sin tocarlas.
 */
export async function guardarExcepcion(input: {
  doctorId: string
  fecha: string
  blocks: WorkingBlock[]
  reason: string | null
}): Promise<{ ok: boolean; error?: string; citasFuera?: CitaFuera[] }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) {
      return { ok: false, error: 'Fecha inválida' }
    }

    // Mismas reglas que el horario base: se reusa el validador, no se escribe
    // otro. Los renglones en blanco se descartan antes de validar.
    const blocks = stripEmptyBlocks(input.blocks ?? [])
    if (blocks.length === 0) {
      return {
        ok: false,
        error: 'La excepción necesita al menos un bloque horario. Si ese día no se atiende, usá "Bloqueos" en vez de una excepción.',
      }
    }
    const err = validateBlocks(blocks)
    if (err) return { ok: false, error: err }

    const { data: previa } = await supabaseAdmin
      .from('doctor_schedule_exceptions')
      .select('id, blocks')
      .eq('clinic_id', clinicId).eq('doctor_id', input.doctorId)
      .eq('exception_date', input.fecha)
      .maybeSingle()

    const { error: dbErr } = await supabaseAdmin
      .from('doctor_schedule_exceptions')
      .upsert(
        {
          clinic_id: clinicId,
          doctor_id: input.doctorId,
          exception_date: input.fecha,
          blocks,
          reason: input.reason?.trim() || null,
        },
        { onConflict: 'doctor_id,exception_date' },
      )
    if (dbErr) {
      console.error('[guardarExcepcion]', dbErr)
      return { ok: false, error: 'No se pudo guardar la excepción' }
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: previa ? 'schedule_exception_updated' : 'schedule_exception_created',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: input.doctorId,
      details: {
        fecha: input.fecha,
        blocks,
        ...(previa ? { blocks_previos: previa.blocks } : {}),
        motivo: input.reason?.trim() || null,
      },
    })

    const citasFuera = await citasFueraDelHorario(clinicId, input.doctorId, input.fecha, blocks)

    revalidatePath('/dashboard/doctors')
    revalidatePath('/dashboard/agenda')
    return { ok: true, citasFuera }
  } catch (e) {
    console.error('[guardarExcepcion]', e)
    return { ok: false, error: 'No se pudo guardar la excepción' }
  }
}

export async function borrarExcepcion(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    const { data: previa } = await supabaseAdmin
      .from('doctor_schedule_exceptions')
      .select('doctor_id, exception_date, blocks, reason')
      .eq('id', id).eq('clinic_id', clinicId)
      .maybeSingle()
    if (!previa) return { ok: false, error: 'La excepción ya no existe' }

    const { error } = await supabaseAdmin
      .from('doctor_schedule_exceptions')
      .delete().eq('id', id).eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'No se pudo borrar' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'schedule_exception_deleted',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: previa.doctor_id as string,
      details: {
        fecha: previa.exception_date,
        blocks: previa.blocks,
        motivo: previa.reason,
      },
    })

    revalidatePath('/dashboard/doctors')
    revalidatePath('/dashboard/agenda')
    return { ok: true }
  } catch (e) {
    console.error('[borrarExcepcion]', e)
    return { ok: false, error: 'No se pudo borrar' }
  }
}

/**
 * Citas ya agendadas que caen fuera de las franjas nuevas.
 *
 * NO cancela, NO mueve, NO notifica. Devuelve la lista para que la secretaria
 * vea qué quedó descolgado y decida. El horario lo cambió ella; qué hacer con
 * una paciente que ya tiene hora confirmada es una decisión aparte.
 */
async function citasFueraDelHorario(
  clinicId: string,
  doctorId: string,
  fecha: string,
  blocks: WorkingBlock[],
): Promise<CitaFuera[]> {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, reason, external_service_name, patients(name), consultation_types(name)')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', `${fecha}T00:00:00-05:00`)
    .lte('starts_at', `${fecha}T23:59:59-05:00`)
    .order('starts_at', { ascending: true })

  const fuera: CitaFuera[] = []
  for (const a of data ?? []) {
    const hora = new Date(a.starts_at as string).toLocaleTimeString('en-GB', {
      timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit',
    })
    const min = aMin(hora)
    const dentro = blocks.some((b) => min >= aMin(b.start) && min < aMin(b.end))
    if (dentro) continue

    const ficha = (a.patients as unknown as { name: string } | null)?.name
    fuera.push({
      id: a.id as string,
      hora,
      // El nombre de la ficha si está enlazada; si no, el que trajo el HIS.
      paciente: ficha || (a.reason as string | null) || 'Paciente',
      servicio: (a.consultation_types as unknown as { name: string } | null)?.name
        ?? (a.external_service_name as string | null)
        ?? null,
    })
  }
  return fuera
}
