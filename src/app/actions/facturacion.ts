'use server'

// ============================================================
// Server Actions — Facturación: registrar facturas y cobros
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
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

    if (error) {
      return { ok: false, error: `Error guardando factura: ${error.message}` }
    }

    if (!updated || updated.length === 0) {
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

/** Actualizar estado de cobro de una factura en appointments */
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
    return { ok: false, error: 'Error de permisos o sesión (cobro apt)' }
  }
}

// ============================================================
// Citas de un paciente (para el selector en "Nueva factura")
// ============================================================

export interface PatientAppointmentOption {
  id: string
  starts_at: string
  status: string
  doctor_name: string
  payment_type: string
}

/** Obtener citas recientes de un paciente para vincular con factura */
export async function getPatientAppointmentsForInvoice(
  patientId: string
): Promise<PatientAppointmentOption[]> {
  try {
    const clinicId = await checkReadPermission('facturacion')

    const since = new Date()
    since.setDate(since.getDate() - 90)

    const { data } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, status, payment_type, doctors(name)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .gte('starts_at', since.toISOString())
      .order('starts_at', { ascending: false })
      .limit(20)

    return (data ?? []).map((a) => {
      const doc = a.doctors as unknown as { name: string } | null
      return {
        id: a.id,
        starts_at: a.starts_at,
        status: a.status,
        doctor_name: doc?.name ?? 'Sin doctor',
        payment_type: a.payment_type ?? 'Particular',
      }
    })
  } catch {
    return []
  }
}

// ============================================================
// Crear factura manual (con o sin cita asociada)
// ============================================================

export interface ManualInvoiceInput {
  patientId: string
  appointmentId: string | null
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  paymentType: string
  epsName: string
  collectionStatus: CollectionStatus
  observations: string
}

/** Crear factura manual — inserta en invoices, opcionalmente actualiza appointment */
export async function crearFacturaManual(
  input: ManualInvoiceInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    if (!input.invoiceNumber.trim()) {
      return { ok: false, error: 'El número de factura es obligatorio' }
    }
    if (!input.invoiceAmount || input.invoiceAmount <= 0) {
      return { ok: false, error: 'El valor debe ser mayor a 0' }
    }

    // 1. Insertar en tabla invoices
    const { error: insertError } = await supabaseAdmin
      .from('invoices')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patientId,
        appointment_id: input.appointmentId,
        invoice_number: input.invoiceNumber.trim(),
        invoice_date: input.invoiceDate,
        invoice_amount: input.invoiceAmount,
        payment_type: input.paymentType,
        eps_name: input.paymentType === 'EPS' ? (input.epsName.trim() || null) : null,
        collection_status: input.collectionStatus,
        observations: input.observations.trim() || null,
      })

    if (insertError) {
      return { ok: false, error: 'Error guardando factura: ' + insertError.message }
    }

    // 2. Si hay cita asociada, actualizar también la cita
    if (input.appointmentId) {
      await supabaseAdmin
        .from('appointments')
        .update({
          invoice_number: input.invoiceNumber.trim(),
          invoice_date: input.invoiceDate,
          invoice_amount: input.invoiceAmount,
          invoice_status: 'emitida',
          collection_status: input.collectionStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.appointmentId)
        .eq('clinic_id', clinicId)
    }

    // 3. Audit log (best-effort)
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'manual_invoice_created',
      actor_type: 'staff',
      target_type: 'invoice',
      details: {
        invoice_number: input.invoiceNumber.trim(),
        invoice_amount: input.invoiceAmount,
        patient_id: input.patientId,
        appointment_id: input.appointmentId,
      },
    }).then(() => {}, () => {})

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar estado de cobro de una factura standalone */
export async function actualizarEstadoCobroFactura(
  invoiceId: string,
  status: CollectionStatus
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    const { error } = await supabaseAdmin
      .from('invoices')
      .update({
        collection_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando estado' }

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión (factura)' }
  }
}
