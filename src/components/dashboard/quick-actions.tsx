'use client'

// ============================================================
// QuickActions — Botones de acción rápida para cada cita
// Marca como "Completada" o "No-show" desde el dashboard
// ============================================================

import { useTransition } from 'react'
import { markAppointmentCompleted, markAppointmentNoShow } from '@/app/actions/appointments'
import type { AppointmentStatus } from '@/types/database'

interface QuickActionsProps {
  appointmentId: string
  currentStatus: AppointmentStatus
}

export function QuickActions({ appointmentId, currentStatus }: QuickActionsProps) {
  const [isPending, startTransition] = useTransition()

  if (currentStatus === 'completed' || currentStatus === 'no_show' || currentStatus === 'cancelled') {
    return null
  }

  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
      <button
        disabled={isPending}
        onClick={() => startTransition(() => markAppointmentCompleted(appointmentId))}
        className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors"
      >
        {isPending ? '...' : 'Asistió'}
      </button>
      <button
        disabled={isPending}
        onClick={() => startTransition(() => markAppointmentNoShow(appointmentId))}
        className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors"
      >
        {isPending ? '...' : 'No se presentó'}
      </button>
    </div>
  )
}
