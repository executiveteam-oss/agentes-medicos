'use client'
import { RefreshCw } from 'lucide-react'
export default function PatientsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-xl)', boxShadow: 'var(--v2-shadow)', padding: '48px 40px', textAlign: 'center', maxWidth: '420px', width: '100%', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>👥</p>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>No se pudieron cargar los pacientes</h2>
        <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)', lineHeight: 1.5, marginBottom: '24px' }}>Recarga la página o inténtalo de nuevo.</p>
        <button onClick={reset} className="btn-v2-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={16} /> Reintentar</button>
      </div>
    </div>
  )
}
