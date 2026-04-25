'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

export interface CtSchedule {
  id: string
  day_of_week: number
  start_time: string  // "09:00"
  end_time: string    // "11:00"
}

export async function getSchedulesForType(consultationTypeId: string): Promise<CtSchedule[]> {
  await checkReadPermission('whatsapp')
  const { data } = await supabaseAdmin
    .from('consultation_type_schedules')
    .select('id, day_of_week, start_time, end_time')
    .eq('consultation_type_id', consultationTypeId)
    .order('day_of_week')
    .order('start_time')
  return (data ?? []) as CtSchedule[]
}

export async function saveSchedulesForType(
  consultationTypeId: string,
  schedules: Array<{ day_of_week: number; start_time: string; end_time: string }>
): Promise<{ ok: boolean; error?: string }> {
  await checkWritePermission('whatsapp')

  // Validate no overlaps per day
  const byDay = new Map<number, Array<{ start: string; end: string }>>()
  for (const s of schedules) {
    if (s.start_time >= s.end_time) return { ok: false, error: `Hora inicio debe ser menor que fin (día ${s.day_of_week})` }
    const existing = byDay.get(s.day_of_week) ?? []
    for (const e of existing) {
      if (s.start_time < e.end && s.end_time > e.start) {
        return { ok: false, error: `Franjas se solapan en el día ${s.day_of_week}` }
      }
    }
    existing.push({ start: s.start_time, end: s.end_time })
    byDay.set(s.day_of_week, existing)
  }

  // Delete all existing + insert new (atomic replacement)
  await supabaseAdmin.from('consultation_type_schedules').delete().eq('consultation_type_id', consultationTypeId)

  if (schedules.length > 0) {
    const { error } = await supabaseAdmin.from('consultation_type_schedules').insert(
      schedules.map((s) => ({
        consultation_type_id: consultationTypeId,
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }))
    )
    if (error) return { ok: false, error: 'Error guardando franjas' }
  }

  revalidatePath('/dashboard/whatsapp')
  return { ok: true }
}
