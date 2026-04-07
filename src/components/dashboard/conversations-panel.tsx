'use client'

// ============================================================
// ConversationsPanel — Lista filtrable de conversaciones
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import type { ConversationStatus } from '@/types/database'

interface ConversationEntry {
  id: string
  patient_name: string
  patient_phone: string
  status: ConversationStatus
  last_message_at: string
  last_message_preview: string
  last_message_role: string
  message_count: number
}

interface Props {
  entries: ConversationEntry[]
  counts: { all: number; active: number; escalated: number; resolved: number }
}

const STATUS_CONFIG: Record<ConversationStatus | 'all', { label: string; class: string }> = {
  all: { label: 'Todas', class: '' },
  active: { label: 'Activas', class: 'badge-green' },
  escalated: { label: 'Escaladas', class: 'badge-red' },
  resolved: { label: 'Resueltas', class: 'badge-slate' },
}

const ROLE_LABELS: Record<string, string> = {
  patient: 'Paciente',
  agent: 'Agente',
  staff: 'Staff',
}

export function ConversationsPanel({ entries, counts }: Props) {
  const [filter, setFilter] = useState<ConversationStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.status !== filter) return false
    if (search.trim()) {
      const s = search.toLowerCase().trim()
      if (!e.patient_name.toLowerCase().includes(s) && !e.patient_phone.includes(s)) return false
    }
    return true
  })

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {(['all', 'active', 'escalated', 'resolved'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`card p-4 text-left transition-all ${
              filter === key ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:border-slate-300'
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
              {STATUS_CONFIG[key].label}
            </p>
            <p className="text-2xl font-semibold text-slate-900">{counts[key]}</p>
          </button>
        ))}
      </div>

      {/* Barra de búsqueda */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-10 py-2 text-sm"
            />
          </div>
          <span className="text-xs text-slate-400">{filtered.length} conversaciones</span>
        </div>

        {/* Lista */}
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-slate-900 font-medium mb-1">
              {search ? 'Sin resultados' : 'No hay conversaciones'}
            </p>
            <p className="text-slate-500 text-sm">
              {search
                ? 'Intenta con otro término de búsqueda'
                : 'Las conversaciones con pacientes aparecerán aquí'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((entry) => {
              const statusInfo = STATUS_CONFIG[entry.status]
              const isUnread = entry.last_message_role === 'patient'
              const timeAgo = formatDistanceToNow(new Date(entry.last_message_at), {
                addSuffix: true,
                locale: es,
              })

              return (
                <Link
                  key={entry.id}
                  href={`/dashboard/conversations/${entry.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  {/* Avatar con indicador */}
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                      entry.status === 'escalated' ? 'bg-red-100 text-red-700'
                        : isUnread ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}>
                      {entry.patient_name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    {entry.status === 'escalated' ? (
                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
                    ) : isUnread ? (
                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
                    ) : null}
                  </div>

                  {/* Contenido */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className={`text-sm truncate ${isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                        {entry.patient_name}
                      </p>
                      {entry.status === 'escalated' ? (
                        <span className="badge badge-red text-[10px] whitespace-nowrap">🚨 Urgente</span>
                      ) : (
                        <span className={`badge ${statusInfo.class} text-[10px]`}>{statusInfo.label}</span>
                      )}
                    </div>
                    <p className={`text-xs truncate ${isUnread ? 'text-slate-700' : 'text-slate-400'}`}>
                      {entry.last_message_role && (
                        <span className="text-slate-400">{ROLE_LABELS[entry.last_message_role] ?? entry.last_message_role}: </span>
                      )}
                      {entry.last_message_preview || 'Sin mensajes'}
                    </p>
                  </div>

                  {/* Metadata */}
                  <div className="text-right shrink-0">
                    <p className={`text-xs ${isUnread ? 'text-blue-600 font-medium' : 'text-slate-400'}`}>
                      {timeAgo}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{entry.message_count} msgs</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
