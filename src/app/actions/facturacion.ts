'use server'

// ============================================================
// Server Actions — Facturación: registrar facturas y cobros
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { checkWritePermission } from '@/lib/actions-helpers'
import type { CollectionStatus } from '@/types/database'

/** Registrar factura para una cita */
export async function registrarFactura(formData: {
  appointmentId: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  observations: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    if (!formData.invoiceNumber.trim()) {
      return { ok: false, error: 'El número de factura es obligatorio' }
    }

    console.log('[registrarFactura] clinicId:', clinicId, 'appointmentId:', formData.appointmentId)

    const { data: updated, error } = await supabaseAdmin
      .from('appointments')
      .update({
        invoice_number: formData.invoiceNumber.trim(),
        invoice_date: formData.invoiceDate,
        invoice_amount: formData.invoiceAmount,
        invoice_observations: formData.observations.trim() || null,
        invoice_status: 'emitida',
        collection_status: 'en_tramite',
        updated_at: new Date().toISOString(),
      })
      .eq('id', formData.appointmentId)
      .eq('clinic_id', clinicId)
      .select('id')

    console.log('[registrarFactura] result:', { updated, error })

    if (error) {
      console.error('[registrarFactura] Supabase error:', error)
      return { ok: false, error: `Error guardando factura: ${error.message}` }
    }

    if (!updated || updated.length === 0) {
      console.error('[registrarFactura] No rows updated — appointmentId or clinicId mismatch')
      return { ok: false, error: 'No se encontró la cita. Recarga la página e intenta de nuevo.' }
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'invoice_registered',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: formData.appointmentId,
      details: {
        invoice_number: formData.invoiceNumber.trim(),
        invoice_amount: formData.invoiceAmount,
      },
    })

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar estado de cobro de una factura */
export async function actualizarEstadoCobro(
  appointmentId: string,
  status: CollectionStatus
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        collection_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando estado' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'collection_status_updated',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: { collection_status: status },
    })

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
