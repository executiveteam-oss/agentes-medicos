'use client'
import { useState, useTransition, useMemo } from 'react'
import { applyRes256Suggestions, classifyRes256Category } from '@/app/actions/res256'
import { suggestRes256Category } from '@/lib/utils/res256-heuristics'
import type { Res256Category } from '@/types/database'

type Type = { id: string; name: string; doctor_id: string; res256_category: string | null; doctor: { name: string } | null }

export function BulkClassifyList({ types: initialTypes }: { types: Type[] }) {
  const [types, setTypes] = useState(initialTypes)
  const [onlyUnclassified, setOnlyUnclassified] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  const visible = useMemo(() => {
    return onlyUnclassified ? types.filter(t => !t.res256_category) : types
  }, [types, onlyUnclassified])

  const suggestionsByTypeId = useMemo(() => {
    const m = new Map<string, Res256Category | null>()
    for (const t of types) m.set(t.id, suggestRes256Category(t.name))
    return m
  }, [types])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAllWithSuggestion() {
    const next = new Set<string>()
    for (const t of visible) {
      if (suggestionsByTypeId.get(t.id) !== null) next.add(t.id)
    }
    setSelected(next)
  }

  function applyBatch() {
    const batch: Array<{ id: string; category: Res256Category | null }> = []
    for (const id of selected) {
      const s = suggestionsByTypeId.get(id)
      if (s !== undefined && s !== null) batch.push({ id, category: s })
    }
    if (batch.length === 0) { setToast('Nada para aplicar'); setTimeout(() => setToast(null), 2000); return }

    startTransition(async () => {
      const r = await applyRes256Suggestions(batch)
      if (r.ok) {
        setTypes(prev => prev.map(t => {
          const b = batch.find(x => x.id === t.id)
          return b ? { ...t, res256_category: b.category } : t
        }))
        setSelected(new Set())
        setToast(`✅ ${r.updated} clasificados`)
        setTimeout(() => setToast(null), 3000)
      } else {
        setToast(`❌ ${r.error ?? 'Error'}`)
        setTimeout(() => setToast(null), 3000)
      }
    })
  }

  function handleIndividualChange(id: string, value: string) {
    const cat = value === '' ? null : (value as Res256Category)
    startTransition(async () => {
      const r = await classifyRes256Category(id, cat)
      if (r.ok) {
        setTypes(prev => prev.map(t => t.id === id ? { ...t, res256_category: cat } : t))
      }
    })
  }

  const summary = {
    total: types.length,
    classified: types.filter(t => t.res256_category).length,
    unclassified: types.filter(t => !t.res256_category).length,
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 13 }}><strong>{summary.classified}</strong>/{summary.total} clasificados</span>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnclassified} onChange={(e) => setOnlyUnclassified(e.target.checked)} />
          {' '}Solo sin clasificar
        </label>
        <button onClick={selectAllWithSuggestion} className="btn-v2-secondary" style={{ fontSize: 12 }} disabled={isPending}>
          Seleccionar todos con sugerencia
        </button>
        <button onClick={applyBatch} className="btn-v2-primary" style={{ fontSize: 12 }} disabled={isPending || selected.size === 0}>
          Aplicar sugerencias seleccionadas ({selected.size})
        </button>
        {toast && <span style={{ fontSize: 12 }}>{toast}</span>}
      </div>

      <div style={{ border: '1px solid var(--v2-border-soft)', borderRadius: 12 }}>
        {visible.map(t => {
          const suggestion = suggestionsByTypeId.get(t.id)
          return (
            <div key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--v2-border-soft)', fontSize: 13 }}>
              {suggestion !== null && (
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
              )}
              {suggestion === null && <span style={{ width: 13, display: 'inline-block' }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--v2-text-subtle)' }}>{t.doctor?.name ?? '—'}</div>
              </div>
              {suggestion !== null && !t.res256_category && (
                <span style={{ fontSize: 11, color: 'var(--v2-text-subtle)' }}>Sugerencia: <strong>{suggestion}</strong></span>
              )}
              <select
                value={t.res256_category ?? ''}
                onChange={(e) => handleIndividualChange(t.id, e.target.value)}
                disabled={isPending}
                style={{ minWidth: 180, padding: 4, fontSize: 12 }}
              >
                <option value="">— Sin clasificar —</option>
                <option value="Ginecología">Ginecología</option>
                <option value="Obstetricia">Obstetricia</option>
                <option value="Ecografía">Ecografía</option>
                <option value="Resonancia Magnética">Resonancia Magnética</option>
                <option value="NoAplica">No aplica al reporte</option>
              </select>
            </div>
          )
        })}
        {visible.length === 0 && <div style={{ padding: 16, color: 'var(--v2-text-subtle)', fontSize: 13 }}>Nada para mostrar.</div>}
      </div>
    </div>
  )
}
