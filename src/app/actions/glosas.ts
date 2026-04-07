'use server'

// ============================================================
// Server Actions — Gestión de glosas EPS
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import { agregarDiasHabiles } from '@/lib/utils/festivos'
import type { GlosaStatus } from '@/types/database'

// --- Types ---

export interface EpsRiskRow {
  epsName: string
  invoicedCount: number
  invoicedTotal: number
  glosaRate: number        // 0-100
  avgPaymentDays: number
  risk: 'low' | 'mid' | 'high'
}

export interface GlosaEntry {
  id: string                   // appointment id
  invoiceNumber: string
  epsName: string
  patientName: string
  glosaReason: string | null
  glosaValue: number
  glosaNotificationDate: string | null
  glosaResponseDate: string | null
  glosaStatus: GlosaStatus
  glosaDeadline: string | null  // YYYY-MM-DD (15 días hábiles from notification)
  diasRestantes: number | null  // Días hábiles hasta deadline
  glosaNotes: string | null
}

export interface GlosaPageData {
  epsRisk: EpsRiskRow[]
  activeGlosas: GlosaEntry[]
  urgentCount: number          // Glosas que vencen en <3 días hábiles
}

import { GLOSA_REASONS } from '@/lib/utils/glosa-reasons'

/**
 * Obtener datos para el dashboard de EPS y glosas.
 */
export async function getGlosaPageData(): Promise<GlosaPageData> {
  const clinicId = await checkReadPermission('facturacion')

  // Mes actual
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  // Consultas en paralelo
  const [epsInvoicesRes, allEpsHistoryRes, activeGlosasRes] = await Promise.all([
    // Facturas EPS radicadas este mes
    supabaseAdmin
      .from('appointments')
      .select('id, eps_name, clinic_value, invoice_status, invoice_radication_date')
      .eq('clinic_id', clinicId)
      .eq('payment_type', 'EPS')
      .not('invoice_number', 'is', null)
      .gte('invoice_date', monthStart),

    // Historial completo EPS (últimos 12 meses) para calcular tasas
    supabaseAdmin
      .from('appointments')
      .select('id, eps_name, collection_status, invoice_status, invoice_radication_date, glosa_value')
      .eq('clinic_id', clinicId)
      .eq('payment_type', 'EPS')
      .not('invoice_number', 'is', null)
      .gte('invoice_date', new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().split('T')[0]),

    // Glosas activas (pending o responded)
    supabaseAdmin
      .from('appointments')
      .select('id, invoice_number, eps_name, glosa_reason, glosa_value, glosa_notification_date, glosa_response_date, glosa_status, glosa_notes, patients(name)')
      .eq('clinic_id', clinicId)
      .in('glosa_status', ['pending', 'responded'])
      .order('glosa_notification_date', { ascending: true }),
  ])

  // ==================== EPS RISK TABLE ====================
  const thisMonthEps = epsInvoicesRes.data ?? []
  const historyEps = allEpsHistoryRes.data ?? []

  // Agrupar por EPS
  const epsMap: Record<string, {
    monthCount: number
    monthTotal: number
    historyTotal: number
    historyGlosadas: number
    paymentDays: number[]
  }> = {}

  for (const apt of thisMonthEps) {
    const name = apt.eps_name ?? 'EPS Sin nombre'
    if (!epsMap[name]) epsMap[name] = { monthCount: 0, monthTotal: 0, historyTotal: 0, historyGlosadas: 0, paymentDays: [] }
    epsMap[name].monthCount++
    epsMap[name].monthTotal += apt.clinic_value ?? 0
  }

  for (const apt of historyEps) {
    const name = apt.eps_name ?? 'EPS Sin nombre'
    if (!epsMap[name]) epsMap[name] = { monthCount: 0, monthTotal: 0, historyTotal: 0, historyGlosadas: 0, paymentDays: [] }
    epsMap[name].historyTotal++
    if (apt.invoice_status === 'glosada' || (apt.glosa_value && apt.glosa_value > 0)) {
      epsMap[name].historyGlosadas++
    }
    // Días de pago: diferencia entre radicación y hoy (o fecha cobro)
    if (apt.invoice_radication_date) {
      const rad = new Date(apt.invoice_radication_date)
      const daysSince = Math.floor((Date.now() - rad.getTime()) / 86400000)
      if (apt.collection_status === 'cobrada') {
        epsMap[name].paymentDays.push(daysSince)
      } else if (daysSince > 0) {
        epsMap[name].paymentDays.push(daysSince)
      }
    }
  }

  const epsRisk: EpsRiskRow[] = Object.entries(epsMap)
    .map(([name, data]) => {
      const glosaRate = data.historyTotal > 0
        ? Math.round((data.historyGlosadas / data.historyTotal) * 100)
        : 0
      const avgDays = data.paymentDays.length > 0
        ? Math.round(data.paymentDays.reduce((s, d) => s + d, 0) / data.paymentDays.length)
        : 0

      let risk: 'low' | 'mid' | 'high' = 'low'
      if (glosaRate > 25 || avgDays > 60) risk = 'high'
      else if (glosaRate > 10 || avgDays > 45) risk = 'mid'

      return {
        epsName: name,
        invoicedCount: data.monthCount,
        invoicedTotal: data.monthTotal,
        glosaRate,
        avgPaymentDays: avgDays,
        risk,
      }
    })
    .sort((a, b) => {
      const riskOrder = { high: 0, mid: 1, low: 2 }
      return riskOrder[a.risk] - riskOrder[b.risk]
    })

  // ==================== ACTIVE GLOSAS ====================
  const { diasHabilesHasta } = await import('@/lib/utils/festivos')

  const activeGlosas: GlosaEntry[] = (activeGlosasRes.data ?? []).map((apt) => {
    const patient = apt.patients as unknown as { name: string } | null
    const notifDate = apt.glosa_notification_date
    let deadline: string | null = null
    let diasRestantes: number | null = null

    if (notifDate) {
      deadline = agregarDiasHabiles(new Date(notifDate + 'T12:00:00'), 15)
      diasRestantes = diasHabilesHasta(new Date(deadline + 'T12:00:00'))
    }

    return {
      id: apt.id,
      invoiceNumber: apt.invoice_number ?? '-',
      epsName: apt.eps_name ?? 'EPS',
      patientName: patient?.name ?? 'Sin nombre',
      glosaReason: apt.glosa_reason,
      glosaValue: apt.glosa_value ?? 0,
      glosaNotificationDate: notifDate,
      glosaResponseDate: apt.glosa_response_date,
      glosaStatus: (apt.glosa_status as GlosaStatus) ?? 'pending',
      glosaDeadline: deadline,
      diasRestantes,
      glosaNotes: apt.glosa_notes,
    }
  })

  const urgentCount = activeGlosas.filter((g) =>
    g.diasRestantes !== null && g.diasRestantes <= 3 && g.glosaStatus === 'pending'
  ).length

  return { epsRisk, activeGlosas, urgentCount }
}

/**
 * Registrar una glosa en una factura/cita.
 */
export async function registrarGlosa(input: {
  appointmentId: string
  reason: string
  customReason?: string
  amount: number
  notificationDate: string  // YYYY-MM-DD
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    const finalReason = input.reason === 'Otro' && input.customReason?.trim()
      ? input.customReason.trim()
      : input.reason

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        glosa_reason: finalReason,
        glosa_value: input.amount,
        glosa_notification_date: input.notificationDate,
        glosa_status: 'pending',
        invoice_status: 'glosada',
        collection_status: 'glosada',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error registrando glosa' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'glosa_registered',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: input.appointmentId,
      details: { reason: finalReason, amount: input.amount, notification_date: input.notificationDate },
    })

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Registrar respuesta a una glosa.
 */
export async function responderGlosa(input: {
  appointmentId: string
  notes: string
  responseDate: string  // YYYY-MM-DD
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        glosa_status: 'responded',
        glosa_response_date: input.responseDate,
        glosa_notes: input.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error registrando respuesta' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'glosa_responded',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: input.appointmentId,
      details: { response_date: input.responseDate },
    })

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Resolver una glosa (levantada o definitiva).
 */
export async function resolverGlosa(input: {
  appointmentId: string
  resolution: 'lifted' | 'definitive'
  notes?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('facturacion')

    const updateFields: Record<string, unknown> = {
      glosa_status: input.resolution,
      updated_at: new Date().toISOString(),
    }

    if (input.notes?.trim()) {
      // Append to existing notes
      const { data: current } = await supabaseAdmin
        .from('appointments')
        .select('glosa_notes')
        .eq('id', input.appointmentId)
        .eq('clinic_id', clinicId)
        .single()

      const existingNotes = (current?.glosa_notes as string) ?? ''
      updateFields.glosa_notes = existingNotes
        ? `${existingNotes}\n\n[Resolución] ${input.notes.trim()}`
        : `[Resolución] ${input.notes.trim()}`
    }

    // Si fue levantada, restaurar estado de cobro
    if (input.resolution === 'lifted') {
      updateFields.collection_status = 'en_tramite'
      updateFields.invoice_status = 'emitida'
    }

    const { error } = await supabaseAdmin
      .from('appointments')
      .update(updateFields)
      .eq('id', input.appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error resolviendo glosa' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: input.resolution === 'lifted' ? 'glosa_lifted' : 'glosa_definitive',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: input.appointmentId,
      details: { resolution: input.resolution },
    })

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

// ============================================================
// EPS Profitability data for analytics
// ============================================================

export interface EpsProfitability {
  epsName: string
  facturado: number
  cobrado: number
  glosado: number
}

/**
 * Obtener rentabilidad por EPS (para el gráfico en estadísticas).
 */
export async function getEpsProfitability(doctorId?: string | null): Promise<EpsProfitability[]> {
  const clinicId = await checkReadPermission('analytics')

  // Últimos 6 meses
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const sinceStr = sixMonthsAgo.toISOString().split('T')[0]

  let query = supabaseAdmin
    .from('appointments')
    .select('eps_name, clinic_value, collection_status, glosa_value')
    .eq('clinic_id', clinicId)
    .eq('payment_type', 'EPS')
    .not('invoice_number', 'is', null)
    .gte('invoice_date', sinceStr)
  if (doctorId) query = query.eq('doctor_id', doctorId)
  const { data } = await query

  const epsMap: Record<string, { facturado: number; cobrado: number; glosado: number }> = {}

  for (const apt of data ?? []) {
    const name = (apt.eps_name as string) ?? 'EPS Sin nombre'
    if (!epsMap[name]) epsMap[name] = { facturado: 0, cobrado: 0, glosado: 0 }
    const val = (apt.clinic_value as number) ?? 0
    epsMap[name].facturado += val
    if (apt.collection_status === 'cobrada') {
      epsMap[name].cobrado += val
    }
    epsMap[name].glosado += (apt.glosa_value as number) ?? 0
  }

  return Object.entries(epsMap)
    .map(([epsName, d]) => ({ epsName, ...d }))
    .sort((a, b) => b.facturado - a.facturado)
}
