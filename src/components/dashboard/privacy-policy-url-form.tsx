'use client'

import { useState, useTransition } from 'react'
import { updatePrivacyPolicyUrl } from '@/app/actions/legal-config'

export function PrivacyPolicyUrlForm({ initialUrl, canWrite }: { initialUrl: string | null; canWrite: boolean }) {
  const [url, setUrl] = useState(initialUrl ?? '')
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    setMsg(null)
    startTransition(async () => {
      const r = await updatePrivacyPolicyUrl(url)
      if (r.ok) setMsg({ type: 'ok', text: r.url ? 'URL guardada. El agente responderá con este link.' : 'URL borrada. El agente vuelve al acuse + escalación.' })
      else setMsg({ type: 'error', text: r.error ?? 'Error' })
    })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        URL de la política de privacidad de tu clínica
      </label>
      <p className="text-xs text-slate-400 mb-2">
        Si la configurás, cuando una paciente pregunte por la política de privacidad el agente responde con este link.
        Si la dejás vacía, el agente acusa recibo y escala al equipo (comportamiento actual). Un pedido de <em>ejercer</em> un
        derecho (eliminar, acceder…) siempre escala, tenga link o no.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={!canWrite || isPending}
          placeholder="https://tuclinica.com.co/politica-de-privacidad/"
          className="input-v2 flex-1"
        />
        {canWrite && (
          <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '13px', padding: '6px 16px' }}>
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
      {!canWrite && <p className="text-xs text-slate-400 mt-2">Solo un administrador puede cambiar esto.</p>}
      {msg && (
        <p className={`text-xs mt-2 ${msg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
      )}
    </div>
  )
}
