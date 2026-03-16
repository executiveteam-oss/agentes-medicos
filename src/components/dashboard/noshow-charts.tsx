'use client'

// ============================================================
// NoShowCharts — Gráfico de no-shows por día de la semana
// Solo recibe datos serializables desde el server component
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
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        No hay suficientes datos para mostrar el gráfico
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="dia"
          stroke="#94a3b8"
          tick={{ fontSize: 12, fill: '#64748b' }}
          axisLine={{ stroke: '#e2e8f0' }}
          tickLine={false}
        />
        <YAxis
          stroke="#94a3b8"
          tick={{ fontSize: 12, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            color: '#0f172a',
            borderRadius: '10px',
            fontSize: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
          formatter={(value, name) => [
            String(value ?? ''),
            name === 'noShows' ? 'No-shows' : 'Completadas',
          ]}
          cursor={{ fill: '#f1f5f9' }}
        />
        <Bar dataKey="completadas" fill="#0f766e" name="completadas" radius={[4, 4, 0, 0]} />
        <Bar dataKey="noShows" fill="#dc2626" name="noShows" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
