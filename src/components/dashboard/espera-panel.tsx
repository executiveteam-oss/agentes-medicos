'use client'

// ============================================================
// EsperaPanel — Panel interactivo de lista de espera con CRUD
// Incluye: priority scoring, sorting, move up/down, demand peak
// ============================================================

import { useState, useTransition, useMemo } from 'react'
import { WaitlistFormModal } from '@/components/dashboard/waitlist-form-modal'
import { notifyWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry, confirmManualBooking, discardManualRequest } from '@/app/actions/waitlist'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { PriorityBadge } from '@/components/dashboard/priority-badge'
import type { WaitlistPriority } from '@/types/database'
import type { PriorityScore } from '@/app/actions/priority'
import Link from 'next/link'

interface WaitlistRow {
  id: string
  patient_id: string
  preferred_dates: string[]
  preferred_time: string
  reason: string | null
  priority: WaitlistPriority
  status: string
  notified_at: string | null
  created_at: string
  source: string
  preferred_schedule_notes: string | null
  consultation_type_name: string | null
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
  manualEntries: WaitlistRow[]
  doctors: Doctor[]
  esperando: number
  notificados: number
  priorityScores: Record<string, PriorityScore>
  availableSlotsThisWeek: number
  waitlistCount: number
}

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  waiting: { label: 'Esperando', class: 'badge-amber' },
  notified: { label: 'Notificado', class: 'badge-blue' },
}

type TabKey = 'espera' | 'manual'

export function EsperaPanel({
  entries: initialEntries,
  manualEntries: initialManual,
  doctors,
  esperando,
  notificados,
  priorityScores,
  availableSlotsThisWeek,
  waitlistCount,
}: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [manualEntries, setManualEntries] = useState(initialManual)
  const [activeTab, setActiveTab] = useState<TabKey>(initialManual.length > 0 ? 'manual' : 'espera')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editReason, setEditReason] = useState('')
  const [editPriority, setEditPriority] = useState<WaitlistPriority>('normal')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Manual booking state
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmDate, setConfirmDate] = useState('')
  const [confirmTime, setConfirmTime] = useState('')
  const [discardingId, setDiscardingId] = useState<string | null>(null)
  const [discardReason, setDiscardReason] = useState('')
  // Manual override order
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)

  // Sorted entries: by priority score desc (with manual override)
  const sortedEntries = useMemo(() => {
    if (orderOverride) {
      // Manual order: map IDs to entries
      const entryMap = new Map(entries.map((e) => [e.id, e]))
      const ordered: WaitlistRow[] = []
      for (const id of orderOverride) {
        const e = entryMap.get(id)
        if (e) ordered.push(e)
      }
      // Add any missing entries at the end
      for (const e of entries) {
        if (!orderOverride.includes(e.id)) ordered.push(e)
      }
      return ordered
    }
    // Default: sort by score descending
    return [...entries].sort((a, b) => {
      const scoreA = priorityScores[a.patient_id]?.score ?? 0
      const scoreB = priorityScores[b.patient_id]?.score ?? 0
      return scoreB - scoreA
    })
  }, [entries, priorityScores, orderOverride])

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
        if (orderOverride) setOrderOverride((prev) => prev?.filter((id) => id !== entryId) ?? null)
        showToast('Removido de la lista')
      } else {
        showToast(result.error ?? 'Error removiendo')
      }
    })
  }

  function handleMove(entryId: string, direction: 'up' | 'down') {
    const currentOrder = orderOverride ?? sortedEntries.map((e) => e.id)
    const idx = currentOrder.indexOf(entryId)
    if (idx < 0) return
    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    if (newIdx < 0 || newIdx >= currentOrder.length) return
    const newOrder = [...currentOrder]
    ;[newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]]
    setOrderOverride(newOrder)
  }

  function handleConfirmBooking(entryId: string) {
    if (!confirmDate || !confirmTime) {
      showToast('Selecciona fecha y hora')
      return
    }
    const startsAt = `${confirmDate}T${confirmTime}:00-05:00`
    startTransition(async () => {
      const result = await confirmManualBooking(entryId, startsAt)
      if (result.ok) {
        setManualEntries((prev) => prev.filter((e) => e.id !== entryId))
        setConfirmingId(null)
        setConfirmDate('')
        setConfirmTime('')
        showToast('Cita confirmada y paciente notificado')
      } else {
        showToast(result.error ?? 'Error confirmando cita')
      }
    })
  }

  function handleDiscard(entryId: string) {
    if (!discardReason.trim()) {
      showToast('Indica un motivo para descartar')
      return
    }
    startTransition(async () => {
      const result = await discardManualRequest(entryId, discardReason.trim())
      if (result.ok) {
        setManualEntries((prev) => prev.filter((e) => e.id !== entryId))
        setDiscardingId(null)
        setDiscardReason('')
        showToast('Solicitud descartada')
      } else {
        showToast(result.error ?? 'Error descartando')
      }
    })
  }

  const showDemandPeak = waitlistCount > availableSlotsThisWeek && waitlistCount > 0

  return (
    <>
      {/* Demand peak indicator */}
      {showDemandPeak && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800">
            📈 Tienes <span className="font-semibold">{waitlistCount}</span> paciente{waitlistCount !== 1 ? 's' : ''} en espera y solo <span className="font-semibold">{availableSlotsThisWeek}</span> slot{availableSlotsThisWeek !== 1 ? 's' : ''} disponible{availableSlotsThisWeek !== 1 ? 's' : ''} esta semana. ¿Quieres agregar turnos extra?
          </p>
          <Link
            href="/dashboard"
            className="text-xs font-medium text-amber-700 hover:text-amber-800 bg-white border border-amber-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Ver disponibilidad
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('espera')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'espera'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Lista de espera
          {entries.length > 0 && (
            <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{entries.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'manual'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Solicitudes de cita manual
          {manualEntries.length > 0 && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{manualEntries.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'espera' ? (
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
            <p className="text-slate-400 text-xs mt-0.5">Ordenados por prioridad · notifica al paciente cuando haya un espacio</p>
          </div>
          <div className="flex items-center gap-2">
            {orderOverride && (
              <button
                onClick={() => setOrderOverride(null)}
                className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
              >
                Restablecer orden
              </button>
            )}
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
                  <th className="w-8 py-3 px-2"></th>
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
                {sortedEntries.map((entry, idx) => {
                  const statusInfo = STATUS_LABELS[entry.status] ?? STATUS_LABELS.waiting
                  const isEditing = editingId === entry.id
                  const ps = priorityScores[entry.patient_id]

                  return (
                    <tr key={entry.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                      {/* Move up/down */}
                      <td className="py-3.5 px-2">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            onClick={() => handleMove(entry.id, 'up')}
                            disabled={idx === 0}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                            title="Mover arriba"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                          </button>
                          <button
                            onClick={() => handleMove(entry.id, 'down')}
                            disabled={idx === sortedEntries.length - 1}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                            title="Mover abajo"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                          </button>
                        </div>
                      </td>
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
                          ps ? (
                            <PriorityBadge tier={ps.tier} score={ps.score} showScore />
                          ) : (
                            <span className={`badge ${entry.priority === 'urgente' ? 'badge-red' : 'badge-slate'}`}>
                              {entry.priority === 'urgente' ? 'Urgente' : 'Normal'}
                            </span>
                          )
                        )}
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                        {entry.status === 'notified' && entry.notified_at && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {format(new Date(entry.notified_at), "d MMM, h:mm a", { locale: es })}
                          </p>
                        )}
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

      </>
      ) : (
      <>
      {/* Manual Requests Section */}
      <div className="grid grid-cols-1 gap-4">
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Solicitudes pendientes</p>
          <p className="text-2xl font-semibold text-slate-900">{manualEntries.length}</p>
          <p className="text-xs text-slate-400 mt-1">Pacientes que solicitaron cita con médicos sin horario fijo</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Solicitudes de cita manual</h2>
          <p className="text-slate-400 text-xs mt-0.5">Pacientes que pidieron cita vía WhatsApp con médicos de disponibilidad manual</p>
        </div>

        {manualEntries.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-slate-900 font-medium mb-1">No hay solicitudes pendientes</p>
            <p className="text-slate-500 text-sm">Las solicitudes de cita con médicos de disponibilidad manual aparecerán aquí</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {manualEntries.map((entry) => {
              const ps = priorityScores[entry.patient_id]
              return (
              <div key={entry.id} className="p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  {/* Info del paciente */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-900">{entry.patients?.name ?? 'Sin nombre'}</p>
                      <span className="badge badge-blue text-xs">WhatsApp</span>
                      {ps && <PriorityBadge tier={ps.tier} score={ps.score} showScore size="xs" />}
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      {entry.patients?.phone?.replace('+57', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') ?? ''}
                    </p>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      <div>
                        <span className="text-slate-400 text-xs">Doctor:</span>
                        <span className="ml-1 text-slate-700">{entry.doctors?.name ?? '-'}</span>
                      </div>
                      {entry.consultation_type_name && (
                        <div>
                          <span className="text-slate-400 text-xs">Servicio:</span>
                          <span className="ml-1 text-slate-700">{entry.consultation_type_name}</span>
                        </div>
                      )}
                      {entry.preferred_schedule_notes && (
                        <div className="col-span-2">
                          <span className="text-slate-400 text-xs">Preferencia horario:</span>
                          <span className="ml-1 text-slate-700">{entry.preferred_schedule_notes}</span>
                        </div>
                      )}
                      {entry.reason && (
                        <div className="col-span-2">
                          <span className="text-slate-400 text-xs">Motivo:</span>
                          <span className="ml-1 text-slate-700">{entry.reason}</span>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 mt-2">
                      Solicitado {format(new Date(entry.created_at), "d MMM, h:mm a", { locale: es })}
                    </p>
                  </div>

                  {/* Acciones */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {confirmingId === entry.id ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 w-56">
                        <p className="text-xs font-medium text-slate-700">Confirmar cita</p>
                        <input
                          type="date"
                          value={confirmDate}
                          onChange={(e) => setConfirmDate(e.target.value)}
                          className="input-field text-sm py-1 w-full"
                        />
                        <input
                          type="time"
                          value={confirmTime}
                          onChange={(e) => setConfirmTime(e.target.value)}
                          className="input-field text-sm py-1 w-full"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleConfirmBooking(entry.id)}
                            disabled={isPending}
                            className="btn-primary text-xs py-1 px-2 flex-1 disabled:opacity-50"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => { setConfirmingId(null); setConfirmDate(''); setConfirmTime('') }}
                            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : discardingId === entry.id ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 w-56">
                        <p className="text-xs font-medium text-slate-700">Motivo para descartar</p>
                        <input
                          type="text"
                          value={discardReason}
                          onChange={(e) => setDiscardReason(e.target.value)}
                          placeholder="Ej: No hay disponibilidad"
                          className="input-field text-sm py-1 w-full"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDiscard(entry.id)}
                            disabled={isPending}
                            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium py-1 px-2 rounded-lg flex-1"
                          >
                            Descartar
                          </button>
                          <button
                            onClick={() => { setDiscardingId(null); setDiscardReason('') }}
                            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setConfirmingId(entry.id)}
                          className="btn-primary text-xs py-1.5 px-3"
                        >
                          ✅ Confirmar cita
                        </button>
                        <a
                          href={`https://wa.me/${entry.patients?.phone?.replace('+', '') ?? ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg text-center transition-colors"
                        >
                          💬 Contactar
                        </a>
                        <button
                          onClick={() => setDiscardingId(entry.id)}
                          className="text-xs text-slate-400 hover:text-red-600 py-1.5 px-3 transition-colors"
                        >
                          Descartar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
      </>
      )}

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
