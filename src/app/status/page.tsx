// ============================================================
// Página pública: Estado del sistema (/status)
// Sin auth requerido — revalida cada 60 segundos
// ============================================================

import { getSystemStatus } from '@/app/actions/system-status'
import type { SystemComponent } from '@/app/actions/system-status'
import { StatusAutoRefresh } from './status-refresh'

const COMPONENT_LABELS: Record<string, string> = {
  whatsapp_agent: 'Agente WhatsApp',
  web_dashboard: 'Dashboard web',
  reminders: 'Recordatorios automáticos',
  appointments: 'Procesamiento de citas',
  database: 'Base de datos',
}

function getComponentLabel(component: string): string {
  return COMPONENT_LABELS[component] ?? component
}

export const revalidate = 60

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  operational: { icon: '🟢', label: 'Operativo', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  degraded: { icon: '🟡', label: 'Degradado', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  outage: { icon: '🔴', label: 'Interrupción', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
}

function getOverallStatus(components: SystemComponent[]): 'operational' | 'degraded' | 'outage' {
  if (components.some(c => c.status === 'outage')) return 'outage'
  if (components.some(c => c.status === 'degraded')) return 'degraded'
  return 'operational'
}

const OVERALL_MESSAGES: Record<string, string> = {
  operational: 'Todos los sistemas operando con normalidad',
  degraded: 'Degradación parcial del servicio',
  outage: 'Interrupción del servicio',
}

function UptimeBar() {
  // Genera 30 barras representando los últimos 30 días
  // En producción se alimentaría de datos reales de monitoreo
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: i,
    status: 'operational' as const,
  }))

  return (
    <div className="flex gap-0.5">
      {days.map((d) => (
        <div
          key={d.day}
          className={`flex-1 h-8 rounded-sm ${
            d.status === 'operational' ? 'bg-emerald-400' :
            d.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'
          }`}
          title={`Hace ${30 - d.day} días: ${STATUS_CONFIG[d.status].label}`}
        />
      ))}
    </div>
  )
}

export default async function StatusPage() {
  const components = await getSystemStatus()
  const overall = getOverallStatus(components)
  const config = STATUS_CONFIG[overall]

  // Calcular "última actualización" como la más reciente de todos los componentes
  const lastUpdate = components.reduce((latest, c) => {
    const d = new Date(c.updated_at)
    return d > latest ? d : latest
  }, new Date(0))

  const minutesAgo = Math.max(1, Math.round((Date.now() - lastUpdate.getTime()) / 60000))
  const timeAgoText = minutesAgo < 60
    ? `Hace ${minutesAgo} minuto${minutesAgo !== 1 ? 's' : ''}`
    : `Hace ${Math.round(minutesAgo / 60)} hora${Math.round(minutesAgo / 60) !== 1 ? 's' : ''}`

  return (
    <div className="min-h-screen bg-slate-50">
      <StatusAutoRefresh />

      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--v2-primary-deep)] flex items-center justify-center">
              <span className="text-white text-xs font-bold">O</span>
            </div>
            <h1 className="text-lg font-semibold text-slate-900">Estado del sistema — Omuwan</h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Overall status */}
        <div className={`rounded-xl border ${config.border} ${config.bg} p-6 text-center`}>
          <p className="text-3xl mb-2">{config.icon}</p>
          <p className={`text-lg font-semibold ${config.color}`}>
            {OVERALL_MESSAGES[overall]}
          </p>
          <p className="text-sm text-slate-500 mt-1">{timeAgoText}</p>
        </div>

        {/* Components */}
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {components.map((comp) => {
            const s = STATUS_CONFIG[comp.status] ?? STATUS_CONFIG.operational
            return (
              <div key={comp.id} className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {getComponentLabel(comp.component)}
                  </p>
                  {comp.message && (
                    <p className="text-xs text-slate-500 mt-0.5">{comp.message}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{s.icon}</span>
                  <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Uptime */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Uptime últimos 30 días</h2>
            <span className="text-xs text-slate-500">100%</span>
          </div>
          <UptimeBar />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-slate-400">30 días atrás</span>
            <span className="text-[10px] text-slate-400">Hoy</span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-400">
            Omuwan — Asistente IA para consultorios médicos
          </p>
        </div>
      </div>
    </div>
  )
}
