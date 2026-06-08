// ============================================================
// Pulls appointments + relaciones para el reporte.
// Filtros:
//   - clinic_id (multi-tenant)
//   - status IN ('confirmed', 'rescheduled', 'completed') — no canceladas, no no-show
//   - payment_type NOT IN ('Póliza', 'SOAT')
//   - starts_at BETWEEN from AND to
// El filtro por res256_category se hace POST-fetch
// porque depende de consultation_type y consultas iSalud sin CT vienen NULL.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Res256SourceRow } from './types'

const EXCLUDED_PAYMENT_TYPES = ['Póliza', 'SOAT'] as const

export async function fetchSourceRows(args: {
  clinicId: string
  fromDate: string  // YYYY-MM-DD
  toDate: string    // YYYY-MM-DD
}): Promise<Res256SourceRow[]> {
  const { clinicId, fromDate, toDate } = args
  const fromIso = `${fromDate}T00:00:00-05:00`
  const toIso = `${toDate}T23:59:59-05:00`

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, created_at, requested_at, desired_at,
      payment_type, eps_name, consultation_type_id, doctor_id,
      patient:patients(id, document_type, document_number, date_of_birth, gender, first_name, middle_name, first_last_name, second_last_name, eps, eapb_code, name),
      consultationType:consultation_types(id, name, res256_category),
      doctor:doctors(id, name, specialty)
    `)
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed', 'rescheduled', 'completed'])
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso)
    .not('payment_type', 'in', `(${EXCLUDED_PAYMENT_TYPES.map(p => `"${p}"`).join(',')})`)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[res256.query] Error:', error)
    throw new Error(`Error consultando appointments: ${error.message}`)
  }

  // Filtrar acá las que NO tienen res256_category clasificada (consultation_type_id NULL O category NULL/NoAplica)
  // → Fase 1 las EXCLUYE del reporte. Fase 2 las captura via complement table.
  return (data ?? []).filter((r) => {
    const cat = (r.consultationType as { res256_category?: string } | null)?.res256_category
    return cat && cat !== 'NoAplica'
  }) as unknown as Res256SourceRow[]
}
