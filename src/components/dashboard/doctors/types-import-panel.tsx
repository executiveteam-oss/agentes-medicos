'use client'

// ⏳ MIGRACIÓN ALGIA — código de un solo uso. NO es feature del producto Omuwan.
// Ver sección "MIGRACIÓN ALGIA" en CLAUDE.md antes de modificar o reusar.
// ============================================================
// TypesImportPanel — Modal doctor-first para importar consultation_types
// desde sugerencias derivadas de citas iSalud + catálogo completo.
//
// Tres niveles de UI (clarificados 2026-06-10):
//   L1 eapb_code  — badge gris informativo, NO bloquea (es regulatorio Res-256)
//   L2 insurer_type (EPS/Prepagada/Particular) — warning visible + counter,
//      NO bloquea creación (Lady completa después si quiere), pero se hace
//      muy visible para que no se pase por alto (lo necesita el agente)
//   L3 datos básicos (nombre, duración >= 5, precio >= 0) — SÍ bloquea
//      esa fila específica
// ============================================================

import { useState, useEffect, useMemo, useTransition } from 'react'
import { X, Check, AlertTriangle, Plus, Search, Filter } from 'lucide-react'
import {
  getSuggestionsForDoctor,
  confirmSuggestionsForDoctor,
  type SuggestionConfirmItem,
  type CatalogItem,
} from '@/app/actions/isalud-consulta-convenio'
import type {
  SuggestionCombo,
  DoctorSuggestions,
  DerivationOutput,
} from '@/lib/isalud/consulta-convenio-derivation'
import type { ConsultationType } from '@/types/database'

interface Props {
  doctorId: string
  doctorName: string
  existingConsultationTypes: ConsultationType[]
  onClose: () => void
  onCreated: (count: number) => void
}

type Step = 'loading' | 'ready' | 'confirming' | 'done' | 'error'
type InsurerType = 'EPS' | 'Prepagada' | 'Particular' | null

interface RowState {
  rowKey: string
  selected: boolean
  // Datos editables
  nombre: string
  duracion: number
  precio: number
  epsName: string | null
  insurerType: InsurerType
  // Metadata informativa
  source: 'suggested' | 'catalog'
  stagingProductId: string
  suggestedEapbCode: string | null
  citasCount: number          // 0 para catalog
  durationSource: 'derived' | 'default'
  citasWithDuration: number
  /**
   * Origen del precio sugerido. La UI marca con badge ámbar solo el caso 'fallback'
   * (el convenio no tenía tarifa propia en staging, se usó la de otro convenio).
   * 'convenio_match' = precio real del convenio (sin badge).
   * 'none' = sin tarifa (sin badge).
   */
  priceSource: 'convenio_match' | 'fallback' | 'none'
  // Conflict
  conflictsWithExisting: boolean
}

export function TypesImportPanel({
  doctorId,
  doctorName,
  existingConsultationTypes,
  onClose,
  onCreated,
}: Props): React.JSX.Element {
  const [step, setStep] = useState<Step>('loading')
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<DoctorSuggestions | null>(null)
  const [stats, setStats] = useState<DerivationOutput['stats'] | null>(null)
  const [unparseable, setUnparseable] = useState<DerivationOutput['unparseable'] | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [rows, setRows] = useState<Map<string, RowState>>(new Map())
  const [search, setSearch] = useState('')
  const [convenioFilter, setConvenioFilter] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [isPending, startTransition] = useTransition()

  // --- Carga inicial ---

  useEffect(() => {
    let mounted = true
    setStep('loading')
    getSuggestionsForDoctor(doctorId).then((res) => {
      if (!mounted) return
      if (!res.ok) {
        setError(res.error ?? 'Error al cargar sugerencias')
        setStep('error')
        return
      }
      setSuggestions(res.suggestions ?? null)
      setStats(res.stats ?? null)
      setUnparseable(res.unparseable ?? null)
      setCatalog(res.catalog ?? [])
      setRows(buildInitialRows(res.suggestions, existingConsultationTypes))
      setStep('ready')
    })
    return () => { mounted = false }
  }, [doctorId, existingConsultationTypes])

  // --- Derivados de estado ---

  const selectedRows = useMemo(() => Array.from(rows.values()).filter((r) => r.selected && !r.conflictsWithExisting), [rows])
  const selectedCount = selectedRows.length
  const unclassifiedCount = useMemo(
    () => selectedRows.filter((r) => r.epsName !== null && r.insurerType === null).length,
    [selectedRows],
  )
  const invalidCount = useMemo(
    () => selectedRows.filter((r) => !isRowDataValid(r)).length,
    [selectedRows],
  )

  // Filtrado del catálogo por search + filtro de convenio
  const catalogFiltered = useMemo(() => {
    const q = search.trim().toUpperCase()
    return catalog.filter((c) => {
      if (convenioFilter && c.convenioNombre.toUpperCase() !== convenioFilter.toUpperCase()) return false
      if (q && !c.productoNombre.toUpperCase().includes(q) && !c.convenioNombre.toUpperCase().includes(q)) return false
      return true
    })
  }, [catalog, search, convenioFilter])

  const convenioOptions = useMemo(() => {
    const set = new Set(catalog.map((c) => c.convenioNombre))
    return Array.from(set).sort()
  }, [catalog])

  // --- Handlers ---

  function updateRow(rowKey: string, patch: Partial<RowState>): void {
    setRows((prev) => {
      const next = new Map(prev)
      const cur = next.get(rowKey)
      if (cur) next.set(rowKey, { ...cur, ...patch })
      return next
    })
  }

  function addCatalogItemToSelection(item: CatalogItem): void {
    const rowKey = `cat:${item.id}`
    if (rows.has(rowKey)) {
      // Ya estaba — toggle select on
      updateRow(rowKey, { selected: true })
      return
    }
    const conflict = hasConflict(existingConsultationTypes, item.productoNombre, item.convenioNombre)
    const newRow: RowState = {
      rowKey,
      selected: !conflict,
      nombre: item.productoNombre,
      duracion: 30,
      precio: item.tarifa,
      epsName: item.convenioNombre,
      insurerType: null,
      source: 'catalog',
      stagingProductId: item.id,
      suggestedEapbCode: null,
      citasCount: 0,
      durationSource: 'default',
      citasWithDuration: 0,
      // Lady eligió específicamente este par procedimiento+convenio del catálogo,
      // por lo tanto el precio ES del convenio (no fallback). Tarifa 0 → 'none'.
      priceSource: item.tarifa > 0 ? 'convenio_match' : 'none',
      conflictsWithExisting: conflict,
    }
    setRows((prev) => {
      const next = new Map(prev)
      next.set(rowKey, newRow)
      return next
    })
  }

  function handleConfirm(): void {
    if (selectedCount === 0) return
    setStep('confirming')
    setError(null)
    const items: SuggestionConfirmItem[] = selectedRows.map((r) => ({
      productoId: r.stagingProductId,
      nombre: r.nombre.trim(),
      duracion: r.duracion,
      precio: r.precio,
      epsName: r.epsName,
      insurerType: r.insurerType,
    }))
    startTransition(async () => {
      const res = await confirmSuggestionsForDoctor(doctorId, items)
      if (!res.ok) {
        setError(res.error ?? 'Error al crear los tipos')
        setStep('ready')
        return
      }
      setCreatedCount(res.created ?? 0)
      setSkippedCount(res.skipped ?? 0)
      setStep('done')
      onCreated(res.created ?? 0)
    })
  }

  // --- Renders ---

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '24px',
      }}
    >
      <div style={{
        background: 'var(--v2-bg)', borderRadius: 'var(--v2-radius-lg)',
        maxWidth: '1100px', width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}>
        <Header doctorName={doctorName} onClose={onClose} stats={stats} step={step} />

        {step === 'loading' && <div style={padded}>Cargando sugerencias…</div>}
        {step === 'error' && <div style={{ ...padded, color: 'var(--v2-danger)' }}>❌ {error}</div>}

        {step === 'done' && (
          <DoneScreen
            created={createdCount}
            skipped={skippedCount}
            onClose={onClose}
          />
        )}

        {(step === 'ready' || step === 'confirming') && (
          <>
            <ClassificationBanner unclassifiedCount={unclassifiedCount} invalidCount={invalidCount} />

            <div style={{ overflow: 'auto', flex: 1, padding: '0 20px' }}>

              {/* === Sección sugerencias === */}
              {suggestions && suggestions.combinations.length > 0 && (
                <SuggestionsSection
                  doctorName={doctorName}
                  combinations={suggestions.combinations}
                  rows={rows}
                  updateRow={updateRow}
                  citasCount={stats?.totalCitasProcessed ?? 0}
                />
              )}

              {suggestions && suggestions.combinations.length === 0 && (
                <div style={{ padding: '24px 0', color: 'var(--v2-text-subtle)' }}>
                  Este médico no tiene citas iSalud con datos parseables. Agregá tipos desde el catálogo abajo.
                </div>
              )}

              {/* === Sección catálogo === */}
              <CatalogSection
                catalogOpen={catalogOpen}
                setCatalogOpen={setCatalogOpen}
                catalogFiltered={catalogFiltered}
                catalogTotal={catalog.length}
                convenioOptions={convenioOptions}
                search={search}
                setSearch={setSearch}
                convenioFilter={convenioFilter}
                setConvenioFilter={setConvenioFilter}
                rows={rows}
                addCatalogItem={addCatalogItemToSelection}
                updateRow={updateRow}
              />

              {/* === Info sobre validaciones pendientes === */}
              {unparseable && unparseable.convenios.length > 0 && (
                <div style={{
                  margin: '16px 0', padding: '12px 16px',
                  background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)',
                  fontSize: '12px', color: 'var(--v2-text-subtle)',
                }}>
                  <strong style={{ color: 'var(--v2-text)' }}>Convenios sin código EAPB en el catálogo:</strong>{' '}
                  {unparseable.convenios.join(', ')}. Estas sugerencias funcionan igual; el código EAPB es regulatorio
                  (Res-256) y se completa en una auditoría aparte.
                </div>
              )}
            </div>

            {error && (
              <div style={{ padding: '12px 20px', background: '#fee2e2', color: '#991b1b', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <Footer
              selectedCount={selectedCount}
              unclassifiedCount={unclassifiedCount}
              invalidCount={invalidCount}
              onCancel={onClose}
              onConfirm={handleConfirm}
              isPending={isPending}
            />
          </>
        )}
      </div>
    </div>
  )
}

// --- Sub-componentes ---

function Header({ doctorName, onClose, stats, step }: {
  doctorName: string; onClose: () => void; stats: DerivationOutput['stats'] | null; step: Step
}): React.JSX.Element {
  return (
    <div style={{
      padding: '16px 20px', borderBottom: '1px solid var(--v2-border-soft)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--v2-text)' }}>
          Importar tipos de consulta — {doctorName}
        </h2>
        {stats && step !== 'loading' && (
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--v2-text-subtle)' }}>
            Basado en {stats.totalCitasProcessed} citas iSalud · {stats.totalCombinations} combinaciones derivadas
          </p>
        )}
      </div>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
        <X size={20} color="var(--v2-text-subtle)" />
      </button>
    </div>
  )
}

function ClassificationBanner({ unclassifiedCount, invalidCount }: {
  unclassifiedCount: number; invalidCount: number
}): React.JSX.Element | null {
  if (unclassifiedCount === 0 && invalidCount === 0) return null
  return (
    <div style={{
      padding: '10px 20px', background: invalidCount > 0 ? '#fee2e2' : '#fef3c7',
      borderBottom: '1px solid var(--v2-border-soft)',
      display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px',
    }}>
      <AlertTriangle size={16} color={invalidCount > 0 ? '#991b1b' : '#92400e'} />
      <span style={{ color: invalidCount > 0 ? '#991b1b' : '#92400e' }}>
        {invalidCount > 0 && (
          <strong>{invalidCount} fila{invalidCount > 1 ? 's' : ''} con datos básicos inválidos (nombre, duración o precio).</strong>
        )}
        {invalidCount > 0 && unclassifiedCount > 0 && ' · '}
        {unclassifiedCount > 0 && (
          <>
            <strong>{unclassifiedCount} convenio{unclassifiedCount > 1 ? 's' : ''} sin clasificar</strong>{' '}
            (EPS o Prepagada) — Lady puede crear igual y completar después, pero el agente lo necesita.
          </>
        )}
      </span>
    </div>
  )
}

function Footer({ selectedCount, unclassifiedCount, invalidCount, onCancel, onConfirm, isPending }: {
  selectedCount: number; unclassifiedCount: number; invalidCount: number
  onCancel: () => void; onConfirm: () => void; isPending: boolean
}): React.JSX.Element {
  const disabled = isPending || selectedCount === 0 || invalidCount > 0
  return (
    <div style={{
      padding: '12px 20px', borderTop: '1px solid var(--v2-border-soft)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
    }}>
      <div style={{ fontSize: '13px', color: 'var(--v2-text-subtle)' }}>
        {selectedCount} fila{selectedCount === 1 ? '' : 's'} seleccionada{selectedCount === 1 ? '' : 's'}
        {unclassifiedCount > 0 && ` · ${unclassifiedCount} sin clasificar EPS/Prepagada`}
        {invalidCount > 0 && ` · ${invalidCount} con datos inválidos`}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onCancel} className="btn-v2-ghost" style={{ fontSize: '13px' }}>Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="btn-v2-primary"
          style={{ fontSize: '13px', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          {isPending ? 'Creando…' : `Crear ${selectedCount} tipo${selectedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

function DoneScreen({ created, skipped, onClose }: { created: number; skipped: number; onClose: () => void }): React.JSX.Element {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
      <h3 style={{ margin: 0, color: 'var(--v2-text)' }}>{created} tipo{created === 1 ? '' : 's'} creado{created === 1 ? '' : 's'}</h3>
      {skipped > 0 && (
        <p style={{ margin: '8px 0', fontSize: '13px', color: 'var(--v2-text-subtle)' }}>
          ({skipped} skipeado{skipped === 1 ? '' : 's'} por duplicado con tipos existentes)
        </p>
      )}
      <button onClick={onClose} className="btn-v2-primary" style={{ marginTop: '16px' }}>Cerrar</button>
    </div>
  )
}

function SuggestionsSection({ doctorName, combinations, rows, updateRow, citasCount }: {
  doctorName: string
  combinations: SuggestionCombo[]
  rows: Map<string, RowState>
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
  citasCount: number
}): React.JSX.Element {
  return (
    <div style={{ padding: '16px 0' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>
        Sugerencias derivadas ({combinations.length})
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--v2-text-subtle)' }}>
        Combinaciones que {doctorName} ya atendió en {citasCount} citas. Editá lo que quieras antes de confirmar.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {combinations.map((c) => {
          const rowKey = `sugg:${c.staging_product_id}:${c.convenio_canonical}`
          const r = rows.get(rowKey)
          if (!r) return null
          return <SuggestionRow key={rowKey} row={r} updateRow={updateRow} combo={c} />
        })}
      </div>
    </div>
  )
}

function SuggestionRow({ row, updateRow, combo }: {
  row: RowState
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
  combo: SuggestionCombo
}): React.JSX.Element {
  const isParticular = row.epsName?.toUpperCase() === 'PARTICULAR' || combo.convenio_eapb_type === 'Particular'
  const dataInvalid = !isRowDataValid(row)
  const unclassified = row.epsName !== null && !isParticular && row.insurerType === null && row.selected
  const conflict = row.conflictsWithExisting

  return (
    <div style={{
      padding: '10px 12px',
      background: conflict ? 'var(--v2-bg-deeper)' : (unclassified ? '#fefce8' : 'var(--v2-bg-soft)'),
      borderRadius: 'var(--v2-radius)',
      border: dataInvalid && row.selected ? '1px solid #991b1b' : '1px solid transparent',
      opacity: conflict ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          type="checkbox"
          checked={row.selected}
          disabled={conflict}
          onChange={(e) => updateRow(row.rowKey, { selected: e.target.checked })}
        />
        <input
          type="text"
          value={row.nombre}
          onChange={(e) => updateRow(row.rowKey, { nombre: e.target.value })}
          style={{ flex: 2, fontSize: '13px', padding: '4px 6px' }}
        />
        <ConvenioBlock row={row} updateRow={updateRow} combo={combo} />
        <DurationBlock row={row} updateRow={updateRow} />
        <PriceBlock row={row} updateRow={updateRow} />
      </div>
      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--v2-text-subtle)', display: 'flex', gap: '12px', flexWrap: 'wrap', paddingLeft: '24px' }}>
        {combo.citas_count > 0 && (
          <span>📊 {combo.citas_count} citas de fuente</span>
        )}
        {row.suggestedEapbCode && (
          <span title="Código EAPB sugerido (informativo, regulatorio Res-256)">
            🏷 EAPB: {row.suggestedEapbCode} <em>(por confirmar)</em>
          </span>
        )}
        {!row.suggestedEapbCode && row.epsName && !isParticular && (
          <span style={{ color: 'var(--v2-text-subtle)' }}>🏷 EAPB: por confirmar regulatoriamente</span>
        )}
        {conflict && <span style={{ color: '#991b1b' }}>⚠ ya existe</span>}
      </div>
    </div>
  )
}

function ConvenioBlock({ row, updateRow, combo }: {
  row: RowState
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
  combo?: SuggestionCombo
}): React.JSX.Element {
  const isParticular = row.epsName?.toUpperCase() === 'PARTICULAR' || combo?.convenio_eapb_type === 'Particular'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '210px' }}>
      <input
        type="text"
        value={row.epsName ?? ''}
        onChange={(e) => updateRow(row.rowKey, { epsName: e.target.value || null })}
        placeholder="Particular"
        disabled={isParticular}
        style={{ fontSize: '12px', padding: '3px 6px' }}
      />
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {(['EPS', 'Prepagada', 'Particular'] as const).map((t) => {
          const active = row.insurerType === t || (t === 'Particular' && isParticular)
          return (
            <button
              key={t}
              onClick={() => updateRow(row.rowKey, {
                insurerType: t,
                epsName: t === 'Particular' ? 'Particular' : row.epsName,
              })}
              style={{
                fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                border: 'none', cursor: 'pointer',
                fontWeight: active ? 700 : 500,
                background: active ? (t === 'EPS' ? '#dbeafe' : t === 'Prepagada' ? '#fef3c7' : 'var(--v2-bg-deeper)') : 'transparent',
                color: active ? (t === 'EPS' ? '#1e40af' : t === 'Prepagada' ? '#92400e' : 'var(--v2-text)') : 'var(--v2-text-subtle)',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DurationBlock({ row, updateRow }: {
  row: RowState
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: '90px' }}>
      <input
        type="number"
        value={row.duracion}
        min={5}
        max={480}
        onChange={(e) => updateRow(row.rowKey, { duracion: parseInt(e.target.value, 10) || 0 })}
        style={{ width: '70px', fontSize: '13px', padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--font-jetbrains), monospace' }}
      />
      <span style={{
        fontSize: '10px', marginTop: '2px',
        color: row.durationSource === 'derived' ? 'var(--v2-success)' : 'var(--v2-text-subtle)',
      }}>
        {row.durationSource === 'derived'
          ? `✓ derivada (${row.citasWithDuration} citas)`
          : `⚠ default (${row.citasCount > 0 ? row.citasCount : 0} citas)`}
      </span>
    </div>
  )
}

function PriceBlock({ row, updateRow }: {
  row: RowState
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
}): React.JSX.Element {
  // Solo marcar visualmente el caso fallback. Los precios reales del convenio
  // y los casos sin tarifa no requieren badge — minimalismo intencional para
  // que el ojo se enfoque solo en lo que requiere revisión.
  const showFallbackBadge = row.priceSource === 'fallback'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: '90px' }}>
      <input
        type="number"
        value={row.precio}
        min={0}
        onChange={(e) => updateRow(row.rowKey, { precio: parseInt(e.target.value, 10) || 0 })}
        style={{
          width: '90px', fontSize: '13px', padding: '4px 6px', textAlign: 'right',
          fontFamily: 'var(--font-jetbrains), monospace',
          // Borde sutil ámbar en el input cuando es fallback, refuerza el badge
          ...(showFallbackBadge ? { border: '1px solid #f5b500' } : {}),
        }}
      />
      {showFallbackBadge && (
        <span
          style={{
            fontSize: '10px', marginTop: '2px',
            color: '#b07d00',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          title="El convenio no tenía tarifa propia en el sistema. El precio mostrado viene de otro convenio. Confirmá la tarifa real con el contrato antes de crear el servicio."
        >
          ⚠ estimado — revisar
        </span>
      )}
    </div>
  )
}

function CatalogSection({
  catalogOpen, setCatalogOpen, catalogFiltered, catalogTotal, convenioOptions,
  search, setSearch, convenioFilter, setConvenioFilter, rows, addCatalogItem,
  updateRow,
}: {
  catalogOpen: boolean; setCatalogOpen: (v: boolean) => void
  catalogFiltered: CatalogItem[]; catalogTotal: number
  convenioOptions: string[]
  search: string; setSearch: (v: string) => void
  convenioFilter: string; setConvenioFilter: (v: string) => void
  rows: Map<string, RowState>
  addCatalogItem: (item: CatalogItem) => void
  updateRow: (rowKey: string, patch: Partial<RowState>) => void
}): React.JSX.Element {
  return (
    <div style={{ padding: '16px 0', borderTop: '1px solid var(--v2-border-soft)' }}>
      <button
        onClick={() => setCatalogOpen(!catalogOpen)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0',
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)',
        }}
      >
        <span style={{ transform: catalogOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        Agregar desde catálogo completo ({catalogTotal} productos disponibles)
      </button>
      {catalogOpen && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
              <input
                type="text"
                placeholder="Buscar procedimiento o convenio…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', fontSize: '13px', padding: '6px 8px 6px 28px' }}
              />
            </div>
            <div style={{ position: 'relative', minWidth: '180px' }}>
              <Filter size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
              <select
                value={convenioFilter}
                onChange={(e) => setConvenioFilter(e.target.value)}
                style={{ width: '100%', fontSize: '13px', padding: '6px 8px 6px 28px' }}
              >
                <option value="">Todos los convenios</option>
                {convenioOptions.map((c) => <option key={c} value={c}>{c.slice(0, 30)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>
            {catalogFiltered.length} resultados
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflow: 'auto' }}>
            {catalogFiltered.slice(0, 100).map((item) => {
              const rowKey = `cat:${item.id}`
              const rowExists = rows.has(rowKey)
              const row = rows.get(rowKey)
              return (
                <div key={item.id} style={{
                  padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '10px',
                  background: 'var(--v2-bg-soft)', borderRadius: '4px', fontSize: '12px',
                }}>
                  <span style={{ flex: 1 }}>{item.productoNombre.slice(0, 60)}</span>
                  <span style={{ color: 'var(--v2-text-subtle)', fontSize: '11px' }}>{item.convenioNombre.slice(0, 25)}</span>
                  <span style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>${item.tarifa.toLocaleString('es-CO')}</span>
                  {rowExists ? (
                    <button
                      onClick={() => row && updateRow(rowKey, { selected: !row.selected })}
                      style={{ fontSize: '11px', padding: '4px 8px', border: 'none', cursor: 'pointer' }}
                    >
                      {row?.selected ? <Check size={12} /> : 'Re-añadir'}
                    </button>
                  ) : (
                    <button
                      onClick={() => addCatalogItem(item)}
                      style={{
                        fontSize: '11px', padding: '4px 8px', border: '1px dashed var(--v2-border)', borderRadius: '4px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                      }}
                    >
                      <Plus size={12} /> Añadir
                    </button>
                  )}
                </div>
              )
            })}
            {catalogFiltered.length > 100 && (
              <div style={{ padding: '8px', textAlign: 'center', color: 'var(--v2-text-subtle)', fontSize: '11px' }}>
                Mostrando primeros 100 de {catalogFiltered.length}. Refiná la búsqueda para ver más.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Helpers ---

const padded = { padding: '24px' }

function buildInitialRows(
  suggs: DoctorSuggestions | null | undefined,
  existing: ConsultationType[],
): Map<string, RowState> {
  const map = new Map<string, RowState>()
  if (!suggs) return map
  for (const c of suggs.combinations) {
    if (!c.staging_product_id) continue
    const rowKey = `sugg:${c.staging_product_id}:${c.convenio_canonical}`
    const isParticular = c.convenio_eapb_type === 'Particular'
    const epsName = isParticular ? 'Particular' : c.convenio_canonical
    const conflict = hasConflict(existing, c.procedimiento_canonical, epsName)
    map.set(rowKey, {
      rowKey,
      selected: !conflict,
      nombre: c.procedimiento_canonical,
      duracion: c.duration_minutes,
      precio: c.suggested_price ?? 0,
      epsName,
      insurerType: isParticular ? 'Particular' : (c.convenio_eapb_type ?? null),
      source: 'suggested',
      stagingProductId: c.staging_product_id,
      suggestedEapbCode: c.convenio_eapb_code,
      citasCount: c.citas_count,
      durationSource: c.duration_source,
      citasWithDuration: c.citas_with_duration,
      priceSource: c.price_source,
      conflictsWithExisting: conflict,
    })
  }
  return map
}

function hasConflict(existing: ConsultationType[], nombre: string, epsName: string | null): boolean {
  const n = nombre.trim().toLowerCase()
  const epsNorm = epsName?.trim().toLowerCase() ?? null
  return existing.some((ct) => {
    const ctName = ct.name.trim().toLowerCase()
    const ctEps = ct.eps_name?.trim().toLowerCase() ?? null
    return ctName === n && ctEps === epsNorm
  })
}

function isRowDataValid(r: RowState): boolean {
  if (!r.nombre.trim()) return false
  if (!Number.isInteger(r.duracion) || r.duracion < 5 || r.duracion > 480) return false
  if (!Number.isInteger(r.precio) || r.precio < 0) return false
  return true
}
