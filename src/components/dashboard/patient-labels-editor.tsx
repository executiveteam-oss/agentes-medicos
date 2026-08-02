'use client'

// Editor de etiquetas de PACIENTE: chips (con ✕) + popover para buscar/aplicar
// o crear inline (nombre + swatch). Reusable en el chat y el detalle de paciente.
// Gestionar (renombrar/archivar/eliminar) NO va acá — vive en el panel Equipo.

import { useState, useRef, useEffect } from 'react'
import { setPatientLabel, createClinicLabel } from '@/app/actions/patient-labels'
import {
  LABEL_COLOR_STYLES, LABEL_SWATCHES, resolveLabels, pickableLabels,
  type ClinicLabel, type LabelColor,
} from '@/lib/labels/patient-labels'

interface Props {
  patientId: string
  patientLabelIds: string[]
  catalog: ClinicLabel[]
  canWrite: boolean
}

export function PatientLabelsEditor({ patientId, patientLabelIds, catalog, canWrite }: Props) {
  const [ids, setIds] = useState(patientLabelIds)
  const [cat, setCat] = useState(catalog)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [newColor, setNewColor] = useState<LabelColor>('amber')
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (open && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const applied = resolveLabels(ids, cat)
  const pickable = pickableLabels(cat)
  const term = q.trim().toLowerCase()
  const filtered = term ? pickable.filter((l) => l.name.toLowerCase().includes(term)) : pickable
  const canCreate = !!term && !pickable.some((l) => l.name.toLowerCase() === term)

  async function toggle(labelId: string, on: boolean) {
    setBusy(true)
    const prev = ids
    setIds(on ? [...ids, labelId] : ids.filter((x) => x !== labelId))
    const r = await setPatientLabel(patientId, labelId, on)
    if (!r.ok) setIds(prev)
    setBusy(false)
  }
  async function create() {
    if (!canCreate) return
    setBusy(true)
    const r = await createClinicLabel(q.trim(), newColor)
    if (r.ok && r.label) { setCat([...cat, r.label]); setIds([...ids, r.label.id]); setQ('') }
    setBusy(false)
  }

  return (
    <div ref={boxRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', position: 'relative' }}>
      {applied.map((l) => {
        const c = LABEL_COLOR_STYLES[l.color]
        return (
          <span key={l.id} style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '5px', background: c.bg, color: c.fg, display: 'inline-flex', gap: '5px', alignItems: 'center', opacity: l.archived ? 0.6 : 1 }}>
            {l.name}
            {canWrite && <button onClick={() => toggle(l.id, false)} disabled={busy} title="Quitar" style={{ border: 'none', background: 'none', color: c.fg, cursor: 'pointer', padding: 0, fontSize: '11px', lineHeight: 1 }}>✕</button>}
          </span>
        )
      })}
      {applied.length === 0 && !canWrite && <span style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>Sin etiquetas</span>}

      {canWrite && (
        <>
          <button onClick={() => setOpen(!open)} style={{ fontSize: '10px', fontWeight: 700, color: 'var(--v2-text-muted)', border: '1px dashed var(--v2-border-strong)', borderRadius: '5px', padding: '2px 8px', cursor: 'pointer', background: 'none' }}>+ etiqueta</button>
          {open && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 30, width: '240px', background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border)', borderRadius: '10px', boxShadow: 'var(--v2-shadow-lg)', padding: '8px' }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar o crear…" className="input-v2" style={{ fontSize: '12px', padding: '6px 9px' }} />
              <div style={{ maxHeight: '160px', overflowY: 'auto', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {filtered.map((l) => {
                  const on = ids.includes(l.id); const c = LABEL_COLOR_STYLES[l.color]
                  return (
                    <button key={l.id} onClick={() => toggle(l.id, !on)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 7px', border: 'none', background: on ? 'var(--v2-bg-soft)' : 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', textAlign: 'left', fontFamily: 'inherit' }}>
                      <span style={{ width: '9px', height: '9px', borderRadius: '99px', background: c.fg, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      {on && <span style={{ color: 'var(--v2-primary)', fontWeight: 800 }}>✓</span>}
                    </button>
                  )
                })}
                {filtered.length === 0 && !canCreate && <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', padding: '6px' }}>Sin etiquetas todavía</p>}
              </div>
              {canCreate && (
                <div style={{ borderTop: '1px solid var(--v2-border-soft)', marginTop: '6px', paddingTop: '8px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '6px' }}>Crear <b style={{ color: 'var(--v2-text)' }}>&ldquo;{q.trim()}&rdquo;</b></p>
                  <div style={{ display: 'flex', gap: '5px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {LABEL_SWATCHES.map((sw) => (
                      <button key={sw} onClick={() => setNewColor(sw)} title={sw} style={{ width: '18px', height: '18px', borderRadius: '99px', background: LABEL_COLOR_STYLES[sw].fg, border: newColor === sw ? '2px solid var(--v2-text)' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                    ))}
                  </div>
                  <button onClick={create} disabled={busy} className="btn-v2-primary" style={{ fontSize: '12px', padding: '6px 12px', width: '100%' }}>Crear y aplicar</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
