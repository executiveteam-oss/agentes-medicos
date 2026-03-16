'use client'

// ============================================================
// EsperaPanel — Panel interactivo de lista de espera con CRUD
// ============================================================

import { useState, useTransition } from 'react'
import { WaitlistFormModal } from '@/components/dashboard/waitlist-form-modal'
import { notifyWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry } from '@/app/actions/waitlist'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { WaitlistPriority } from '@/types/database'

interface WaitlistRow {
  id: string
  preferred_dates: string[]
  preferred_time: string
  reason: string | null
  priority: WaitlistPriority
  status: string
  notified_at: string | null
  created_at: string
  patients: { name: string; phone: string } | null
  doctors: { name: string } | null
}

interface Doctor {
  id: string
  name: string
  specialty: string | null
}

interface Props {
  entries: WaitlistRow[]
  doctors: Doctor[]
  esperando: number
  notificados: number
}

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  waiting: { label: 'Esperando', class: 'badge-amber' },
  notified: { label: 'Notificado', class: 'badge-blue' },
}

const TIME_LABELS: Record<string, string> = {
  morning: 'Mañana', afternoon: 'Tarde', any: 'Cualquier hora',
}

export function EsperaPanel({ entries: initialEntries, doctors, esperando, notificados }: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editReason, setEditReason] = useState('')
  const [editPriority, setEditPriority] = useState<WaitlistPriority>('normal')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleNotify(entryId: string) {
    startTransition(async () => {
      const result = await notifyWaitlistEntry(entryId)
      if (result.ok) {
        setEntries((prev) => prev.map((e) =>
          e.id === entryId ? { ...e, status: 'notified', notified_at: new Date().toISOString() } : e
        ))
        showToast('Paciente notificado por WhatsApp')
      } else {
        showToast(result.error ?? 'Error notificando')
      }
    })
  }

  function handleStartEdit(entry: WaitlistRow) {
    setEditingId(entry.id)
    setEditReason(entry.reason ?? '')
    setEditPriority((entry.priority as WaitlistPriority) ?? 'normal')
  }

  function handleSaveEdit(entryId: string) {
    startTransition(async () => {
      const result = await updateWaitlistEntry(entryId, { reason: editReason, priority: editPriority })
      if (result.ok) {
        setEntries((prev) => prev.map((e) =>
          e.id === entryId ? { ...e, reason: editReason, priority: editPriority } : e
        ))
        setEditingId(null)
        showToast('Entrada actualizada')
      } else {
        showToast(result.error ?? 'Error actualizando')
      }
    })
  }

  function handleRemove(entryId: string) {
    if (!confirm('¿Remover de la lista de espera?')) return
    startTransition(async () => {
      const result = await removeWaitlistEntry(entryId)
      if (result.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
        showToast('Removido de la lista')
      } else {
        showToast(result.error ?? 'Error removiendo')
      }
    })
  }

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Esperando</p>
          <p className="text-2xl font-semibold text-slate-900">{entries.filter((e) => e.status === 'waiting').length}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Notificados</p>
          <p className="text-2xl font-semibold text-slate-900">{entries.filter((e) => e.status === 'notified').length}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Pacientes en espera</h2>
            <p className="text-slate-400 text-xs mt-0.5">Notifica al paciente cuando haya un espacio disponible</p>
          </div>
          <div className="flex items-center gap-2">
            {entries.length > 0 && <span className="badge badge-amber">{entries.length} en lista</span>}
            <button onClick={() => setShowModal(true)} className="btn-primary text-xs py-1.5 px-3">
              + Agregar a lista
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-slate-900 font-medium mb-1">Lista de espera vacía</p>
            <p className="text-slate-500 text-sm">Cuando no haya disponibilidad, agrega pacientes aquí</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Paciente</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Doctor</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Motivo</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Prioridad</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Estado</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Desde</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const statusInfo = STATUS_LABELS[entry.status] ?? STATUS_LABELS.waiting
                  const isEditing = editingId === entry.id

                  return (
                    <tr key={entry.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-5">
                        <p className="text-sm font-medium text-slate-900">{entry.patients?.name ?? '-'}</p>
                        <p className="text-xs text-slate-400">
                          {entry.patients?.phone?.replace('+57', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') ?? ''}
                        </p>
                      </td>
                      <td className="py-3.5 px-5 text-slate-600 text-sm">{entry.doctors?.name ?? '-'}</td>
                      <td className="py-3.5 px-5 text-sm">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            className="input-field text-sm py-1 w-full"
                          />
                        ) : (
                          <span className="text-slate-600">{entry.reason ?? '-'}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-5">
                        {isEditing ? (
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as WaitlistPriority)}
                            className="input-field text-sm py-1"
                          >
                            <option value="normal">Normal</option>
                            <option value="urgente">Urgente</option>
                          </select>
                        ) : (
                          <span className={`badge ${entry.priority === 'urgente' ? 'badge-red' : 'badge-slate'}`}>
                            {entry.priority === 'urgente' ? 'Urgente' : 'Normal'}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                      </td>
                      <td className="py-3.5 px-5 text-slate-400 text-xs">
                        {format(new Date(entry.created_at), "d MMM", { locale: es })}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="flex gap-1 justify-end items-center">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(entry.id)}
                                disabled={isPending}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1"
                              >
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              {entry.status === 'waiting' && (
                                <button
                                  onClick={() => handleNotify(entry.id)}
                                  disabled={isPending}
                                  className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium py-1 px-2 rounded-lg transition-colors"
                                >
                                  Notificar
                                </button>
                              )}
                              <button onClick={() => handleStartEdit(entry)} className="text-slate-400 hover:text-blue-600 p-1" title="Editar">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                              </button>
                              <button onClick={() => handleRemove(entry.id)} className="text-slate-400 hover:text-red-600 p-1" title="Remover">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <WaitlistFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        doctors={doctors}
        onSaved={() => {
          showToast('Paciente agregado a la lista')
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
