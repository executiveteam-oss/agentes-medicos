'use client'

// ============================================================
// Formulario de configuración de notificaciones (Tab 4)
// Incluye: recordatorios 72h, 24h (mejorado), 2h (alto riesgo),
// reporte matutino y alertas
// ============================================================

import { useState, useTransition } from 'react'
import { saveNotificationSettings } from '@/app/actions/clinic'
import type { NotificationSettings } from '@/types/database'

interface Props {
  initialData: NotificationSettings
}

function Toggle({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string
  helper?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
            checked ? 'bg-blue-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
              checked ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <div>
        <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700 transition-colors">
          {label}
        </p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </label>
  )
}

export function NotificationSettingsForm({ initialData }: Props) {
  const [data, setData] = useState<NotificationSettings>(initialData)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const result = await saveNotificationSettings(data)
      if (result.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(result.error ?? 'Error desconocido')
      }
    })
  }

  const allRemindersOn = data.reminder_72h && data.reminder_24h && data.reminder_2h

  return (
    <div className="space-y-6">
      {/* Recordatorios de citas */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Recordatorios de citas</h3>
        <p className="text-xs text-slate-400 mb-5">
          Mensajes automáticos por WhatsApp antes de cada cita.
        </p>

        <div className="space-y-5">
          <Toggle
            label="Recordatorio 3 días antes"
            helper="Recomendado para citas de larga anticipación o pacientes con historial de no-show"
            checked={data.reminder_72h}
            onChange={(v) => update('reminder_72h', v)}
          />

          <Toggle
            label="Recordatorio 24 horas antes"
            helper="Incluye automáticamente instrucciones de preparación y opción de cancelar/reagendar"
            checked={data.reminder_24h}
            onChange={(v) => update('reminder_24h', v)}
          />

          <Toggle
            label="Recordatorio 2h — solo pacientes de alto riesgo"
            helper="Solo se envía a pacientes con historial de no-show o citas agendadas con más de 7 días de anticipación. No molesta a pacientes regulares."
            checked={data.reminder_2h}
            onChange={(v) => update('reminder_2h', v)}
          />
        </div>

        {/* Info box */}
        {allRemindersOn ? (
          <div className="mt-5 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
            <p className="text-xs text-emerald-800">
              <span className="font-semibold">Excelente configuración.</span>{' '}
              Con los 3 recordatorios activos, consultorios similares han reducido sus no-shows hasta un 45%.
              El sistema nunca envía más de 3 mensajes por cita.
            </p>
          </div>
        ) : (
          <div className="mt-5 rounded-lg bg-blue-50 border border-blue-200 p-3">
            <p className="text-xs text-blue-800">
              Con los 3 recordatorios activos, consultorios similares han reducido sus no-shows hasta un 45%.
              El sistema nunca envía más de 3 mensajes por cita.
            </p>
          </div>
        )}
      </div>

      {/* Reportes */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Reportes</h3>
        <p className="text-xs text-slate-400 mb-5">
          Resúmenes automáticos enviados por WhatsApp.
        </p>

        <div className="space-y-4">
          <Toggle
            label="Enviar reporte matutino"
            helper="Recibe un resumen con las citas programadas para el día"
            checked={data.morning_report}
            onChange={(v) => update('morning_report', v)}
          />

          {data.morning_report && (
            <div className="ml-12">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Hora de envío
              </label>
              <input
                type="time"
                value={data.morning_report_hour}
                onChange={(e) => update('morning_report_hour', e.target.value)}
                className="input-field w-32"
              />
            </div>
          )}

          <Toggle
            label="Reporte semanal los lunes"
            helper="Resumen de la semana anterior por WhatsApp cada lunes a las 8am"
            checked={data.weekly_report}
            onChange={(v) => update('weekly_report', v)}
          />
        </div>
      </div>

      {/* Alertas */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Alertas</h3>
        <p className="text-xs text-slate-400 mb-5">
          Notificaciones automáticas cuando se detectan problemas.
        </p>

        <div className="space-y-4">
          <Toggle
            label="Alerta de no-show"
            helper="Notifica cuando un paciente no se presenta a su cita"
            checked={data.noshow_alert}
            onChange={(v) => update('noshow_alert', v)}
          />

          {data.noshow_alert && (
            <div className="ml-12">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Umbral de espera (minutos)
              </label>
              <input
                type="number"
                min={5}
                max={120}
                value={data.noshow_alert_threshold}
                onChange={(e) => update('noshow_alert_threshold', Number(e.target.value) || 30)}
                className="input-field w-24"
              />
              <p className="text-xs text-slate-400 mt-1">
                Se alerta si el paciente no llega {data.noshow_alert_threshold} minutos después de la hora
              </p>
            </div>
          )}

          <Toggle
            label="Alerta de facturación vencida"
            helper="Notifica cuando hay facturas pendientes de cobro por más tiempo del esperado"
            checked={data.overdue_billing_alert}
            onChange={(v) => update('overdue_billing_alert', v)}
          />

          {data.overdue_billing_alert && (
            <div className="ml-12">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Días para considerar vencida
              </label>
              <input
                type="number"
                min={1}
                max={180}
                value={data.overdue_billing_days}
                onChange={(e) => update('overdue_billing_days', Number(e.target.value) || 30)}
                className="input-field w-24"
              />
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? 'Guardando...' : 'Guardar notificaciones'}
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">Guardado</span>}
        {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
      </div>
    </div>
  )
}
