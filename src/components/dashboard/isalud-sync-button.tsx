'use client'

// ============================================================
// iSalud Sync Button + Import Modal (v2)
// ============================================================

import { useState, useEffect } from 'react'
import { RefreshCw, Upload, X, Check, Loader2, Trash2 } from 'lucide-react'

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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (integration) {
    const lastSync = integration.last_synced_at
      ? new Date(integration.last_synced_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
      : 'Nunca'

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--v2-green)' }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--v2-green)' }} />
          </span>
          <span style={{ fontWeight: 600, color: 'var(--v2-text)' }}>iSalud</span>
          <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>Sync: {lastSync}</span>
        </div>
        <button
          onClick={async () => {
            setSyncing(true); setSyncMsg('')
            try {
              const res = await fetch('/api/sync/isalud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'force_sync' }) })
              const data = await res.json()
              setSyncMsg(`+${data.doctors_created ?? 0} docs, ${data.appointments_blocked ?? 0} bloqueadas`)
            } catch { setSyncMsg('Error') }
            setSyncing(false)
          }}
          disabled={syncing || deleting}
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: '8px',
            border: '1px solid var(--v2-border)',
            background: 'var(--v2-bg-soft)',
            color: 'var(--v2-text-muted)',
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sync...' : 'Sync'}
        </button>
        <button
          onClick={() => setShowModal(true)}
          disabled={deleting}
          style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Credenciales
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Trash2 size={12} />
          </button>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--v2-red)' }}>¿Seguro?</span>
            <button
              onClick={async () => {
                setDeleting(true)
                await fetch('/api/sync/isalud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete' }) })
                window.location.reload()
              }}
              style={{ fontSize: '11px', fontWeight: 700, color: 'var(--v2-red)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Si
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              No
            </button>
          </span>
        )}
        {syncMsg && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-green-deep)' }}>{syncMsg}</span>}
        {showModal && <ISaludImportModal onClose={() => setShowModal(false)} />}
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="btn-v2-secondary"
        style={{ fontSize: '13px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <Upload size={14} />
        Importar iSalud
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
      const testRes = await fetch('/api/sync/isalud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', credentials: { subdomain, username, password } }),
      })
      const testData = await testRes.json()
      if (!testData.ok) { setError(testData.error ?? 'No se pudo conectar'); setStep('error'); return }
      setProgress('Importando medicos y bloqueando citas...')
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

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(26, 21, 48, 0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--v2-bg-card)',
          borderRadius: 'var(--v2-radius-xl)',
          boxShadow: 'var(--v2-shadow-lg)',
          maxWidth: '480px',
          width: '100%',
          padding: '24px',
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: 'var(--font-manrope), sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--v2-text)' }}>Importar desde iSalud</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)' }}>
              Conecta tu cuenta de iSalud para importar medicos y bloquear citas existentes.
            </p>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Subdominio iSalud</label>
              <div style={{ display: 'flex' }}>
                <span style={{ fontSize: '13px', color: 'var(--v2-text-subtle)', background: 'var(--v2-bg-soft)', border: '1.5px solid var(--v2-border)', borderRight: 'none', borderRadius: 'var(--v2-radius) 0 0 var(--v2-radius)', padding: '10px 12px' }}>https://</span>
                <input className="input-v2" value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="algia" style={{ borderRadius: '0', borderLeft: 'none', borderRight: 'none', flex: 1 }} />
                <span style={{ fontSize: '13px', color: 'var(--v2-text-subtle)', background: 'var(--v2-bg-soft)', border: '1.5px solid var(--v2-border)', borderLeft: 'none', borderRadius: '0 var(--v2-radius) var(--v2-radius) 0', padding: '10px 12px' }}>.isalud.co</span>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Usuario</label>
              <input className="input-v2" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="off" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Contrasena</label>
              <input className="input-v2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && (
              <div style={{ padding: '10px 14px', background: 'var(--v2-red-soft)', border: '1px solid rgba(255,87,87,0.3)', borderRadius: 'var(--v2-radius)', fontSize: '13px', color: 'var(--v2-red)' }}>
                {error}
              </div>
            )}
            <button onClick={handleImport} className="btn-v2-primary" style={{ width: '100%' }}>Conectar e importar</button>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', textAlign: 'center' }}>Las credenciales se guardan encriptadas.</p>
          </div>
        )}

        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Loader2 size={32} className="animate-spin" style={{ color: 'var(--v2-primary)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)' }}>{progress}</p>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '8px' }}>No cierres esta ventana</p>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--v2-green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Check size={24} style={{ color: 'var(--v2-green)' }} />
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--v2-text)' }}>Importacion completa</h3>
            </div>
            <div style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--v2-text-muted)' }}>Medicos importados</span><span style={{ fontWeight: 700 }}>{result.doctors_created}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--v2-text-muted)' }}>Medicos existentes</span><span style={{ fontWeight: 700 }}>{result.doctors_existing}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--v2-text-muted)' }}>Citas bloqueadas (60 dias)</span><span style={{ fontWeight: 700 }}>{result.appointments_blocked}</span></div>
            </div>
            {result.errors.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'var(--v2-amber-soft)', borderRadius: 'var(--v2-radius)', fontSize: '12px', color: '#b07d00' }}>
                {result.errors.length} advertencias
              </div>
            )}
            <div style={{ padding: '10px 14px', background: 'var(--v2-primary-tint)', border: '1px solid var(--v2-primary-soft)', borderRadius: 'var(--v2-radius)', fontSize: '12px', color: 'var(--v2-primary)' }}>
              Sincronizacion automatica activada. Los slots de iSalud no apareceran como disponibles.
            </div>
            <button onClick={() => window.location.reload()} className="btn-v2-primary" style={{ width: '100%' }}>Cerrar</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '14px', background: 'var(--v2-red-soft)', border: '1px solid rgba(255,87,87,0.3)', borderRadius: 'var(--v2-radius)', fontSize: '13px', color: 'var(--v2-red)' }}>
              {error}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => { setStep('form'); setError('') }} className="btn-v2-secondary" style={{ flex: 1 }}>Reintentar</button>
              <button onClick={onClose} className="btn-v2-ghost" style={{ flex: 1 }}>Cerrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
