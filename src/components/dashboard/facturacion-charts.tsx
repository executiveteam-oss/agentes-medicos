'use client'

// ============================================================
// FacturacionCharts — Gráfico de ingresos por tipo de pago
// Solo recibe datos serializables desde el server component
// ============================================================

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'

interface PaymentData {
  tipo: string
  cantidad: number
  monto: number
}

interface FacturacionChartsProps {
  data: PaymentData[]
}

const COLORS: Record<string, string> = {
  Particular: '#0f766e',
  EPS: '#1e40af',
  Póliza: '#7c3aed',
  ARL: '#d97706',
  SOAT: '#ca8a04',
}

const DEFAULT_COLOR = '#94a3b8'

export function FacturacionCharts({ data }: FacturacionChartsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        No hay datos de facturación para mostrar
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          outerRadius={85}
          innerRadius={45}
          dataKey="cantidad"
          nameKey="tipo"
          label={({ name, percent }: PieLabelRenderProps) =>
            `${String(name ?? '')} ${((Number(percent) ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
          strokeWidth={2}
          stroke="#ffffff"
        >
          {data.map((entry) => (
            <Cell
              key={entry.tipo}
              fill={COLORS[entry.tipo] ?? DEFAULT_COLOR}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            color: '#0f172a',
            borderRadius: '10px',
            fontSize: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
          formatter={(value) => [String(value ?? ''), 'Citas']}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: '#64748b', fontSize: '12px' }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
