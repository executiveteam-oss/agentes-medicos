'use server'

// ============================================================
// Server Actions — Cartera y cobros (CRUD + WhatsApp)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { formatCOP } from '@/lib/utils/dates'
import { getSessionClinicId, checkWritePermission } from '@/lib/actions-helpers'
import type { PaymentType } from '@/types/database'

/**
 * Enviar mensaje de cobro por WhatsApp a un paciente en cartera
 * Registra el intento en audit_log y actualiza collection_attempts
 */
export async function sendCollectionMessage(carteraId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    // Obtener entrada de cartera con datos del paciente
    const { data: entry, error: fetchError } = await supabaseAdmin
      .from('cartera')
      .select('*, patients(name, phone)')
      .eq('id', carteraId)
      .eq('clinic_id', clinicId)
      .single()

    if (fetchError || !entry) {
      return { ok: false, error: 'Entrada de cartera no encontrada' }
    }

    const patient = entry.patients as { name: string; phone: string } | null
    if (!patient) return { ok: false, error: 'Paciente no encontrado' }

    const monto = formatCOP(entry.amount)
    const mensaje =
      `Hola ${patient.name} 👋, te escribimos del consultorio para recordarte que tienes un saldo pendiente de ${monto} COP` +
      (entry.treatment ? ` por ${entry.treatment}` : '') +
      `. Por favor contáctanos para coordinar el pago. ¡Gracias!`

    // Enviar WhatsApp
    const phone = patient.phone.replace('+', '')
    await sendWhatsAppMessage(phone, mensaje)

    // Actualizar intentos de cobro
    await supabaseAdmin
      .from('cartera')
      .update({
        collection_attempts: (entry.collection_attempts ?? 0) + 1,
        last_collection_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', carteraId)
      .eq('clinic_id', clinicId)

    // Auditoría
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cartera_collection_attempt',
      actor_type: 'staff',
      target_type: 'cartera',
      target_id: carteraId,
      details: { patient_name: patient.name, amount: entry.amount },
    })

    revalidatePath('/dashboard/cartera')
    return { ok: true }
  } catch (error) {
    console.error('[sendCollectionMessage]', error)
    return { ok: false, error: 'Error enviando mensaje' }
  }
}

// ============================================================
// CRUD Cartera
// ============================================================

export interface CarteraInput {
  patient_id: string
  treatment: string
  amount: number
  payment_type: PaymentType
  due_date: string
  notes: string
}

/** Crear entrada de cartera (deuda) */
export async function createCarteraEntry(
  input: CarteraInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('cartera')

    if (!input.patient_id) return { ok: false, error: 'Selecciona un paciente' }
    if (!input.amount || input.amount <= 0) return { ok: false, error: 'El monto debe ser mayor a 0' }
    if (!input.treatment.trim()) return { ok: false, error: 'El concepto es obligatorio' }

    // Calcular días vencidos
    const dueDate = input.due_date ? new Date(input.due_date) : new Date()
    const now = new Date()
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))

    const { data, error } = await supabaseAdmin
      .from('cartera')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        treatment: input.treatment.trim(),
        amount: input.amount,
        payment_type: input.payment_type || 'Particular',
        days_overdue: daysOverdue,
        notes: input.notes.trim() || null,
        status: 'pendiente',
        collection_attempts: 0,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando entrada de cartera' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cartera_entry_created',
      actor_type: 'staff',
      target_type: 'cartera',
      target_id: data.id,
      details: { amount: input.amount, treatment: input.treatment.trim() },
    })

    revalidatePath('/dashboard/cartera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar entrada de cartera */
export async function updateCarteraEntry(
  entryId: string,
  input: CarteraInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('cartera')

    const { error } = await supabaseAdmin
      .from('cartera')
      .update({
        patient_id: input.patient_id,
        treatment: input.treatment.trim(),
        amount: input.amount,
        payment_type: input.payment_type || 'Particular',
        notes: input.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando entrada' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cartera_entry_updated',
      actor_type: 'staff',
      target_type: 'cartera',
      target_id: entryId,
      details: { amount: input.amount },
    })

    revalidatePath('/dashboard/cartera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Marcar deuda como pagada */
export async function markCarteraPaid(
  entryId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('cartera')

    const { error } = await supabaseAdmin
      .from('cartera')
      .update({
        status: 'pagado',
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando estado' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cartera_marked_paid',
      actor_type: 'staff',
      target_type: 'cartera',
      target_id: entryId,
      details: {},
    })

    revalidatePath('/dashboard/cartera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Eliminar entrada de cartera */
export async function deleteCarteraEntry(
  entryId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('cartera')

    const { error } = await supabaseAdmin
      .from('cartera')
      .delete()
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error eliminando entrada' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cartera_entry_deleted',
      actor_type: 'staff',
      target_type: 'cartera',
      target_id: entryId,
      details: {},
    })

    revalidatePath('/dashboard/cartera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
