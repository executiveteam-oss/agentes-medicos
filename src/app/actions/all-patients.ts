'use server'

// ============================================================
// Server Action — Cargar TODOS los pacientes de una clínica
// (max 500, para filtrado client-side)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'

export interface SimplePatient {
  id: string
  name: string
  phone: string
  eps: string | null
  total_appointments: number
  no_show_count: number
}

export async function getAllPatients(): Promise<SimplePatient[]> {
  const session = await getUserSession()
  if (!session) return []

  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('id, name, phone, eps, total_appointments, no_show_count')
    .eq('clinic_id', session.clinicId)
    .order('name', { ascending: true })
    .limit(500)

  if (error) {
    console.error('[getAllPatients] error:', error.message)
    return []
  }

  return data ?? []
}
