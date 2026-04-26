'use client'

// ============================================================
// ReactivationBanner v2 — Frecuencia de visita + alerta inactividad
// ============================================================

import { useState, useTransition } from 'react'
import { sendManualReactivation } from '@/app/actions/reactivation'
import { AlertCircle, Check, Send } from 'lucide-react'

interface Props {
  patientId: string
  visitFrequencyDays: number | null
  daysSinceLastVisit: number | null
  frequencyLabel: string | null
}

export function ReactivationBanner({ patientId, visitFrequencyDays, daysSinceLastVisit, frequencyLabel }: Props) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOverdue = visitFrequencyDays && daysSinceLastVisit
    ? daysSinceLastVisit > visitFrequencyDays * 1.5
    : daysSinceLastVisit !== null && daysSinceLastVisit > 90

  function handleSend() {
    setError(null)
    startTransition(async () => {
      const result = await sendManualReactivation(patientId)
      if (result.ok) setSent(true)
      else setError(result.error ?? 'Error enviando mensaje')
    })
  }

  if (!isOverdue) {
    // Show frequency info card only (no alert)
    if (!frequencyLabel && daysSinceLastVisit === null) return null
    return (
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          padding: '16px 20px',
          fontFamily: 'var(--font-manrope), sans-serif',
        }}
      >
        <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>
          Frecuencia de visita
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', fontSize: '13px' }}>
          <InfoBlock label="Habitual" value={frequencyLabel ?? 'Sin datos'} />
          <InfoBlock label="Ultima visita" value={daysSinceLastVisit !== null ? `Hace ${daysSinceLastVisit} dias` : 'Sin visitas'} />
          {visitFrequencyDays && daysSinceLastVisit !== null && (
            <InfoBlock label="Proxima esperada" value={daysSinceLastVisit > visitFrequencyDays ? `Vencida hace ${daysSinceLastVisit - visitFrequencyDays}d` : `En ${visitFrequencyDays - daysSinceLastVisit}d`} valueColor={daysSinceLastVisit > visitFrequencyDays ? 'var(--v2-amber)' : undefined} />
          )}
        </div>
      </div>
    )
  }

  // Overdue alert
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '16px 20px',
        borderRadius: 'var(--v2-radius-lg)',
        background: 'var(--v2-amber-soft)',
        border: '1px solid rgba(255,184,69,0.3)',
        fontFamily: 'var(--font-manrope), sans-serif',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: 0 }}>
        <AlertCircle size={18} style={{ color: '#b07d00', flexShrink: 0, marginTop: '1px' }} />
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#b07d00' }}>
            Paciente inactivo
          </p>
          <p style={{ fontSize: '12px', color: '#b07d00', opacity: 0.8, marginTop: '2px' }}>
            Ultima visita hace {daysSinceLastVisit} dias.
            {frequencyLabel && ` Suele agendar ${frequencyLabel}.`}
          </p>
        </div>
      </div>

      {sent ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--v2-green-deep)', background: 'var(--v2-green-soft)', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>
          <Check size={14} /> Enviado
        </span>
      ) : (
        <button
          onClick={handleSend}
          disabled={isPending}
          className="btn-v2-primary"
          style={{ fontSize: '12px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, opacity: isPending ? 0.6 : 1 }}
        >
          <Send size={13} /> {isPending ? 'Enviando...' : 'Enviar recordatorio'}
        </button>
      )}
      {error && <p style={{ fontSize: '11px', color: 'var(--v2-red)', width: '100%' }}>{error}</p>}
    </div>
  )
}

function InfoBlock({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>{label}</p>
      <p style={{ fontSize: '13px', fontWeight: 600, color: valueColor ?? 'var(--v2-text)' }}>{value}</p>
    </div>
  )
}
