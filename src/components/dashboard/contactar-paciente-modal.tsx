'use client'

// ============================================================
// Modal de contacto a la paciente, con VISTA PREVIA obligatoria.
//
// El mensaje sale con el nombre de la clínica: la secretaria tiene que VER lo
// que va a llegarle antes de apretar. El botón de enviar está deshabilitado
// hasta que la previa se haya generado.
//
// La secretaria escribe el motivo y nada más. Que el sistema use texto libre o
// una plantilla aprobada según la ventana de 24h es decisión del servidor —
// ella no tiene por qué saber qué es una ventana de conversación.
// ============================================================

import { useState, useTransition } from 'react'
import { previewContactoGeneral, enviarContactoGeneral } from '@/app/actions/contactar-paciente'

export function ContactarPacienteModal({
  conversationId,
  patientName,
  onClose,
}: {
  conversationId: string
  patientName: string
  onClose: (enviado: boolean) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<{ texto: string; canal: 'libre' | 'template' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Cambiar el motivo invalida la previa: nunca se manda algo distinto de lo
  // que ella vio.
  function onMotivoChange(v: string) {
    setMotivo(v)
    setPreview(null)
    setError(null)
  }

  function verPrevia() {
    startTransition(async () => {
      const r = await previewContactoGeneral(conversationId, motivo)
      if (r.ok && r.texto && r.canal) { setPreview({ texto: r.texto, canal: r.canal }); setError(null) }
      else setError(r.error ?? 'No se pudo generar la vista previa')
    })
  }

  function enviar() {
    startTransition(async () => {
      const r = await enviarContactoGeneral(conversationId, motivo)
      if (r.ok) onClose(true)
      else setError(r.error ?? 'No se pudo enviar')
    })
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(false) }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div style={{ background: 'var(--v2-bg-card)', borderRadius: 'var(--v2-radius-lg)', width: 'min(520px, 100%)',
                    maxHeight: '90vh', overflowY: 'auto', padding: '20px', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>Escribirle a {patientName}</p>
        <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '4px', marginBottom: '14px' }}>
          Contale el motivo. Vas a ver el mensaje completo antes de enviarlo.
        </p>

        <textarea
          value={motivo}
          onChange={(e) => onMotivoChange(e.target.value)}
          placeholder="Ej: Nos falta la orden médica para radicar tu cuenta con Coomeva"
          className="input-v2"
          style={{ width: '100%', minHeight: '90px', resize: 'vertical' }}
        />

        {preview && (
          <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: 'var(--v2-radius)',
                        background: 'var(--v2-bg-soft)', border: '1px solid var(--v2-border-soft)' }}>
            <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                        color: 'var(--v2-text-subtle)', marginBottom: '6px' }}>
              Así lo va a recibir {patientName}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--v2-text)', whiteSpace: 'pre-wrap' }}>{preview.texto}</p>
            <p style={{ fontSize: '10.5px', color: 'var(--v2-text-subtle)', marginTop: '8px' }}>
              {preview.canal === 'libre'
                ? 'Sale como mensaje normal — la paciente escribió hace poco.'
                : 'Sale como plantilla aprobada — hace más de 24 horas que no escribe.'}
            </p>
          </div>
        )}

        {error && (
          <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--v2-red)' }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={() => onClose(false)} disabled={isPending} className="btn-v2-ghost v2-tap">
            Cancelar
          </button>
          {!preview ? (
            <button onClick={verPrevia} disabled={isPending || !motivo.trim()} className="btn-v2-primary v2-tap">
              {isPending ? 'Generando…' : 'Ver cómo queda'}
            </button>
          ) : (
            <button onClick={enviar} disabled={isPending} className="btn-v2-primary v2-tap">
              {isPending ? 'Enviando…' : 'Enviar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
