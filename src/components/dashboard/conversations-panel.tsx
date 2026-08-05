'use client'

// ============================================================
// ConversationsPanel v2 — Lista filtrable con realtime
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getInitials, getAvatarGradient, AVATAR_GRADIENTS } from '@/lib/utils/ui-helpers'
import Link from 'next/link'
import { RelativeTime } from '@/components/ui/relative-time'
import { Search, MessageCircle } from 'lucide-react'
import { useRealtimeConnection } from '@/hooks/use-realtime-connection'
import { RealtimeIndicator } from '@/components/dashboard/realtime-indicator'
import { useNow } from '@/hooks/use-now'

interface ConversationEntry {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string
  patient_eps: string | null
  status: 'active' | 'escalated' | 'resolved'
  triage_state: 'atencion' | 'pendiente' | 'resuelta' | null
  last_message_at: string
  last_message_preview: string
  last_message_role: string
  message_count: number
  claimed_active_label: string | null
  is_mine: boolean
  specialty: string | null
  doctor_name: string | null
}

interface Props {
  entries: ConversationEntry[]
  clinicId: string
}

// Los 3 estados de triage + "agente" (observación del bot, no cola de trabajo).
type FilterKey = 'atencion' | 'pendiente' | 'resuelta' | 'agente'

// Bucket derivado: solo 'pendiente' se persiste; el resto sale del status.
function bucketOf(e: ConversationEntry): FilterKey {
  if (e.status === 'resolved') return 'resuelta'
  if (e.triage_state === 'pendiente') return 'pendiente'
  if (e.status === 'escalated') return 'atencion'
  return 'agente' // active — el bot lo maneja
}

const FILTERS: { key: FilterKey; label: string; emoji: string }[] = [
  { key: 'atencion', label: 'Atención', emoji: '⚠️' },
  { key: 'pendiente', label: 'Pendiente', emoji: '⏳' },
  { key: 'resuelta', label: 'Resuelta', emoji: '✅' },
  { key: 'agente', label: 'Con el agente', emoji: '🤖' }, // última, observación (se lee distinto)
]




export function ConversationsPanel({ entries: initialEntries, clinicId }: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [filter, setFilter] = useState<FilterKey>('atencion') // Atención por defecto
  const [search, setSearch] = useState('')
  // Filtro de VISTA (no asignación): claimed_by = yo. La dirección pidió NO
  // formalizar de quién es cada paciente, así que es solo un lente, sin dueño.
  const [onlyMine, setOnlyMine] = useState(false)

  // Sync with server if props change (navigation)
  useEffect(() => {
    setEntries(initialEntries)
  }, [initialEntries])

  const counts: Record<FilterKey, number> = {
    atencion: entries.filter((e) => bucketOf(e) === 'atencion').length,
    pendiente: entries.filter((e) => bucketOf(e) === 'pendiente').length,
    resuelta: entries.filter((e) => bucketOf(e) === 'resuelta').length,
    agente: entries.filter((e) => bucketOf(e) === 'agente').length,
  }

  // Realtime de la bandeja: cualquier cambio de conversación de la clínica →
  // router.refresh() SOFT (re-corre el server, recomputa la lista —incluido
  // last_message_role, que es derivado— y preserva scroll/filtro), debounced.
  // Reemplaza el window.location.reload() anterior.
  const router = useRouter()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 800)
  }, [router])
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }, [])

  const { connected } = useRealtimeConnection({
    channelName: 'conv-list-realtime',
    deps: [clinicId],
    onResync: () => router.refresh(), // backfill al (re)conectar
    bind: (channel) =>
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `clinic_id=eq.${clinicId}` },
        () => scheduleRefresh(),
      ),
  })

  // Ticker: re-render cada 60s → "esperando hace Xh" se recalcula solo (es
  // tiempo transcurrido, no depende de ningún evento).
  useNow()

  // La que espera hace más, arriba: hace visible el mute y auto-ordena la cola.
  const waitingMs = (e: ConversationEntry) =>
    e.last_message_role === 'patient' ? new Date(e.last_message_at).getTime() : Infinity
  const filtered = entries
    .filter((e) => {
      if (bucketOf(e) !== filter) return false
      if (onlyMine && !e.is_mine) return false
      if (search.trim()) {
        const s = search.toLowerCase().trim()
        if (!e.patient_name.toLowerCase().includes(s) && !e.patient_phone.includes(s)) return false
      }
      return true
    })
    .sort((a, b) => waitingMs(a) - waitingMs(b)) // esperando (más viejo) primero; respondidas al final

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      <RealtimeIndicator connected={connected} />
      {/* Search + Filter card */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Search */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
            <input
              type="text"
              placeholder="Buscar por nombre o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-v2"
              style={{ paddingLeft: '38px' }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const count = counts[f.key]
            const isActive = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '12.5px',
                  fontWeight: isActive ? 700 : 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  ...(isActive
                    ? {
                        background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
                        color: '#fff',
                        boxShadow: '0 2px 6px rgba(107, 91, 255, 0.25)',
                      }
                    : {
                        background: 'var(--v2-bg-soft)',
                        color: 'var(--v2-text-muted)',
                      }),
                  // "Con el agente": observación, no cola → apartada a la derecha, lectura distinta
                  ...(f.key === 'agente' ? { marginLeft: 'auto' } : {}),
                  ...(f.key === 'agente' && !isActive
                    ? { background: 'transparent', border: '1px dashed var(--v2-border-strong)', color: 'var(--v2-text-subtle)' }
                    : {}),
                }}
              >
                {f.emoji && <span>{f.emoji}</span>}
                {f.label}
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '999px',
                    ...(isActive
                      ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                      : {
                          background: f.key === 'atencion' && count > 0 ? 'var(--v2-pink-soft)' : 'var(--v2-bg-deeper)',
                          color: f.key === 'atencion' && count > 0 ? 'var(--v2-pink)' : 'var(--v2-text-subtle)',
                        }),
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
          {/* Filtro de vista "solo las mías" (claimed_by = yo). NO es asignación. */}
          <button
            onClick={() => setOnlyMine((v) => !v)}
            title="Ver solo las que estás atendiendo vos"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '999px',
              fontSize: '12px', fontWeight: onlyMine ? 700 : 500, cursor: 'pointer', fontFamily: 'var(--font-manrope), sans-serif',
              border: onlyMine ? 'none' : '1px solid var(--v2-border-soft)',
              background: onlyMine ? 'var(--v2-green-soft)' : 'transparent',
              color: onlyMine ? 'var(--v2-green-deep)' : 'var(--v2-text-subtle)',
            }}
          >
            🙋 Solo las mías
          </button>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <MessageCircle size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>
              {search ? 'Sin resultados' : filter === 'atencion' ? 'Nada que atender ahora 🎉' : filter === 'agente' ? 'El agente no tiene conversaciones activas' : `No hay conversaciones en ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}`}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {search ? 'Intenta con otro termino' : 'Las conversaciones de pacientes via WhatsApp apareceran aqui'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((entry, idx) => {
              const isUnread = entry.last_message_role === 'patient'

              return (
                <Link
                  key={entry.id}
                  href={`/dashboard/conversations/${entry.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 18px',
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
                    textDecoration: 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Avatar */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        background: getAvatarGradient(entry.patient_name),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isUnread ? '0 0 0 2px var(--v2-bg-card), 0 0 0 4px var(--v2-primary-soft)' : 'none',
                      }}
                    >
                      <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{getInitials(entry.patient_name)}</span>
                    </div>
                    {/* Status dot */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        border: '2px solid var(--v2-bg-card)',
                        background: bucketOf(entry) === 'atencion' ? 'var(--v2-amber)' : bucketOf(entry) === 'pendiente' ? '#3E74E8' : bucketOf(entry) === 'resuelta' ? 'var(--v2-text-subtle)' : 'var(--v2-primary)',
                      }}
                    />
                  </div>

                  {/* Center */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <p style={{
                        fontSize: '13.5px',
                        fontWeight: isUnread ? 700 : 600,
                        color: 'var(--v2-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {entry.patient_name}
                      </p>
                      {/* La consecuencia visible: hace cuánto espera sin respuesta.
                          Ordena la cola sola y distingue una escalada normal de una caída. */}
                      {isUnread && bucketOf(entry) !== 'agente' ? (
                        <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 7px', borderRadius: '4px', background: 'var(--v2-amber-soft)', color: '#b07d00' }}>
                          ⏳ Esperando <RelativeTime iso={entry.last_message_at} />
                        </span>
                      ) : null}
                      {entry.last_message_role === 'staff' && (
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-pink-soft)', color: 'var(--v2-pink)' }}>
                          TU
                        </span>
                      )}
                    </div>
                    <p style={{
                      fontSize: '12px',
                      color: isUnread ? 'var(--v2-text)' : 'var(--v2-text-subtle)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.last_message_role === 'agent' && '🤖 '}
                      {entry.last_message_preview || 'Sin mensajes'}
                    </p>
                    {/* Especialidad (señal visual, punto 8) — derivada del médico
                        de la cita; si no se puede, no se muestra nada. */}
                    {entry.specialty && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '3px', fontSize: '10.5px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>
                        🩺 {entry.specialty}{entry.doctor_name ? ` · ${entry.doctor_name}` : ''}
                      </span>
                    )}
                    {entry.claimed_active_label !== null && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          marginTop: '4px',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '1px 8px',
                          borderRadius: '999px',
                          background: entry.claimed_active_label === 'tú' ? 'var(--v2-green-soft)' : 'var(--v2-primary-tint)',
                          color: entry.claimed_active_label === 'tú' ? 'var(--v2-green-deep)' : 'var(--v2-primary)',
                        }}
                      >
                        {entry.claimed_active_label === 'tú' ? '🙋 La atiendes tú' : `🙋 Tomada por ${entry.claimed_active_label}`}
                      </span>
                    )}
                  </div>

                  {/* Right */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{
                      fontSize: '11px',
                      fontFamily: 'var(--font-jetbrains), monospace',
                      fontWeight: 500,
                      color: isUnread ? 'var(--v2-primary)' : 'var(--v2-text-subtle)',
                    }}>
                      <RelativeTime iso={entry.last_message_at} />
                    </p>
                    {isUnread && (
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: 'var(--v2-pink)',
                          marginLeft: 'auto',
                          marginTop: '4px',
                        }}
                      />
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
