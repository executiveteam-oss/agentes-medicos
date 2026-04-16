'use client'

// ============================================================
// ImportIsaludPanel — UI de 4 estados:
// - initial: pantalla con botón "Importar"
// - importing: spinner mientras corre el agente
// - selection: tabla agrupada por convenio con checkbox + edit + médico
// - confirmed: éxito con conteo de tipos creados
// ============================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  getStagingProducts,
  confirmImport,
  cancelImport,
  type StagingDataResponse,
  type ConfirmItem,
} from '@/app/actions/isalud-convenios'

type Step = 'initial' | 'importing' | 'selection' | 'confirmed' | 'error'

interface SelectionState {
  selected: boolean
  doctorId: string
  nombre: string
  duracion: number
  precio: number
}

interface Props {
  hasIsalud: boolean
  initialStagingData: StagingDataResponse | null
}

export function ImportIsaludPanel({ hasIsalud, initialStagingData }: Props) {
  // Si ya hay staging cargado, arrancamos directo en selección
  const [step, setStep] = useState<Step>(initialStagingData && initialStagingData.totalProducts > 0 ? 'selection' : 'initial')
  const [data, setData] = useState<StagingDataResponse | null>(initialStagingData)
  const [selection, setSelection] = useState<Record<string, SelectionState>>(() => buildInitialSelection(initialStagingData))
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Conectando con iSalud...')
  const [confirmResult, setConfirmResult] = useState<{ created: number; skipped: number } | null>(null)
  const [onlyAgendable, setOnlyAgendable] = useState(false)
  const [isPending, startTransition] = useTransition()

  function buildInitialSelection(d: StagingDataResponse | null): Record<string, SelectionState> {
    if (!d) return {}
    const sel: Record<string, SelectionState> = {}
    for (const g of d.groups) {
      for (const p of g.productos) {
        sel[p.id] = {
          selected: false,
          doctorId: '',
          nombre: p.producto_nombre,
          duracion: p.duracion_minutos ?? 30,
          precio: p.tarifa,
        }
      }
    }
    return sel
  }

  async function handleStartImport() {
    setStep('importing')
    setProgress('Conectando con iSalud y trayendo convenios — puede tomar 1-2 minutos...')
    setError(null)
    try {
      const res = await fetch('/api/isalud/convenios', { method: 'POST' })
      const result = await res.json() as { ok: boolean; convenios?: number; productos?: number; errors?: string[]; error?: string }
      if (!result.ok) {
        setError(result.error ?? (result.errors && result.errors[0]) ?? 'No se pudo importar')
        setStep('error')
        return
      }
      // Cargar staging
      const fresh = await getStagingProducts()
      if (fresh.totalProducts === 0) {
        setError(
          (result.errors && result.errors.length > 0 ? result.errors[0] : null)
          ?? 'iSalud no devolvió productos. Verifica que tengas convenios con productos activos.'
        )
        setStep('error')
        return
      }
      setData(fresh)
      setSelection(buildInitialSelection(fresh))
      setStep('selection')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
      setStep('error')
    }
  }

  function toggleProduct(id: string) {
    setSelection((prev) => ({
      ...prev,
      [id]: { ...prev[id], selected: !prev[id].selected },
    }))
  }

  function updateField(id: string, field: keyof SelectionState, value: string | number | boolean) {
    setSelection((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function selectAllInGroup(productIds: string[], select: boolean) {
    setSelection((prev) => {
      const next = { ...prev }
      for (const id of productIds) {
        next[id] = { ...next[id], selected: select }
      }
      return next
    })
  }

  function handleConfirm() {
    setError(null)
    const items: ConfirmItem[] = []
    for (const [productoId, s] of Object.entries(selection)) {
      if (!s.selected) continue
      if (!s.doctorId) {
        setError(`"${s.nombre}" no tiene médico asignado`)
        return
      }
      items.push({
        productoId,
        doctorId: s.doctorId,
        nombre: s.nombre.trim(),
        duracion: s.duracion,
        precio: s.precio,
      })
    }

    if (items.length === 0) {
      setError('Selecciona al menos un producto e indica su médico')
      return
    }

    startTransition(async () => {
      const result = await confirmImport(items)
      if (result.ok) {
        setConfirmResult({ created: result.created ?? 0, skipped: result.skipped ?? 0 })
        setStep('confirmed')
      } else {
        setError(result.error ?? 'Error al confirmar')
      }
    })
  }

  function handleCancel() {
    startTransition(async () => {
      await cancelImport()
      setData(null)
      setSelection({})
      setStep('initial')
      setError(null)
    })
  }

  // ---------- Render por estado ----------

  if (step === 'initial') {
    return <InitialState hasIsalud={hasIsalud} onStart={handleStartImport} />
  }

  if (step === 'importing') {
    return <ImportingState progress={progress} />
  }

  if (step === 'error') {
    return (
      <ErrorState
        error={error ?? 'Error desconocido'}
        onRetry={() => { setError(null); setStep('initial') }}
      />
    )
  }

  if (step === 'confirmed' && confirmResult) {
    return <ConfirmedState created={confirmResult.created} skipped={confirmResult.skipped} />
  }

  // step === 'selection'
  if (!data) return null
  const selectedCount = Object.values(selection).filter((s) => s.selected).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Selecciona productos a importar</h2>
            <p className="text-sm text-slate-500 mt-1">
              Marca los procedimientos que quieras activar en Omuwan, asigna un médico, y ajusta precio o duración si es necesario.
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
          >
            Descartar y volver
          </button>
        </div>
        <div className="flex items-center gap-4 mt-4">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyAgendable}
              onChange={(e) => setOnlyAgendable(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo agendables web
          </label>
          <p className="text-xs text-slate-500 ml-auto">
            <strong className="text-slate-900">{selectedCount}</strong> de <strong>{data.totalProducts}</strong> seleccionados
          </p>
        </div>
      </div>

      {data.doctors.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-900 font-medium">No tienes médicos registrados</p>
          <p className="text-xs text-amber-700 mt-1">
            Agrega al menos un médico antes de importar productos.
            <Link href="/dashboard/whatsapp#doctores" className="underline ml-1">Ir a Médicos</Link>
          </p>
        </div>
      )}

      {/* Tabla agrupada por convenio */}
      {data.groups.map((group) => {
        const filtered = onlyAgendable ? group.productos.filter((p) => p.agendable_web) : group.productos
        if (filtered.length === 0) return null
        const groupAllSelected = filtered.every((p) => selection[p.id]?.selected)
        return (
          <div key={`${group.convenio_nit}|${group.convenio_nombre}`} className="card overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{group.convenio_nombre}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {group.convenio_nit && <>NIT: {group.convenio_nit}</>}
                  {group.convenio_nombre_abreviado && group.convenio_nit && ' · '}
                  {group.convenio_nombre_abreviado}
                  {' · '}
                  {filtered.length} productos
                </p>
              </div>
              <button
                type="button"
                onClick={() => selectAllInGroup(filtered.map((p) => p.id), !groupAllSelected)}
                className="text-xs text-blue-700 hover:text-blue-800 font-medium"
              >
                {groupAllSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const s = selection[p.id]
                if (!s) return null
                return (
                  <div key={p.id} className="px-5 py-3 grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-1 flex justify-center">
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() => toggleProduct(p.id)}
                        className="rounded border-slate-300"
                      />
                    </div>
                    <div className="col-span-4">
                      <input
                        type="text"
                        value={s.nombre}
                        onChange={(e) => updateField(p.id, 'nombre', e.target.value)}
                        className="input-field text-xs py-1 w-full"
                        disabled={!s.selected}
                      />
                      <div className="flex items-center gap-2 mt-1">
                        {p.agendable_web && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5">Agendable web</span>
                        )}
                        {p.opcion_detalle && p.opcion_detalle !== 'Tarifa' && (
                          <span className="text-[10px] text-slate-400">{p.opcion_detalle}</span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={s.doctorId}
                        onChange={(e) => updateField(p.id, 'doctorId', e.target.value)}
                        disabled={!s.selected || data.doctors.length === 0}
                        className="input-field text-xs py-1 w-full"
                      >
                        <option value="">Médico...</option>
                        {data.doctors.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={5}
                          max={240}
                          value={s.duracion}
                          onChange={(e) => updateField(p.id, 'duracion', Number(e.target.value) || 30)}
                          disabled={!s.selected}
                          className="input-field text-xs py-1 w-16"
                        />
                        <span className="text-[10px] text-slate-400">min</span>
                      </div>
                    </div>
                    <div className="col-span-3">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-slate-400">$</span>
                        <input
                          type="number"
                          min={0}
                          value={s.precio}
                          onChange={(e) => updateField(p.id, 'precio', Number(e.target.value) || 0)}
                          disabled={!s.selected}
                          className="input-field text-xs py-1 w-full"
                        />
                        <span className="text-[10px] text-slate-400">COP</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Footer fijo con botón confirmar */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 -mx-6 lg:-mx-8 px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{selectedCount}</strong> productos serán importados como tipos de consulta
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending || selectedCount === 0}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-5 rounded-lg transition-colors"
          >
            {isPending ? 'Importando...' : `Confirmar e importar ${selectedCount > 0 ? `(${selectedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Estados auxiliares
// ============================================================

function InitialState({ hasIsalud, onStart }: { hasIsalud: boolean; onStart: () => void }) {
  return (
    <div className="card p-8 text-center max-w-2xl mx-auto">
      <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">📥</span>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Importar tipos de consulta desde iSalud</h2>
      <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
        Trae automáticamente todos los procedimientos y tarifas configurados en iSalud. Solo selecciona cuáles quieres activar y a qué médico asignarlos.
      </p>

      {!hasIsalud ? (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
          <p className="text-sm font-medium text-amber-900">Conecta iSalud primero</p>
          <p className="text-xs text-amber-700 mt-1">
            Necesitas conectar tu cuenta de iSalud antes de poder importar convenios. Hazlo desde la Agenda.
          </p>
          <Link
            href="/dashboard"
            className="inline-block mt-3 text-xs font-medium text-amber-900 underline hover:text-amber-950"
          >
            Ir al Dashboard →
          </Link>
        </div>
      ) : (
        <button
          onClick={onStart}
          className="mt-6 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium py-2.5 px-5 rounded-lg transition-colors"
        >
          Importar desde iSalud
        </button>
      )}

      <p className="text-[10px] text-slate-400 mt-6 max-w-sm mx-auto">
        Los productos importados se convierten en tipos de consulta normales — puedes editarlos después en cualquier momento.
      </p>
    </div>
  )
}

function ImportingState({ progress }: { progress: string }) {
  return (
    <div className="card p-12 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-blue-700 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
      <p className="text-sm text-slate-700 font-medium">{progress}</p>
      <p className="text-xs text-slate-400 mt-2">No cierres esta ventana</p>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="card p-8 max-w-md mx-auto text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="text-base font-semibold text-slate-900">No se pudo importar</h3>
      <p className="text-sm text-slate-500 mt-2 break-words">{error}</p>
      <button
        onClick={onRetry}
        className="mt-5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        Volver
      </button>
    </div>
  )
}

function ConfirmedState({ created, skipped }: { created: number; skipped: number }) {
  return (
    <div className="card p-8 max-w-md mx-auto text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">¡Importación completa!</h2>
      <div className="mt-4 bg-slate-50 rounded-lg p-4 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Tipos de consulta creados</span><span className="font-semibold">{created}</span></div>
        {skipped > 0 && (
          <div className="flex justify-between"><span className="text-slate-500">Omitidos (ya existían)</span><span className="font-semibold">{skipped}</span></div>
        )}
      </div>
      <Link
        href="/dashboard/whatsapp#doctores"
        className="mt-5 inline-block bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        Ver tipos de consulta
      </Link>
    </div>
  )
}
