'use client'

// Filtro por etiqueta de paciente. Chips que setean ?label= en la URL.
// Reusable en la bandeja de conversaciones y en la lista de pacientes.

import { useRouter, useSearchParams } from 'next/navigation'
import { LABEL_COLOR_STYLES, pickableLabels, type ClinicLabel } from '@/lib/labels/patient-labels'

export function LabelFilter({ catalog, basePath }: { catalog: ClinicLabel[]; basePath: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const active = sp.get('label')
  const pickable = pickableLabels(catalog)
  if (pickable.length === 0) return null

  function go(id: string | null) {
    const p = new URLSearchParams(sp.toString())
    if (id) p.set('label', id); else p.delete('label')
    p.delete('page')
    router.push(`${basePath}?${p.toString()}`)
  }

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>🏷</span>
      <button
        onClick={() => go(null)}
        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '99px', cursor: 'pointer', border: 'none', background: active ? 'var(--v2-bg-soft)' : 'var(--v2-primary-soft)', color: active ? 'var(--v2-text-muted)' : 'var(--v2-primary)', fontFamily: 'inherit' }}
      >Todas</button>
      {pickable.map((l) => {
        const c = LABEL_COLOR_STYLES[l.color]; const on = active === l.id
        return (
          <button key={l.id} onClick={() => go(on ? null : l.id)} style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '99px', cursor: 'pointer', background: c.bg, color: c.fg, border: on ? `2px solid ${c.fg}` : '2px solid transparent', fontFamily: 'inherit' }}>
            {l.name}
          </button>
        )
      })}
    </div>
  )
}
