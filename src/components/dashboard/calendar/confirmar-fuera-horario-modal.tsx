'use client'

// ============================================================
// "Ese horario está cerrado. ¿Agendás igual?"
//
// ADVERTIR, NO BLOQUEAR: la secretaria a veces encaja una cita fuera de franja
// a propósito —la paciente ya viajó, el médico dijo que sí por teléfono— y hoy
// no tiene otra vía. Bloquearla la manda de vuelta a iSalud, que es peor: ahí
// agenda sin que Omuwan se entere de nada.
//
// Lo que sí exige es que la decisión sea CONSCIENTE. Antes toda la grilla se
// veía igual y un clic en una celda cerrada era indistinguible de un clic en un
// hueco libre; ahora hay que leer el motivo y confirmar.
//
// El motivo va completo y concreto —"no atiende los lunes" vs "cerramos el
// 14/08"— porque llevan a decisiones distintas: al primero se le busca otro día
// del mismo médico; al segundo, otro médico o una llamada a la paciente.
// ============================================================

import type { EstadoFranja } from '@/lib/calendar/day-availability'

export function ConfirmarFueraHorarioModal({
  estado,
  motivo,
  fecha,
  hora,
  onConfirmar,
  onCancelar,
}: {
  estado: EstadoFranja
  motivo: string
  fecha: string
  hora: string
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const esBloqueo = estado === 'bloqueado'

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancelar() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div style={{
        background: 'var(--v2-bg-card)', borderRadius: 'var(--v2-radius-lg)',
        width: 'min(440px, 100%)', padding: '20px',
        fontFamily: 'var(--font-manrope), sans-serif',
        borderTop: `4px solid ${esBloqueo ? '#A3306B' : '#787182'}`,
      }}>
        <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>
          {esBloqueo ? '🚫 Ese día está cerrado' : '⚠ Fuera del horario del médico'}
        </p>

        <div style={{
          marginTop: '12px', padding: '10px 12px', borderRadius: 'var(--v2-radius)',
          background: esBloqueo ? 'rgba(163,48,107,0.08)' : 'rgba(120,113,130,0.08)',
          border: `1px solid ${esBloqueo ? 'rgba(163,48,107,0.25)' : 'rgba(120,113,130,0.25)'}`,
        }}>
          <p style={{ fontSize: '12.5px', color: 'var(--v2-text)', lineHeight: 1.45 }}>{motivo}</p>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '12px', lineHeight: 1.45 }}>
          Vas a agendar el <strong>{fecha}</strong> a las <strong>{hora}</strong>. Podés hacerlo igual
          si lo coordinaste con el médico — queda registrado quién lo confirmó.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
          <button onClick={onCancelar} className="btn-v2-ghost v2-tap" style={{ fontSize: '12.5px' }}>
            Elegir otro horario
          </button>
          <button onClick={onConfirmar} className="btn-v2-primary v2-tap" style={{ fontSize: '12.5px' }}>
            Agendar igual
          </button>
        </div>
      </div>
    </div>
  )
}
