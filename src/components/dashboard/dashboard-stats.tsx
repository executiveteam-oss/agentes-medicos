'use client'

// ============================================================
// DashboardStats — Tarjetas de estadísticas con actualización
// en tiempo real via Supabase Realtime en tabla appointments
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  initialTodayCount: number
  initialCompletedToday: number
  dailyGoal: number
  noShowRate: number
  clinicId: string
  todayDateStr: string // yyyy-MM-dd
}

function getColombiaDateStr(iso: string): string {
  const d = new Date(iso)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return `${col.getUTCFullYear()}-${String(col.getUTCMonth() + 1).padStart(2, '0')}-${String(col.getUTCDate()).padStart(2, '0')}`
}

export function DashboardStats({
  initialTodayCount,
  initialCompletedToday,
  dailyGoal,
  noShowRate,
  clinicId,
  todayDateStr,
}: Props) {
  const [todayCount, setTodayCount] = useState(initialTodayCount)
  const [completedToday, setCompletedToday] = useState(initialCompletedToday)

  // Sincronizar si el server recarga
  const prevCount = useRef(initialTodayCount)
  const prevCompleted = useRef(initialCompletedToday)
  useEffect(() => {
    if (prevCount.current !== initialTodayCount) {
      setTodayCount(initialTodayCount)
      prevCount.current = initialTodayCount
    }
    if (prevCompleted.current !== initialCompletedToday) {
      setCompletedToday(initialCompletedToday)
      prevCompleted.current = initialCompletedToday
    }
  }, [initialTodayCount, initialCompletedToday])

  const handleChange = useCallback((payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }) => {
    const { eventType } = payload

    if (eventType === 'INSERT') {
      const apt = payload.new
      const startsAt = apt.starts_at as string
      if (!startsAt) return

      const aptDate = getColombiaDateStr(startsAt)
      const status = apt.status as string

      if (aptDate === todayDateStr && status !== 'cancelled') {
        setTodayCount((c) => c + 1)
        if (status === 'completed') {
          setCompletedToday((c) => c + 1)
        }
      }
    }

    if (eventType === 'UPDATE') {
      const newApt = payload.new
      const oldApt = payload.old
      const startsAt = (newApt.starts_at ?? oldApt.starts_at) as string
      if (!startsAt) return

      const aptDate = getColombiaDateStr(startsAt)
      if (aptDate !== todayDateStr) return

      const newStatus = newApt.status as string
      const oldStatus = oldApt.status as string

      // Cita cancelada → restar del total de hoy
      if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
        setTodayCount((c) => Math.max(0, c - 1))
      }
      // Cita restaurada de cancelada
      if (oldStatus === 'cancelled' && newStatus !== 'cancelled') {
        setTodayCount((c) => c + 1)
      }
      // Completada → sumar
      if (newStatus === 'completed' && oldStatus !== 'completed') {
        setCompletedToday((c) => c + 1)
      }
      // Des-completada (raro pero posible)
      if (oldStatus === 'completed' && newStatus !== 'completed') {
        setCompletedToday((c) => Math.max(0, c - 1))
      }
    }
  }, [todayDateStr])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const channel = supabase
      .channel('dashboard-stats-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `clinic_id=eq.${clinicId}`,
        },
        handleChange
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clinicId, handleChange])

  const goalPercent = Math.min(Math.round((completedToday / dailyGoal) * 100), 100)

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="card p-5 col-span-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Punto de equilibrio</p>
          <span className="text-slate-900 font-semibold text-sm">{completedToday} / {dailyGoal}</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              goalPercent >= 100 ? 'bg-emerald-500' : goalPercent >= 60 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${goalPercent}%` }}
          />
        </div>
        <p className="text-slate-400 text-xs mt-2">{goalPercent}% de la meta diaria</p>
      </div>
      <div className="card p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Citas hoy</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">{todayCount}</p>
      </div>
      <div className="card p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Tasa no-show</p>
        <p className={`text-2xl font-semibold mt-1 ${noShowRate > 20 ? 'text-red-600' : 'text-emerald-600'}`}>{noShowRate}%</p>
      </div>
    </div>
  )
}
