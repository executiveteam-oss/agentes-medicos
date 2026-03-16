'use server'

// ============================================================
// Server Action — Registrar factura (standalone, nueva)
// Hace UNA cosa: actualiza la cita con datos de factura.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getUserSession } from '@/lib/session'

export async function registerInvoice(
  appointmentId: string,
  data: {
    invoiceNumber: string
    invoiceDate: string
    invoiceAmount: number
    observations: string
  }
): Promise<{ ok: boolean; error?: string }> {
  // 1. Obtener sesión
  const session = await getUserSession()
  if (!session) {
    return { ok: false, error: 'No autenticado' }
  }
  const clinicId = session.clinicId

  // 2. Validar
  if (!data.invoiceNumber || !data.invoiceNumber.trim()) {
    return { ok: false, error: 'Número de factura obligatorio' }
  }

  // 3. Ejecutar UPDATE
  const { data: rows, error } = await supabaseAdmin
    .from('appointments')
    .update({
      invoice_number: data.invoiceNumber.trim(),
      invoice_date: data.invoiceDate || null,
      invoice_amount: data.invoiceAmount || null,
      invoice_observations: data.observations.trim() || null,
      invoice_status: 'emitida',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .select('id')

  if (error) {
    console.error('[registerInvoice] DB error:', error.message)
    return { ok: false, error: 'Error en base de datos: ' + error.message }
  }

  if (!rows || rows.length === 0) {
    return { ok: false, error: 'Cita no encontrada. Recarga la página.' }
  }

  // 4. Audit log (best-effort, no bloquea)
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'invoice_registered',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: { invoice_number: data.invoiceNumber.trim() },
  }).then(() => {}, () => {})

  revalidatePath('/dashboard/facturacion')
  return { ok: true }
}
