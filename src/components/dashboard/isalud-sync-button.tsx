'use client'

// ============================================================
// iSalud Sync Button + Import Modal
// Shows in Agenda page — import or sync status
// ============================================================

import { useState, useEffect } from 'react'

interface SyncIntegration {
  sync_status: string
  last_synced_at: string | null
  sync_error: string | null
}

interface ImportResult {
  doctors_created: number
  doctors_existing: number
  appointments_blocked: number
  errors: string[]
}

export function ISaludSyncButton({ integration }: { integration: SyncIntegration | null }) {
  const [showModal, setShowModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  if (integration) {
    // Already connected — show status + force sync button
    const lastSync = integration.last_synced_at
      ? new Date(integration.last_synced_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
      : 'Nunca'

    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-slate-600">iSalud</span>
          <span className="text-slate-400 text-xs">Sync: {lastSync}</span>
        </div>
        <button
          onClick={async () => {
            setSyncing(true)
            setSyncMsg('')
            try {
              const res = await fetch('/api/sync/isalud', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'force_sync' }),
              })
              const data = await res.json()
              setSyncMsg(`+${data.doctors_created ?? 0} docs, ${data.appointments_blocked ?? 0} bloqueadas`)
            } catch {
              setSyncMsg('Error sincronizando')
            }
            setSyncing(false)
          }}
          disabled={syncing}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : 'Forzar sync'}
        </button>
        {syncMsg && <span className="text-xs text-emerald-600">{syncMsg}</span>}
      </div>
    )
  }

  // No integration — show import button + modal
  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 bg-[#028090] hover:bg-[#026d7a] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Importar agenda desde iSalud
      </button>
      {showModal && <ISaludImportModal onClose={() => setShowModal(false)} />}
    </>
  )
}

function ISaludImportModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'form' | 'importing' | 'done' | 'error'>('form')
  const [subdomain, setSubdomain] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function handleImport() {
    if (!subdomain || !username || !password) {
      setError('Todos los campos son requeridos')
      return
    }

    setStep('importing')
    setProgress('Conectando con iSalud...')
    setError('')

    try {
      // Test connection first
      const testRes = await fetch('/api/sync/isalud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', credentials: { subdomain, username, password } }),
      })
      const testData = await testRes.json()
      if (!testData.ok) { setError(testData.error ?? 'No se pudo conectar'); setStep('error'); return }

      setProgress('Importando médicos y bloqueando citas (puede tomar unos minutos)...')

      const importRes = await fetch('/api/sync/isalud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', credentials: { subdomain, username, password } }),
      })
      const importData = await importRes.json() as ImportResult

      if (importData.errors.length > 0 && importData.appointments_blocked === 0 && importData.doctors_created === 0) {
        setError(importData.errors[0]); setStep('error'); return
      }

      setResult(importData)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado')
      setStep('error')
    }
  }

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-[480px] w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Importar desde iSalud</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {step === 'form' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Conecta tu cuenta de iSalud para importar médicos y bloquear citas existentes automáticamente.
            </p>

            <div>
              <label className="label">Subdominio iSalud</label>
              <div className="flex items-center gap-0">
                <span className="text-sm text-slate-400 bg-slate-50 border border-r-0 border-slate-200 rounded-l-lg px-3 py-2">https://</span>
                <input
                  type="text"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="input-field rounded-l-none border-l-0 flex-1"
                  placeholder="algia"
                />
                <span className="text-sm text-slate-400 bg-slate-50 border border-l-0 border-slate-200 rounded-r-lg px-3 py-2">.isalud.co</span>
              </div>
            </div>

            <div>
              <label className="label">Usuario de iSalud</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input-field" placeholder="admin" autoComplete="off" />
            </div>

            <div>
              <label className="label">Contraseña de iSalud</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" placeholder="••••••••" />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}

            <button onClick={handleImport} className="w-full btn-primary">
              Conectar e importar
            </button>

            <p className="text-xs text-slate-400 text-center">
              Las credenciales se guardan encriptadas y solo se usan para sincronizar la agenda.
            </p>
          </div>
        )}

        {step === 'importing' && (
          <div className="text-center py-8 space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#028090]/10 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-[#028090] animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <p className="text-sm text-slate-600">{progress}</p>
            <p className="text-xs text-slate-400">No cierres esta ventana</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">¡Importación completa!</h3>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Médicos importados</span><span className="font-semibold">{result.doctors_created}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Médicos existentes</span><span className="font-semibold">{result.doctors_existing}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Citas bloqueadas (60 días)</span><span className="font-semibold">{result.appointments_blocked}</span></div>
            </div>

            {result.errors.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
                {result.errors.length} advertencias
              </div>
            )}

            <div className="bg-[#028090]/5 border border-[#028090]/20 rounded-lg p-3 text-xs text-[#028090]">
              Sincronización automática activada. Los slots de iSalud no aparecerán como disponibles en el agente WhatsApp.
            </div>

            <button onClick={() => window.location.reload()} className="w-full btn-primary">
              Cerrar
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setStep('form'); setError('') }} className="btn-secondary flex-1">
                Intentar de nuevo
              </button>
              <button onClick={onClose} className="btn-secondary flex-1">
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
