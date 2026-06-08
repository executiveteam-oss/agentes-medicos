'use client'
import { useState } from 'react'

function defaultSemestreActual(): { from: string; to: string } {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  if (m <= 6) return { from: `${y}-01-01`, to: `${y}-06-30` }
  return { from: `${y}-07-01`, to: `${y}-12-31` }
}

export function Res256DownloadForm() {
  const d = defaultSemestreActual()
  const [fromDate, setFromDate] = useState(d.from)
  const [toDate, setToDate] = useState(d.to)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ ready: number; incomplete: number } | null>(null)

  async function handleDownload() {
    setBusy(true); setErr(null); setSummary(null)
    try {
      const res = await fetch(`/api/reports/resolucion-256?from=${fromDate}&to=${toDate}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Error desconocido' }))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const ready = Number(res.headers.get('X-Res256-Ready') ?? '0')
      const incomplete = Number(res.headers.get('X-Res256-Incomplete') ?? '0')
      setSummary({ ready, incomplete })

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `oportunidad-256-${fromDate}-a-${toDate}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--v2-border-soft)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Desde</label>
          <input type="date" className="input-v2" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Hasta</label>
          <input type="date" className="input-v2" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <button onClick={handleDownload} disabled={busy} className="btn-v2-primary" style={{ marginTop: 16, width: '100%' }}>
        {busy ? 'Generando...' : 'Descargar Excel'}
      </button>

      {err && <div style={{ marginTop: 12, color: '#991b1b', fontSize: 13 }}>{err}</div>}
      {summary && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div>✅ Listas para PISIS: <strong>{summary.ready}</strong></div>
          {summary.incomplete > 0 && (
            <div style={{ color: '#92400e' }}>
              ⚠️ Incompletas: <strong>{summary.incomplete}</strong> (revisar pestaña &quot;Incompletas&quot; en el xlsx)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
