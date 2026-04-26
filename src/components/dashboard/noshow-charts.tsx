'use client'

// ============================================================
// NoShowCharts v2 — Grafico de no-shows por dia de la semana
// ============================================================

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface DayData {
  dia: string
  noShows: number
  completadas: number
  tasa: number
}

interface NoShowChartsProps {
  data: DayData[]
}

export function NoShowCharts({ data }: NoShowChartsProps) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '240px' }}>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-subtle)' }}>No hay suficientes datos</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E4F4" vertical={false} />
        <XAxis
          dataKey="dia"
          stroke="#9590A8"
          tick={{ fontSize: 12, fill: '#6B6580' }}
          axisLine={{ stroke: '#E8E4F4' }}
          tickLine={false}
        />
        <YAxis
          stroke="#9590A8"
          tick={{ fontSize: 12, fill: '#6B6580' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #E8E4F4',
            color: '#1A1530',
            borderRadius: '12px',
            fontSize: '12px',
            fontFamily: 'var(--font-manrope), sans-serif',
            boxShadow: '0 8px 24px rgba(107, 91, 255, 0.08)',
          }}
          formatter={(value, name) => [
            String(value ?? ''),
            name === 'noShows' ? 'No-shows' : 'Completadas',
          ]}
          cursor={{ fill: 'rgba(107, 91, 255, 0.04)' }}
        />
        <Bar dataKey="completadas" fill="#6B5BFF" name="completadas" radius={[4, 4, 0, 0]} opacity={0.8} />
        <Bar dataKey="noShows" fill="#FF6BAA" name="noShows" radius={[4, 4, 0, 0]} opacity={0.9} />
      </BarChart>
    </ResponsiveContainer>
  )
}
