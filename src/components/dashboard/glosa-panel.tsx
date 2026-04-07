'use client'

// ============================================================
// GlosaPanel — EPS Risk Dashboard + Glosas activas
// ============================================================

import { useState, useTransition } from 'react'
import {
  registrarGlosa,
  responderGlosa,
  resolverGlosa,
} from '@/app/actions/glosas'
import { GLOSA_REASONS } from '@/lib/utils/glosa-reasons'
import type { EpsRiskRow, GlosaEntry } from '@/app/actions/glosas'
import type { GlosaStatus } from '@/types/database'

// ---------- Helpers ----------

function formatCOP(amount: number): string {
  return '$' + new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
}

function todayStr(): string {
  const d = new Date()
  const col = new Date(d.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  return `${col.getFullYear()}-${String(col.getMonth() + 1).padStart(2, '0')}-${String(col.getDate()).padStart(2, '0')}`
}

const RISK_BADGE: Record<string, { label: string; class: string }> = {
  low: { label: 'Confiable', class: 'badge-green' },
  mid: { label: 'Moderado', class: 'badge-amber' },
  high: { label: 'Alto riesgo', class: 'badge-red' },
}

const GLOSA_STATUS_LABELS: Record<GlosaStatus, { label: string; class: string }> = {
  none: { label: '-', class: 'badge-slate' },
  pending: { label: 'Pendiente respuesta', class: 'badge-amber' },
  responded: { label: 'Respondida', class: 'badge-blue' },
  lifted: { label: 'Levantada', class: 'badge-green' },
  definitive: { label: 'Definitiva', class: 'badge-red' },
}

// ---------- Props ----------

interface Props {
  epsRisk: EpsRiskRow[]
  activeGlosas: GlosaEntry[]
  urgentCount: number
  // Para el flujo de "cambiar a glosada" desde facturación
  pendingGlosaAppointmentId?: string | null
}

// ---------- Main Component ----------

export function GlosaPanel({ epsRisk, activeGlosas: initialGlosas, urgentCount, pendingGlosaAppointmentId }: Props) {
  const [activeTab, setActiveTab] = useState<'eps' | 'glosas'>(pendingGlosaAppointmentId ? 'glosas' : 'eps')
  const [glosas, setGlosas] = useState(initialGlosas)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  // Form states
  const [showRegisterForm, setShowRegisterForm] = useState<string | null>(pendingGlosaAppointmentId ?? null)
  const [showResponseForm, setShowResponseForm] = useState<string | null>(null)
  const [showResolveForm, setShowResolveForm] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Urgent alert */}
      {urgentCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <span className="text-lg">⚠️</span>
          <p className="text-sm font-medium text-red-800">
            Tienes {urgentCount} glosa{urgentCount !== 1 ? 's' : ''} que vence{urgentCount !== 1 ? 'n' : ''} esta semana
          </p>
        </div>
      )}

      {/* Tab selector */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('eps')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'eps' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          EPS Dashboard
        </button>
        <button
          onClick={() => setActiveTab('glosas')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'glosas' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Glosas activas
          {glosas.length > 0 && (
            <span className="ml-1.5 badge badge-red text-[10px]">{glosas.length}</span>
          )}
        </button>
      </div>

      {/* ==================== EPS TAB ==================== */}
      {activeTab === 'eps' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Riesgo por EPS</h2>
            <p className="text-xs text-slate-400 mt-0.5">Basado en historial de últimos 12 meses</p>
          </div>

          {epsRisk.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-slate-500 text-sm">No hay facturas EPS registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">EPS</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Radicadas este mes</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Valor radicado</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tasa glosas</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Días prom. pago</th>
                    <th className="text-center py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Riesgo</th>
                  </tr>
                </thead>
                <tbody>
                  {epsRisk.map((eps) => {
                    const badge = RISK_BADGE[eps.risk]
                    return (
                      <tr key={eps.epsName} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-5 text-sm font-medium text-slate-900">{eps.epsName}</td>
                        <td className="py-3 px-5 text-sm text-slate-600 text-right">{eps.invoicedCount}</td>
                        <td className="py-3 px-5 text-sm font-semibold text-slate-900 text-right">{formatCOP(eps.invoicedTotal)}</td>
                        <td className="py-3 px-5 text-right">
                          <span className={`text-sm font-semibold ${eps.glosaRate > 25 ? 'text-red-600' : eps.glosaRate > 10 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {eps.glosaRate}%
                          </span>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <span className={`text-sm ${eps.avgPaymentDays > 60 ? 'text-red-600 font-semibold' : eps.avgPaymentDays > 45 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {eps.avgPaymentDays}d
                          </span>
                        </td>
                        <td className="py-3 px-5 text-center">
                          <span className={`badge ${badge.class}`}>{badge.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== GLOSAS TAB ==================== */}
      {activeTab === 'glosas' && (
        <div className="space-y-4">
          {glosas.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-slate-900 font-medium">Sin glosas activas</p>
              <p className="text-slate-500 text-sm">No hay glosas pendientes de respuesta</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Glosas activas</h2>
                <p className="text-xs text-slate-400 mt-0.5">{glosas.length} glosa{glosas.length !== 1 ? 's' : ''} pendiente{glosas.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {glosas.map((g) => {
                  const statusInfo = GLOSA_STATUS_LABELS[g.glosaStatus]
                  const isUrgent = g.diasRestantes !== null && g.diasRestantes <= 3 && g.glosaStatus === 'pending'
                  const isOverdue = g.diasRestantes !== null && g.diasRestantes < 0

                  return (
                    <div key={g.id}>
                      <div className={`px-5 py-4 ${isUrgent || isOverdue ? 'bg-red-50/50' : ''}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-slate-900">{g.invoiceNumber}</span>
                              <span className="badge badge-blue">{g.epsName}</span>
                              <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                            </div>
                            <p className="text-xs text-slate-500">{g.patientName}</p>
                            {g.glosaReason && (
                              <p className="text-xs text-slate-400 mt-0.5">Motivo: {g.glosaReason}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-red-600">{formatCOP(g.glosaValue)}</p>
                            {g.diasRestantes !== null && (
                              <p className={`text-xs mt-0.5 font-medium ${
                                isOverdue ? 'text-red-600' : isUrgent ? 'text-red-600' : 'text-slate-400'
                              }`}>
                                {isOverdue
                                  ? `Venció hace ${Math.abs(g.diasRestantes)} día${Math.abs(g.diasRestantes) !== 1 ? 's' : ''} hábiles`
                                  : `${g.diasRestantes} día${g.diasRestantes !== 1 ? 's' : ''} hábiles restantes`}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 mt-3">
                          {g.glosaStatus === 'pending' && (
                            <>
                              <button
                                onClick={() => setShowResponseForm(showResponseForm === g.id ? null : g.id)}
                                className="btn-primary text-xs py-1 px-3"
                              >
                                Registrar respuesta
                              </button>
                              <button
                                onClick={() => setShowResolveForm(showResolveForm === g.id ? null : g.id)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1"
                              >
                                Resolver
                              </button>
                            </>
                          )}
                          {g.glosaStatus === 'responded' && (
                            <button
                              onClick={() => setShowResolveForm(showResolveForm === g.id ? null : g.id)}
                              className="btn-primary text-xs py-1 px-3"
                            >
                              Resolver glosa
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Response form */}
                      {showResponseForm === g.id && (
                        <ResponseForm
                          appointmentId={g.id}
                          isPending={isPending}
                          onSubmit={(notes, date) => {
                            startTransition(async () => {
                              const result = await responderGlosa({ appointmentId: g.id, notes, responseDate: date })
                              if (result.ok) {
                                setGlosas((prev) => prev.map((gl) => gl.id === g.id ? { ...gl, glosaStatus: 'responded' as GlosaStatus, glosaResponseDate: date, glosaNotes: notes } : gl))
                                setShowResponseForm(null)
                                showToast('Respuesta registrada')
                              }
                            })
                          }}
                          onCancel={() => setShowResponseForm(null)}
                        />
                      )}

                      {/* Resolve form */}
                      {showResolveForm === g.id && (
                        <ResolveForm
                          isPending={isPending}
                          onSubmit={(resolution, notes) => {
                            startTransition(async () => {
                              const result = await resolverGlosa({ appointmentId: g.id, resolution, notes })
                              if (result.ok) {
                                setGlosas((prev) => prev.filter((gl) => gl.id !== g.id))
                                setShowResolveForm(null)
                                showToast(resolution === 'lifted' ? 'Glosa levantada' : 'Glosa marcada como definitiva')
                              }
                            })
                          }}
                          onCancel={() => setShowResolveForm(null)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Register glosa form (from pendingGlosaAppointmentId) */}
          {showRegisterForm && !glosas.find((g) => g.id === showRegisterForm) && (
            <RegisterGlosaForm
              appointmentId={showRegisterForm}
              isPending={isPending}
              onSubmit={(data) => {
                startTransition(async () => {
                  const result = await registrarGlosa(data)
                  if (result.ok) {
                    showToast('Glosa registrada')
                    setShowRegisterForm(null)
                    window.location.reload()
                  }
                })
              }}
              onCancel={() => setShowRegisterForm(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Sub-forms
// ============================================================

function RegisterGlosaForm({
  appointmentId,
  isPending,
  onSubmit,
  onCancel,
}: {
  appointmentId: string
  isPending: boolean
  onSubmit: (data: { appointmentId: string; reason: string; customReason?: string; amount: number; notificationDate: string }) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState<string>(GLOSA_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [amount, setAmount] = useState(0)
  const [notifDate, setNotifDate] = useState(todayStr())

  return (
    <div className="card p-5 border-amber-200 bg-amber-50/30">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">Registrar glosa</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Motivo de glosa</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input-field text-sm w-full"
          >
            {GLOSA_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {reason === 'Otro' && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Especifique el motivo"
              className="input-field text-sm w-full mt-2"
            />
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Valor glosado (COP)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            className="input-field text-sm w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha notificación</label>
          <input
            type="date"
            value={notifDate}
            onChange={(e) => setNotifDate(e.target.value)}
            className="input-field text-sm w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Plazo respuesta</label>
          <p className="text-sm text-amber-700 font-medium mt-1">15 días hábiles desde notificación</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => onSubmit({ appointmentId, reason, customReason, amount, notificationDate: notifDate })}
          disabled={isPending || amount <= 0}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {isPending ? 'Registrando...' : 'Registrar glosa'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function ResponseForm({
  appointmentId,
  isPending,
  onSubmit,
  onCancel,
}: {
  appointmentId: string
  isPending: boolean
  onSubmit: (notes: string, date: string) => void
  onCancel: () => void
}) {
  const [notes, setNotes] = useState('')
  const [responseDate, setResponseDate] = useState(todayStr())

  return (
    <div className="px-5 py-4 bg-blue-50/50 border-t border-blue-100">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Argumentos / notas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input-field text-sm w-full resize-none"
            placeholder="Describa los argumentos de respuesta a la glosa..."
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha de respuesta</label>
          <input
            type="date"
            value={responseDate}
            onChange={(e) => setResponseDate(e.target.value)}
            className="input-field text-sm w-full"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onSubmit(notes, responseDate)}
          disabled={isPending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {isPending ? 'Guardando...' : 'Registrar respuesta'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function ResolveForm({
  isPending,
  onSubmit,
  onCancel,
}: {
  isPending: boolean
  onSubmit: (resolution: 'lifted' | 'definitive', notes: string) => void
  onCancel: () => void
}) {
  const [resolution, setResolution] = useState<'lifted' | 'definitive'>('lifted')
  const [notes, setNotes] = useState('')

  return (
    <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Resolución</label>
          <div className="flex gap-3 mt-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={resolution === 'lifted'}
                onChange={() => setResolution('lifted')}
                className="accent-emerald-600"
              />
              <span className="text-sm text-slate-700">Levantada (a favor)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={resolution === 'definitive'}
                onChange={() => setResolution('definitive')}
                className="accent-red-600"
              />
              <span className="text-sm text-slate-700">Definitiva (pérdida)</span>
            </label>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas de resolución"
            className="input-field text-sm w-full"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onSubmit(resolution, notes)}
          disabled={isPending}
          className={`text-sm font-medium py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50 ${
            resolution === 'lifted'
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {isPending ? 'Guardando...' : resolution === 'lifted' ? 'Marcar levantada' : 'Marcar definitiva'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
          Cancelar
        </button>
      </div>
    </div>
  )
}
