'use server'

// ============================================================
// Server actions: Estado del sistema (página pública /status)
// Lectura: pública | Escritura: solo super admin
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'

const SUPER_ADMIN_EMAIL = 'executive.team@loncocapital.com'

export interface SystemComponent {
  id: string
  component: string
  status: 'operational' | 'degraded' | 'outage'
  message: string | null
  updated_at: string
}

// Labels exportados como constante — usable en server y client
// No es server action, es solo data


/**
 * Obtiene el estado de todos los componentes (público, sin auth)
 */
export async function getSystemStatus(): Promise<SystemComponent[]> {
  const { data } = await supabaseAdmin
    .from('system_status')
    .select('*')
    .order('component')

  return (data ?? []) as SystemComponent[]
}

/**
 * Actualiza el estado de un componente (solo super admin)
 */
export async function updateSystemStatus(
  componentId: string,
  status: 'operational' | 'degraded' | 'outage',
  message?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getUserSession()
  if (!session || session.email !== SUPER_ADMIN_EMAIL) {
    return { ok: false, error: 'Solo el super administrador puede actualizar el estado' }
  }

  const { error } = await supabaseAdmin
    .from('system_status')
    .update({
      status,
      message: message?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', componentId)

  if (error) return { ok: false, error: 'Error actualizando estado' }
  return { ok: true }
}

