'use client'

// ============================================================
// AnalyticsCharts — Gráficas Recharts para la página de analytics
// Componente cliente (Recharts requiere interactividad)
// ============================================================

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { DayOccupation, TimeSlotDemand, PaymentBreakdown } from '@/app/actions/analytics'
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
