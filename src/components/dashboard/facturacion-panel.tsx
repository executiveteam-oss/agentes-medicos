'use client'

// ============================================================
// FacturacionPanel — Pendientes + Nueva factura + Facturas del mes
// ============================================================

import React, { useState } from 'react'
import { registerInvoice } from '@/app/actions/register-invoice'
import { actualizarEstadoCobro, actualizarEstadoCobroFactura } from '@/app/actions/facturacion'
import { NuevaFacturaModal } from '@/components/dashboard/nueva-factura-modal'
import { RegisterGlosaInline } from '@/components/dashboard/register-glosa-inline'
import type { CollectionStatus } from '@/types/database'

// ---------- Types ----------

interface PendingAppointment {
  id: string
  starts_at: string
  patient_name: string
  doctor_name: string
  payment_type: string
  amount: number
}

export interface InvoicedItem {
  id: string
  starts_at: string
  patient_name: string
  invoice_number: string
  invoice_date: string
  payment_type: string
  invoice_amount: number
  collection_status: CollectionStatus
  source: 'appointment' | 'standalone'
}

interface Props {
  pending: PendingAppointment[]
  invoiced: InvoicedItem[]
  defaultAmount: number
}

// ---------- Helpers ----------

function formatCOP(amount: number): string {
  return '$' + new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' })
}

function todayStr(): string {
  const d = new Date()
  const col = new Date(d.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  return `${col.getFullYear()}-${String(col.getMonth() + 1).padStart(2, '0')}-${String(col.getDate()).padStart(2, '0')}`
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// ---------- Main Component ----------

export function FacturacionPanel({ pending: initialPending, invoiced: initialInvoiced, defaultAmount }: Props) {
  const [pending, setPending] = useState(initialPending)
  const [invoiced, setInvoiced] = useState(initialInvoiced)
  const [openFormId, setOpenFormId] = useState<string | null>(null)
  const [showNuevaFactura, setShowNuevaFactura] = useState(false)
  const [glosaFormId, setGlosaFormId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleInlineSaved(aptId: string, invoiceNumber: string, invoiceDate: string, invoiceAmount: number) {
    const apt = pending.find((p) => p.id === aptId)
    setPending((prev) => prev.filter((p) => p.id !== aptId))
    if (apt) {
      setInvoiced((prev) => [{
        id: apt.id,
        starts_at: apt.starts_at,
        patient_name: apt.patient_name,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        payment_type: apt.payment_type,
        invoice_amount: invoiceAmount,
        collection_status: 'en_tramite' as CollectionStatus,
        source: 'appointment' as const,
      }, ...prev])
    }
    setOpenFormId(null)
    showToast(`Factura ${invoiceNumber} registrada`)
  }

  function handleManualSaved() {
    showToast('Factura manual registrada')
    // revalidatePath en el server action recarga los datos
    window.location.reload()
  }

  function handleStatusChange(item: InvoicedItem, newStatus: CollectionStatus) {
    // Si cambian a "glosada" y es appointment, abrir formulario de glosa
    if (newStatus === 'glosada' && item.source === 'appointment') {
      setGlosaFormId(item.id)
      return
    }
    setInvoiced((prev) => prev.map((inv) => inv.id === item.id ? { ...inv, collection_status: newStatus } : inv))
    if (item.source === 'standalone') {
      actualizarEstadoCobroFactura(item.id, newStatus)
    } else {
      actualizarEstadoCobro(item.id, newStatus)
    }
  }

  // Resumen
  const totalFacturado = invoiced.reduce((s, i) => s + (i.invoice_amount ?? 0), 0)
  const totalCobrado = invoiced.filter((i) => i.collection_status === 'cobrada').reduce((s, i) => s + (i.invoice_amount ?? 0), 0)
  const totalPendiente = totalFacturado - totalCobrado

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Modal nueva factura */}
      <NuevaFacturaModal
        isOpen={showNuevaFactura}
        onClose={() => setShowNuevaFactura(false)}
        defaultAmount={defaultAmount}
        onSaved={handleManualSaved}
      />

      {/* Botón nueva factura */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNuevaFactura(true)}
          className="btn-primary text-sm"
        >
          + Nueva factura
        </button>
      </div>

      {/* Pendientes de facturar */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Pendientes de facturar</h2>
            <p className="text-slate-400 text-xs mt-0.5">Citas completadas sin factura</p>
          </div>
          {pending.length > 0 && (
            <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-1 rounded-full">
              {pending.length} sin facturar
            </span>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-900 font-medium">Todo al día</p>
            <p className="text-slate-500 text-sm">No hay citas sin facturar</p>
          </div>
        ) : (
          <div>
            {pending.map((apt) => (
              <div key={apt.id} className="border-b border-slate-50 last:border-b-0">
                <div className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50/50 transition-colors">
                  <span className="text-sm text-slate-600 w-20 shrink-0">{formatTime(apt.starts_at)}</span>
                  <span className="text-sm font-medium text-slate-900 flex-1 truncate">{apt.patient_name}</span>
                  <span className="text-sm text-slate-600 flex-1 truncate">{apt.doctor_name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{apt.payment_type}</span>
                  <span className="text-sm font-semibold text-slate-900 w-24 text-right">{formatCOP(apt.amount)}</span>
                  <div className="w-36 text-right">
                    {openFormId === apt.id ? (
                      <button type="button" onClick={() => setOpenFormId(null)} className="text-xs text-slate-500 hover:text-slate-700">
                        Cancelar
                      </button>
                    ) : (
                      <button type="button" onClick={() => setOpenFormId(apt.id)} className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors">
                        Registrar factura
                      </button>
                    )}
                  </div>
                </div>
                {openFormId === apt.id && (
                  <InlineInvoiceForm
                    appointmentId={apt.id}
                    defaultAmount={apt.amount || defaultAmount}
                    onSaved={(num, date, amount) => handleInlineSaved(apt.id, num, date, amount)}
                    onCancel={() => setOpenFormId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total facturado</p>
          <p className="text-xl font-semibold text-slate-900 mt-1">{formatCOP(totalFacturado)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total cobrado</p>
          <p className="text-xl font-semibold text-emerald-700 mt-1">{formatCOP(totalCobrado)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pendiente de cobro</p>
          <p className="text-xl font-semibold text-amber-700 mt-1">{formatCOP(totalPendiente)}</p>
        </div>
      </div>

      {/* Facturas del mes */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Facturas del mes</h2>
          <p className="text-slate-400 text-xs mt-0.5">{invoiced.length} factura{invoiced.length !== 1 ? 's' : ''}</p>
        </div>

        {invoiced.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 text-sm">No hay facturas este mes</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Paciente</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">N° Factura</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tipo pago</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Valor</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Estado cobro</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Días</th>
                </tr>
              </thead>
              <tbody>
                {invoiced.map((inv) => (
                  <React.Fragment key={`${inv.source}-${inv.id}`}>
                    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-5 text-sm text-slate-900">{inv.patient_name}</td>
                      <td className="py-3 px-5 text-sm text-slate-600 font-mono">{inv.invoice_number}</td>
                      <td className="py-3 px-5">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{inv.payment_type}</span>
                      </td>
                      <td className="py-3 px-5 text-sm font-semibold text-slate-900 text-right">{formatCOP(inv.invoice_amount)}</td>
                      <td className="py-3 px-5">
                        <select
                          value={inv.collection_status}
                          onChange={(e) => handleStatusChange(inv, e.target.value as CollectionStatus)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white"
                        >
                          <option value="en_tramite">En trámite</option>
                          <option value="cobrada">Cobrada</option>
                          <option value="glosada">Glosada</option>
                          <option value="vencida">Vencida</option>
                        </select>
                      </td>
                      <td className="py-3 px-5 text-sm text-slate-500 text-right">{daysSince(inv.invoice_date)}d</td>
                    </tr>
                    {glosaFormId === inv.id && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <RegisterGlosaInline
                            appointmentId={inv.id}
                            defaultAmount={inv.invoice_amount}
                            onRegistered={() => {
                              setGlosaFormId(null)
                              setInvoiced((prev) => prev.map((i) => i.id === inv.id ? { ...i, collection_status: 'glosada' as CollectionStatus } : i))
                              showToast('Glosa registrada')
                            }}
                            onCancel={() => setGlosaFormId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// InlineInvoiceForm — Para citas pendientes (inline)
// ============================================================

function InlineInvoiceForm({
  appointmentId,
  defaultAmount,
  onSaved,
  onCancel,
}: {
  appointmentId: string
  defaultAmount: number
  onSaved: (invoiceNumber: string, invoiceDate: string, invoiceAmount: number) => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayStr())
  const [invoiceAmount, setInvoiceAmount] = useState(defaultAmount)
  const [observations, setObservations] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invoiceNumber.trim()) { setError('N° factura obligatorio'); return }
    setSaving(true)
    setError('')
    try {
      const result = await registerInvoice(appointmentId, {
        invoiceNumber: invoiceNumber.trim(), invoiceDate, invoiceAmount, observations,
      })
      if (result.ok) { onSaved(invoiceNumber.trim(), invoiceDate, invoiceAmount) }
      else { setError(result.error ?? 'Error') }
    } catch { setError('Error de conexión') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 bg-blue-50/50 border-t border-blue-100">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">N° Factura *</label>
          <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="FE-001234" autoFocus autoComplete="off" className="input-field text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha</label>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input-field text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Valor</label>
          <input type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(parseInt(e.target.value) || 0)} className="input-field text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Observaciones</label>
          <input type="text" value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Opcional" className="input-field text-sm" />
        </div>
      </div>
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Guardando...' : 'Guardar'}</button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
      </div>
    </form>
  )
}
