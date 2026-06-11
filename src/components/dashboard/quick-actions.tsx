'use client'

// ============================================================
// QuickActions — Marcado de asistencia de cita
// Migración 00073: campo attendance_outcome (admitido/facturado/inasistente)
// Estados modelados según columna FASE del export iSalud
// ============================================================

import { useTransition } from 'react'
import {
  markAsAdmitido,
  markAsFacturado,
  markAsInasistente,
  revertAttendanceOutcome,
} from '@/app/actions/appointments'
import type { AppointmentStatus, AttendanceOutcome } from '@/types/database'
import { attendanceOutcomeLabel } from '@/lib/utils/attendance-outcome'

interface QuickActionsProps {
  appointmentId: string
  currentStatus: AppointmentStatus
  attendanceOutcome: AttendanceOutcome | null
}

export function QuickActions({ appointmentId, currentStatus, attendanceOutcome }: QuickActionsProps) {
  const [isPending, startTransition] = useTransition()

  // Si la cita está cancelada o bloqueo externo, no aplica marca de asistencia
  if (currentStatus === 'cancelled' || currentStatus === 'blocked_external') {
    return null
  }

  const stateLabel = attendanceOutcomeLabel(attendanceOutcome)
  const stateColor = colorFor(attendanceOutcome)

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--v2-border-soft)' }}>
      {/* Indicador del estado actual */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--v2-text-muted)', fontWeight: 600 }}>Estado</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: stateColor }}>{stateLabel}</span>
      </div>

      {/* 3 botones de marca */}
      <div style={{ display: 'flex', gap: 6 }}>
        <OutcomeButton
          label="Admitido"
          isActive={attendanceOutcome === 'admitido'}
          isDisabled={isPending}
          activeBg="#0EA5E9"
          onClick={() => startTransition(() => markAsAdmitido(appointmentId))}
        />
        <OutcomeButton
          label="Facturado"
          isActive={attendanceOutcome === 'facturado'}
          isDisabled={isPending}
          activeBg="#059669"
          onClick={() => startTransition(() => markAsFacturado(appointmentId))}
        />
        <OutcomeButton
          label="Inasistente"
          isActive={attendanceOutcome === 'inasistente'}
          isDisabled={isPending}
          activeBg="#DC2626"
          onClick={() => startTransition(() => markAsInasistente(appointmentId))}
        />
      </div>

      {/* Revertir solo si hay outcome marcado */}
      {attendanceOutcome !== null && (
        <button
          disabled={isPending}
          onClick={() => startTransition(() => revertAttendanceOutcome(appointmentId))}
          style={{
            marginTop: 6,
            width: '100%',
            background: 'transparent',
            color: 'var(--v2-text-muted)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            cursor: isPending ? 'wait' : 'pointer',
          }}
        >
          ↺ Revertir a Programado
        </button>
      )}
    </div>
  )
}

function OutcomeButton({
  label,
  isActive,
  isDisabled,
  activeBg,
  onClick,
}: {
  label: string
  isActive: boolean
  isDisabled: boolean
  activeBg: string
  onClick: () => void
}) {
  return (
    <button
      disabled={isDisabled}
      onClick={onClick}
      style={{
        flex: 1,
        background: isActive ? activeBg : 'transparent',
        color: isActive ? '#fff' : 'var(--v2-text)',
        border: `1px solid ${isActive ? activeBg : 'var(--v2-border-soft)'}`,
        borderRadius: 8,
        padding: '8px 6px',
        fontSize: 11,
        fontWeight: 600,
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'wait' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function colorFor(o: AttendanceOutcome | null): string {
  switch (o) {
    case 'admitido': return '#0EA5E9'
    case 'facturado': return '#059669'
    case 'inasistente': return '#DC2626'
    case null: return 'var(--v2-text-muted)'
  }
}
