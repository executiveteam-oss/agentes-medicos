'use client'

// ============================================================
// AnalyticsCharts — Gráficas Recharts para la página de analytics
// Componente cliente (Recharts requiere interactividad)
// ============================================================

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ComposedChart, Area, Line, Legend,
} from 'recharts'
import type { DayOccupation, TimeSlotDemand, PaymentBreakdown, MonthTrend } from '@/app/actions/analytics'
import type { EpsProfitability } from '@/app/actions/glosas'
import { formatCOP } from '@/lib/utils/dates'

// ---- Ocupación por día ----

export function DayOccupationChart({ data }: { data: DayOccupation[] }) {
  const maxCitas = Math.max(...data.map((d) => d.citas), 1)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="dia" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value) => [`${value} citas`, 'Citas']}
        />
        <Bar dataKey="citas" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.citas === maxCitas ? '#0f766e' : '#5eead4'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---- Demanda por franja horaria ----

export function TimeSlotsChart({ data }: { data: TimeSlotDemand[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="franja" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={100} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value) => [`${value} citas`, 'Citas']}
        />
        <Bar dataKey="citas" fill="#0f766e" radius={[0, 4, 4, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---- Desglose por tipo de pago ----

export function PaymentBreakdownChart({ data }: { data: PaymentBreakdown[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="tipo" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value) => [formatCOP(Number(value))]}
        />
        <Bar dataKey="cobrado" name="Cobrado" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={35} stackId="a" />
        <Bar dataKey="pendiente" name="Pendiente" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={35} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---- Rentabilidad por EPS ----

export function EpsProfitabilityChart({ data }: { data: EpsProfitability[] }) {
  if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">Sin datos de EPS</p>

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 50)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis
          type="category"
          dataKey="epsName"
          tick={{ fontSize: 12, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          width={100}
        />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value) => [formatCOP(Number(value))]}
        />
        <Legend verticalAlign="top" height={36} />
        <Bar dataKey="facturado" name="Facturado" fill="#94a3b8" radius={[0, 4, 4, 0]} maxBarSize={24} />
        <Bar dataKey="cobrado" name="Cobrado" fill="#0f766e" radius={[0, 4, 4, 0]} maxBarSize={24} />
        <Bar dataKey="glosado" name="Glosado" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---- Tendencia ingresos reales vs potenciales ----

export function LossValuationChart({ data }: { data: MonthTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="lossGap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
          formatter={(value, name) => [
            formatCOP(Number(value)),
            name === 'potencial' ? 'Ingresos potenciales' : 'Ingresos reales',
          ]}
        />
        <Legend
          verticalAlign="top"
          height={36}
          formatter={(value) => (
            value === 'potencial' ? 'Ingresos potenciales' : 'Ingresos reales'
          )}
        />
        <Area
          type="monotone"
          dataKey="potencial"
          stroke="#94a3b8"
          strokeDasharray="5 5"
          fill="url(#lossGap)"
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="real"
          stroke="#2563eb"
          strokeWidth={2.5}
          dot={{ fill: '#2563eb', r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
