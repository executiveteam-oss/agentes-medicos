'use client'

// ============================================================
// ClaimConfigForm — bloque "Coordinación" del panel Equipo
// Config de claim de conversaciones (Pieza A)
// ============================================================

import { useState, useTransition } from 'react'
import { updateClaimConfig } from '@/app/actions/team-config'
import type { ClaimConfig } from '@/lib/rules/claim-logic'
import { Users2 } from 'lucide-react'

interface Props {
  initial: ClaimConfig
}

export function ClaimConfigForm({ initial }: Props) {
  const [config, setConfig] = useState<ClaimConfig>(initial)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; message: string } | null>(null)

  function showToast(type: 'ok' | 'error', message: string): void {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  function handleSave(): void {
    startTransition(async () => {
      const r = await updateClaimConfig(config)
      if (r.ok) {
        showToast('ok', 'Configuración guardada')
      } else {
        showToast('error', r.error ?? 'Error guardando la configuración')
      }
    })
  }

  return (
    <div className="card-v2 p-5 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <Users2 size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-900">Coordinación</h2>
      </div>
      <p className="text-slate-400 text-xs mb-4">
        Evita que dos personas del equipo respondan la misma conversación al mismo tiempo.
      </p>

      {/* Toggle enabled */}
      <label className="flex items-center justify-between py-3 border-t border-slate-100 cursor-pointer">
        <div>
          <p className="text-sm font-medium text-slate-900">Activar coordinación de conversaciones</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Cuando alguien abre una conversación, queda &quot;tomada&quot; para las demás mientras la atiende.
          </p>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          className="h-5 w-9 shrink-0"
        />
      </label>

      {/* Modo */}
      <div className={`py-3 border-t border-slate-100 ${config.enabled ? '' : 'opacity-50'}`}>
        <p className="text-sm font-medium text-slate-900 mb-2">Modo</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="claim-mode"
              value="soft"
              checked={config.mode === 'soft'}
              disabled={!config.enabled}
              onChange={() => setConfig({ ...config, mode: 'soft' })}
              className="mt-1"
            />
            <span>
              <span className="text-sm text-slate-900 font-medium">Blando</span>
              <span className="block text-xs text-slate-500">
                Muestra un aviso de quién está atendiendo la conversación, pero no bloquea a nadie.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="claim-mode"
              value="hard"
              checked={config.mode === 'hard'}
              disabled={!config.enabled}
              onChange={() => setConfig({ ...config, mode: 'hard' })}
              className="mt-1"
            />
            <span>
              <span className="text-sm text-slate-900 font-medium">Duro</span>
              <span className="block text-xs text-slate-500">
                Duro bloquea el campo de respuesta a las demás; siempre pueden &quot;tomar de todos modos&quot;.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Vencimiento */}
      <div className={`py-3 border-t border-slate-100 ${config.enabled ? '' : 'opacity-50'}`}>
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">Vencimiento (minutos)</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Si nadie responde en este tiempo, la conversación vuelve a quedar libre.
            </p>
          </div>
          <input
            type="number"
            min={1}
            step={1}
            disabled={!config.enabled}
            value={config.expiryMinutes}
            onChange={(e) => {
              const v = Number(e.target.value)
              setConfig({ ...config, expiryMinutes: Number.isFinite(v) ? v : config.expiryMinutes })
            }}
            className="w-20 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-right"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !Number.isFinite(config.expiryMinutes) || config.expiryMinutes <= 0}
          className="btn-v2-primary px-4 py-2 text-sm"
        >
          {isPending ? 'Guardando...' : 'Guardar'}
        </button>
        {toast && (
          <span className={`text-xs font-medium ${toast.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {toast.message}
          </span>
        )}
      </div>
    </div>
  )
}
