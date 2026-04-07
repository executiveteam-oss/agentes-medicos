// ============================================================
// PÁGINA FACTURACIÓN — Control diario de facturación
// Ruta: /dashboard/facturacion
// Merge: facturas de appointments + facturas standalone (invoices)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { FacturacionPanel } from '@/components/dashboard/facturacion-panel'
import { GlosaPanel } from '@/components/dashboard/glosa-panel'
import { getGlosaPageData } from '@/app/actions/glosas'
import { getFeatureGate, isFeatureEnabled } from '@/lib/feature-gate'
import { FeatureLocked } from '@/components/dashboard/feature-locked'
import type { InvoicedItem } from '@/components/dashboard/facturacion-panel'
import type { CollectionStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function FacturacionPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  const gate = await getFeatureGate(session.clinicId)
  if (!isFeatureEnabled(gate.config, 'facturacion')) {
    return (
      <FeatureLocked
        featureName="Control de facturación"
        featureDescription="Registra y gestiona la facturación interna de tu consultorio."
        whatsappMessage="quiero activar Cartera y facturación"
        clinicName={session.clinic?.name}
        plusModuleName="Cartera y facturación"
        doctorCount={gate.expectedDoctors}
      />
    )
  }

  const clinicId = session.clinicId

  // Precio por defecto de la clínica
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('consultation_price')
    .eq('id', clinicId)
    .single()

  const defaultPrice = clinic?.consultation_price ?? 0

  // --- EPS Risk + Glosas ---
  const glosaData = await getGlosaPageData()

  // --- Pendientes: citas completadas de hoy y ayer SIN invoice_number ---
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  const yesterdayUTC = new Date(yesterday.getTime() + 5 * 60 * 60 * 1000)

  const { data: pendingRaw } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, payment_type, clinic_value,
      patients(name),
      doctors(name)
    `)
    .eq('clinic_id', clinicId)
    .eq('status', 'completed')
    .is('invoice_number', null)
    .gte('starts_at', yesterdayUTC.toISOString())
    .order('starts_at', { ascending: true })

  const pending = (pendingRaw ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    const patients = raw.patients as { name: string } | null
    const doctors = raw.doctors as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patients?.name ?? 'Sin nombre',
      doctor_name: doctors?.name ?? 'Sin doctor',
      payment_type: (apt.payment_type as string) ?? 'Particular',
      amount: (apt.clinic_value as number) || defaultPrice,
    }
  })

  // --- Facturas del mes: dos fuentes en paralelo ---
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const inicioMesStr = `${inicioMes.getFullYear()}-${String(inicioMes.getMonth() + 1).padStart(2, '0')}-01`

  const [appointmentInvoicesRes, standaloneInvoicesRes] = await Promise.all([
    // 1. Facturas en appointments
    supabaseAdmin
      .from('appointments')
      .select(`
        id, starts_at, invoice_number, invoice_date, invoice_amount,
        payment_type, collection_status,
        patients(name)
      `)
      .eq('clinic_id', clinicId)
      .not('invoice_number', 'is', null)
      .gte('invoice_date', inicioMesStr)
      .order('invoice_date', { ascending: false }),

    // 2. Facturas standalone
    supabaseAdmin
      .from('invoices')
      .select(`
        id, invoice_number, invoice_date, invoice_amount,
        payment_type, collection_status,
        patients(name)
      `)
      .eq('clinic_id', clinicId)
      .gte('invoice_date', inicioMesStr)
      .order('invoice_date', { ascending: false }),
  ])

  // Mapear facturas de appointments
  const aptInvoices: InvoicedItem[] = (appointmentInvoicesRes.data ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    const patients = raw.patients as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patients?.name ?? 'Sin nombre',
      invoice_number: apt.invoice_number as string,
      invoice_date: (apt.invoice_date as string) ?? (apt.starts_at as string),
      payment_type: (apt.payment_type as string) ?? 'Particular',
      invoice_amount: (apt.invoice_amount as number) || defaultPrice,
      collection_status: ((apt.collection_status as string) ?? 'en_tramite') as CollectionStatus,
      source: 'appointment',
    }
  })

  // Mapear facturas standalone
  const standaloneInvoices: InvoicedItem[] = (standaloneInvoicesRes.data ?? []).map((inv) => {
    const raw = inv as Record<string, unknown>
    const patients = raw.patients as { name: string } | null
    return {
      id: inv.id as string,
      starts_at: inv.invoice_date as string,
      patient_name: patients?.name ?? 'Sin nombre',
      invoice_number: inv.invoice_number as string,
      invoice_date: inv.invoice_date as string,
      payment_type: (inv.payment_type as string) ?? 'Particular',
      invoice_amount: (inv.invoice_amount as number) || 0,
      collection_status: ((inv.collection_status as string) ?? 'en_tramite') as CollectionStatus,
      source: 'standalone',
    }
  })

  // Merge y deduplicar (si una factura standalone tiene appointment_id,
  // el appointment ya la muestra — evitar duplicados por invoice_number)
  const aptInvoiceNumbers = new Set(aptInvoices.map((i) => i.invoice_number))
  const uniqueStandalone = standaloneInvoices.filter((i) => !aptInvoiceNumbers.has(i.invoice_number))
  const allInvoiced = [...aptInvoices, ...uniqueStandalone]
    .sort((a, b) => (b.invoice_date > a.invoice_date ? 1 : -1))

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Facturación</h1>
        <p className="text-slate-500 text-sm">Control diario de facturas, cobros y glosas EPS</p>
      </div>

      {/* EPS Dashboard + Glosas */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">EPS y Glosas</h2>
        <GlosaPanel
          epsRisk={glosaData.epsRisk}
          activeGlosas={glosaData.activeGlosas}
          urgentCount={glosaData.urgentCount}
        />
      </section>

      {/* Facturación diaria */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Facturación diaria</h2>
        <FacturacionPanel
          pending={pending}
          invoiced={allInvoiced}
          defaultAmount={defaultPrice}
        />
      </section>
    </div>
  )
}
