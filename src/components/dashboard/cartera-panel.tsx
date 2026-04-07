'use client'

// ============================================================
// CarteraPanel — Panel interactivo de cartera con CRUD
// ============================================================

import { useState, useTransition } from 'react'
import { CarteraFormModal } from '@/components/dashboard/cartera-form-modal'
import { markCarteraPaid, deleteCarteraEntry, sendCollectionMessage, sendCollectionEmail } from '@/app/actions/cartera'
import { formatCOP } from '@/lib/utils/dates'
import { PriorityBadge } from '@/components/dashboard/priority-badge'
import type { PriorityTier } from '@/components/dashboard/priority-badge'
import type { CarteraEntryWithDetails, PaymentType } from '@/types/database'

function getCarteraPatientTier(entry: CarteraEntryWithDetails): PriorityTier | null {
  const p = entry.patient
  if (!p) return null
  let score = 0
  // Payment: use cartera entry payment_type
  if (entry.payment_type === 'Particular') score += 30
  else score += 10
  // Cartera: always -20 (they're in cartera)
  score -= 20
  // Frequency
  if (p.total_appointments >= 5) score += 25
  else if (p.total_appointments >= 2) score += 15
  // No-shows
  if (p.no_show_count === 0) score += 20
  else if (p.no_show_count === 1) score += 5
  else score -= 10

  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return null
}

interface Props {
  entries: CarteraEntryWithDetails[]
  totalDeuda: number
  totalVencida30: number
  countPacientes: number
}

export function CarteraPanel({ entries: initialEntries, totalDeuda, totalVencida30, countPacientes }: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [showModal, setShowModal] = useState(false)
  const [editData, setEditData] = useState<{
    id: string; patient_id: string; patient_name: string; treatment: string
    amount: number; payment_type: PaymentType; due_date: string; notes: string
  } | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleOpenCreate() {
    setEditData(undefined)
    setShowModal(true)
  }

  function handleEdit(entry: CarteraEntryWithDetails) {
    setEditData({
      id: entry.id,
      patient_id: entry.patient_id,
      patient_name: entry.patient?.name ?? '',
      treatment: entry.treatment ?? '',
      amount: entry.amount,
      payment_type: entry.payment_type,
      due_date: '',
      notes: entry.notes ?? '',
    })
    setShowModal(true)
  }

  function handleMarkPaid(entryId: string) {
    if (!confirm('¿Marcar esta deuda como pagada?')) return
    startTransition(async () => {
      const result = await markCarteraPaid(entryId)
      if (result.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
        showToast('Deuda marcada como pagada')
      } else {
        showToast(result.error ?? 'Error')
      }
    })
  }

  function handleDelete(entryId: string) {
    if (!confirm('¿Eliminar esta entrada de cartera?')) return
    startTransition(async () => {
      const result = await deleteCarteraEntry(entryId)
      if (result.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
        showToast('Entrada eliminada')
      } else {
        showToast(result.error ?? 'Error')
      }
    })
  }

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Deuda total</p>
          <p className="text-2xl font-semibold text-slate-900">{formatCOP(totalDeuda)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Vencida +30 días</p>
          <p className="text-2xl font-semibold text-slate-900">{formatCOP(totalVencida30)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Pacientes en mora</p>
          <p className="text-2xl font-semibold text-slate-900">{countPacientes}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Cartera pendiente</h2>
            <p className="text-slate-400 text-xs mt-0.5">&quot;Cobrar WA&quot; envía recordatorio por WhatsApp</p>
          </div>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <span className="badge badge-amber">{entries.length} pendientes</span>
            )}
            <button onClick={handleOpenCreate} className="btn-primary text-xs py-1.5 px-3">
              + Agregar deuda
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">💰</p>
            <p className="text-slate-900 font-medium mb-1">Cartera al día</p>
            <p className="text-slate-500 text-sm">No hay deudas pendientes de cobro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Paciente</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Contacto</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Monto</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Vencida</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tipo pago</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tratamiento</th>
                  <th className="text-center py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Intentos</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <CarteraRowExtended
                    key={entry.id}
                    entry={entry}
                    onEdit={() => handleEdit(entry)}
                    onMarkPaid={() => handleMarkPaid(entry.id)}
                    onDelete={() => handleDelete(entry.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <CarteraFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        initialData={editData}
        onSaved={() => {
          showToast(editData ? 'Entrada actualizada' : 'Deuda agregada')
          // Full reload via revalidatePath
          window.location.reload()
        }}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
    </>
  )
}

// Extended CarteraRow with edit/paid/delete/cobrar buttons
function CarteraRowExtended({
  entry, onEdit, onMarkPaid, onDelete,
}: {
  entry: CarteraEntryWithDetails; onEdit: () => void; onMarkPaid: () => void; onDelete: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const isOverdue30 = entry.days_overdue > 30

  const PAYMENT_COLORS: Record<string, string> = {
    EPS: 'bg-blue-50 text-blue-700', Particular: 'bg-emerald-50 text-emerald-700',
    Póliza: 'bg-purple-50 text-purple-700', ARL: 'bg-amber-50 text-amber-700', SOAT: 'bg-yellow-50 text-yellow-700',
  }

  function handleCobrar() {
    startTransition(async () => {
      const result = await sendCollectionMessage(entry.id)
      if (result.ok) setSent(true)
    })
  }

  function handleCobrarEmail() {
    startTransition(async () => {
      const result = await sendCollectionEmail(entry.id)
      if (result.ok) setEmailSent(true)
    })
  }

  const tier = getCarteraPatientTier(entry)
  const hasEmail = !!entry.patient?.email

  return (
    <tr className={`border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors ${isOverdue30 ? 'bg-red-50/30' : ''}`}>
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{entry.patient?.name ?? '-'}</span>
          {tier && <PriorityBadge tier={tier} size="xs" />}
        </div>
      </td>
      <td className="py-3.5 px-5">
        <div className="text-slate-500 text-sm">
          {entry.patient?.phone?.replace('+57', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') ?? '-'}
        </div>
        {hasEmail && (
          <div className="text-slate-400 text-xs truncate max-w-[160px]" title={entry.patient.email!}>
            {entry.patient.email}
          </div>
        )}
      </td>
      <td className="py-3.5 px-5 text-right">
        <span className="text-sm font-semibold text-slate-900">{formatCOP(entry.amount)}</span>
      </td>
      <td className="py-3.5 px-5">
        <span className={`badge ${isOverdue30 ? 'badge-red' : 'badge-amber'}`}>{entry.days_overdue}d</span>
      </td>
      <td className="py-3.5 px-5">
        <span className={`badge ${PAYMENT_COLORS[entry.payment_type] ?? 'badge-slate'}`}>{entry.payment_type}</span>
      </td>
      <td className="py-3.5 px-5 text-slate-500 text-sm">{entry.treatment ?? '-'}</td>
      <td className="py-3.5 px-5 text-center text-slate-500 text-sm">{entry.collection_attempts}</td>
      <td className="py-3.5 px-5 text-right">
        <div className="flex gap-1 justify-end items-center">
          {sent ? (
            <span className="badge badge-green text-xs">WA</span>
          ) : (
            <button onClick={handleCobrar} disabled={isPending} className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium py-1 px-2 rounded-lg transition-colors whitespace-nowrap">
              {isPending ? '...' : 'WA'}
            </button>
          )}
          {hasEmail && (
            emailSent ? (
              <span className="badge badge-green text-xs">Email</span>
            ) : (
              <button onClick={handleCobrarEmail} disabled={isPending} className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium py-1 px-2 rounded-lg transition-colors whitespace-nowrap" title="Enviar cobro por email">
                {isPending ? '...' : 'Email'}
              </button>
            )
          )}
          <button onClick={onEdit} className="text-slate-400 hover:text-blue-600 p-1" title="Editar">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
          </button>
          <button onClick={onMarkPaid} className="text-slate-400 hover:text-emerald-600 p-1" title="Pagada">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
          <button onClick={onDelete} className="text-slate-400 hover:text-red-600 p-1" title="Eliminar">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          </button>
        </div>
      </td>
    </tr>
  )
}
