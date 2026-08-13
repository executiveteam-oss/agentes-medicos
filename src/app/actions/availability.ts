'use server'

// ============================================================
// La disponibilidad que pinta la grilla del dashboard.
//
// No calcula nada: delega en `lib/calendar/fetch-day-availability`, la misma
// que usa `check_availability` del agente. Si la secretaria ve verde, el agente
// ve verde — no porque dos consultas coincidan, sino porque es una sola.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission } from '@/lib/actions-helpers'
import { traerDisponibilidadRango } from '@/lib/calendar/fetch-day-availability'
import type { DisponibilidadDelDia } from '@/lib/calendar/day-availability'

/**
 * Disponibilidad de un médico para las fechas que la grilla tiene en pantalla.
 *
 * Devuelve `{}` —no lanza— si algo falla: la agenda tiene que seguir mostrando
 * las citas aunque el sombreado no cargue. Sin franjas, la grilla se pinta
 * neutra, que es exactamente como se veía antes de esto.
 */
export async function getDisponibilidadAgenda(
  doctorId: string,
  fechas: string[],
): Promise<Record<string, DisponibilidadDelDia>> {
  try {
    const clinicId = await checkWritePermission('agenda')
    if (!doctorId || fechas.length === 0) return {}

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('working_hours, whatsapp_config, operational_status, operational_status_message')
      .eq('id', clinicId)
      .single()
    if (!clinic) return {}

    return await traerDisponibilidadRango(clinicId, doctorId, fechas, clinic)
  } catch {
    return {}
  }
}
