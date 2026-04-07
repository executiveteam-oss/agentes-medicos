'use client'

// ============================================================
// VacationDemandChart — Heatmap horizontal de demanda por semana
// Muestra 52 semanas con código de color (verde/ámbar/rojo)
// ============================================================

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import type { WeekDemand } from '@/app/actions/vacation'

const TIER_COLORS = {
  low: '#22c55e',   // green-500 — bueno para vacaciones
  mid: '#f59e0b',   // amber-500 — demanda normal
  high: '#ef4444',  // red-500 — evitar
}

export function VacationDemandChart({ data, overallAvg }: { data: WeekDemand[]; overallAvg: number }) {
  // Encontrar semana actual para línea de referencia
  const currentIdx = data.findIndex((w) => w.isCurrent)

  // Agrupar etiquetas: mostrar solo etiquetas de mes en cambios
  let lastLabel = ''
  const tickData = data.map((w) => {
    const show = w.label !== lastLabel
    lastLabel = w.label
    return { ...w, tickLabel: show ? w.label : '' }
  })

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={tickData} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="tickLabel"
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          label={{ value: 'Citas', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
        />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value) => [`${value} citas promedio`, 'Demanda']}
          labelFormatter={(_label, payload) => {
            if (payload?.[0]?.payload) {
              const w = payload[0].payload as WeekDemand
              return `Semana ${w.week} (${w.label})`
            }
            return ''
          }}
        />
        {/* Línea de promedio */}
        <ReferenceLine
          y={overallAvg}
          stroke="#94a3b8"
          strokeDasharray="5 5"
          strokeWidth={1.5}
          label={{ value: `Promedio: ${overallAvg}`, position: 'right', fill: '#94a3b8', fontSize: 11 }}
        />
        {/* Línea de semana actual */}
        {currentIdx >= 0 && (
          <ReferenceLine
            x={tickData[currentIdx].tickLabel || ''}
            stroke="#1e293b"
            strokeWidth={2}
            strokeDasharray="3 3"
            label={{ value: 'Hoy', position: 'top', fill: '#1e293b', fontSize: 11 }}
          />
        )}
        <Bar dataKey="avgAppointments" radius={[2, 2, 0, 0]} maxBarSize={12}>
          {tickData.map((entry, i) => (
            <Cell key={i} fill={TIER_COLORS[entry.tier]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
