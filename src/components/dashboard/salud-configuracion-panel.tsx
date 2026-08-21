// ============================================================
// Panel: SALUD DE LA CONFIGURACIÓN
//
// Cada línea dice el NÚMERO, qué le pasa a la paciente, y a dónde ir a
// arreglarlo. El número solo no mueve a nadie: "14 servicios sin precio" se
// ignora, "si te preguntan cuánto cuesta uno de estos 14 el agente no puede
// responder" no.
// ============================================================

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ArrowRight, Info } from 'lucide-react'
import type { SaludDeConfiguracion, Hallazgo } from '@/lib/clinic/salud-configuracion'

function Fila({ h }: { h: Hallazgo }) {
  const ok = h.cuantos === 0
  const alta = h.severidad === 'alta'
  const color = ok ? 'var(--v2-success, #16a34a)' : alta ? 'var(--v2-danger, #dc2626)' : 'var(--v2-warning, #d97706)'
  const Icono = ok ? CheckCircle2 : alta ? AlertTriangle : Info

  return (
    <div
      style={{
        display: 'flex', gap: '14px', padding: '16px 18px',
        borderTop: '1px solid var(--v2-border-soft)',
        alignItems: 'flex-start',
        opacity: ok ? 0.72 : 1,
      }}
    >
      <Icono size={18} style={{ color, flexShrink: 0, marginTop: '2px' }} aria-hidden />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--v2-text)' }}>{h.titulo}</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color }}>
            {ok ? 'todo en orden' : `${h.cuantos} de ${h.deUnTotalDe}`}
          </span>
        </div>

        <p style={{ margin: '6px 0 0', fontSize: '13px', lineHeight: 1.55, color: 'var(--v2-text-muted)' }}>
          {h.queImplica}
        </p>

        {h.ejemplos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            {h.ejemplos.map((e) => (
              <span
                key={e}
                style={{
                  fontSize: '11.5px', padding: '3px 9px', borderRadius: '999px',
                  background: 'var(--v2-bg-soft, rgba(0,0,0,0.04))',
                  color: 'var(--v2-text-muted)', border: '1px solid var(--v2-border-soft)',
                  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {e}
              </span>
            ))}
            {h.cuantos > h.ejemplos.length && (
              <span style={{ fontSize: '11.5px', padding: '3px 4px', color: 'var(--v2-text-muted)' }}>
                y {h.cuantos - h.ejemplos.length} más
              </span>
            )}
            {/* El conteo de arriba es de FILAS y los chips son nombres únicos:
                si el catálogo repite un nombre, los dos números no coinciden y
                eso está bien — el que manda es el de arriba. */}
          </div>
        )}

        {!ok && (
          <Link
            href={h.href}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '11px',
              fontSize: '12.5px', fontWeight: 700, color: 'var(--v2-primary)', textDecoration: 'none',
            }}
          >
            Arreglar en {h.hrefLabel} <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}

export function SaludConfiguracionPanel({ salud }: { salud: SaludDeConfiguracion }) {
  const { hallazgos, conProblemas } = salud
  const conProblema = hallazgos.filter((h) => h.cuantos > 0)
  const enOrden = hallazgos.filter((h) => h.cuantos === 0)
  const todoBien = conProblemas === 0

  return (
    <div className="space-y-6">
      <div className="card-v2" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 18px 16px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--v2-text)' }}>
            Salud de la configuración
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: '13px', lineHeight: 1.6, color: 'var(--v2-text-muted)' }}>
            {todoBien
              ? 'No encontramos datos faltantes que le impidan al agente responder bien. Esta pantalla se recalcula cada vez que la abres.'
              : `Encontramos ${conProblemas} ${conProblemas === 1 ? 'cosa' : 'cosas'} que hacen que el agente responda peor de lo que podría. No son errores del sistema: son datos que faltan en tu configuración.`}
          </p>
        </div>

        {conProblema.map((h) => <Fila key={h.clave} h={h} />)}

        {enOrden.length > 0 && (
          <>
            <div
              style={{
                padding: '11px 18px', borderTop: '1px solid var(--v2-border-soft)',
                fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: 'var(--v2-text-muted)',
                background: 'var(--v2-bg-soft, rgba(0,0,0,0.02))',
              }}
            >
              Ya está en orden
            </div>
            {enOrden.map((h) => <Fila key={h.clave} h={h} />)}
          </>
        )}
      </div>

      <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', lineHeight: 1.6 }}>
        Esta pantalla lee tu configuración en vivo — no guarda una copia, así que
        lo que ves acá es lo mismo que ve el agente cuando le escribe una paciente.
      </p>
    </div>
  )
}
