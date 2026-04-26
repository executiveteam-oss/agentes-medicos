'use client'

// ============================================================
// PatientsListV2 — Lista visual con avatars, tags, filtros v2
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { Search, Plus, Edit2, Trash2, Users } from 'lucide-react'
import { deletePatient, getPatientForEdit } from '@/app/actions/patients'
import type { PatientFormData } from '@/app/actions/patients'
import { PatientFormModal } from '@/components/dashboard/patient-form-modal'
import { formatPhone } from '@/lib/utils/dates'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

interface Patient {
  id: string
  name: string
  phone: string
  eps: string | null
  total_appointments: number
  no_show_count: number
  created_at: string
}

type FilterTab = 'all' | 'recent' | 'loyal' | 'risk'

const FILTERS: { key: FilterTab; label: string; emoji: string }[] = [
  { key: 'all', label: 'Todos', emoji: '' },
  { key: 'recent', label: 'Recientes', emoji: '🆕' },
  { key: 'loyal', label: 'Leales', emoji: '⭐' },
  { key: 'risk', label: 'En riesgo', emoji: '⚠️' },
]

const EPS_OPTIONS = ['todas', 'Sura', 'Compensar', 'Nueva EPS', 'Sanitas', 'Coosalud', 'Medimas', 'Particular']

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6B5BFF, #8676FF)',
  'linear-gradient(135deg, #FF6BAA, #FF8EC4)',
  'linear-gradient(135deg, #34C77B, #5DD99A)',
  'linear-gradient(135deg, #FFB845, #FFCF7A)',
  'linear-gradient(135deg, #5444E5, #6B5BFF)',
]

function getGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]
}

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function PatientsListV2({ initialPatients }: { initialPatients: Patient[] }) {
  const [allPatients, setAllPatients] = useState(initialPatients)
  const [search, setSearch] = useState('')
  const [epsFilter, setEpsFilter] = useState('todas')
  const [tab, setTab] = useState<FilterTab>('all')
  const [showModal, setShowModal] = useState(false)
  const [editData, setEditData] = useState<PatientFormData | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  const filtered = allPatients.filter((p) => {
    // Search
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      if (!p.name.toLowerCase().includes(s) && !p.phone.includes(s)) return false
    }
    // EPS
    if (epsFilter !== 'todas') {
      if (epsFilter === 'Particular') {
        if (p.eps !== null && p.eps !== 'Particular') return false
      } else {
        if (p.eps !== epsFilter) return false
      }
    }
    // Tab
    if (tab === 'recent' && new Date(p.created_at).getTime() < thirtyDaysAgo) return false
    if (tab === 'loyal' && p.total_appointments < 5) return false
    if (tab === 'risk' && p.no_show_count < 2) return false
    return true
  })

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleEdit(patientId: string) {
    const fullData = await getPatientForEdit(patientId)
    if (fullData) { setEditData(fullData); setShowModal(true) }
    else showToastMsg('Error cargando datos')
  }

  async function handleDelete(patientId: string) {
    if (!confirm('¿Eliminar este paciente?')) return
    const result = await deletePatient(patientId)
    if (result.ok) { setAllPatients((prev) => prev.filter((p) => p.id !== patientId)); showToastMsg('Paciente eliminado') }
    else showToastMsg(result.error ?? 'Error')
  }

  const tabCounts = {
    all: allPatients.length,
    recent: allPatients.filter((p) => new Date(p.created_at).getTime() >= thirtyDaysAgo).length,
    loyal: allPatients.filter((p) => p.total_appointments >= 5).length,
    risk: allPatients.filter((p) => p.no_show_count >= 2).length,
  }

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      {/* Toolbar card */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Search + Add */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o telefono..."
              className="input-v2"
              style={{ paddingLeft: '38px' }}
            />
          </div>
          <select
            value={epsFilter}
            onChange={(e) => setEpsFilter(e.target.value)}
            className="input-v2"
            style={{ width: 'auto', minWidth: '140px' }}
          >
            {EPS_OPTIONS.map((eps) => (
              <option key={eps} value={eps}>{eps === 'todas' ? 'Todas las EPS' : eps}</option>
            ))}
          </select>
          <button
            onClick={() => { setEditData(undefined); setShowModal(true) }}
            className="btn-v2-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '10px 16px', whiteSpace: 'nowrap' }}
          >
            <Plus size={16} /> Nuevo paciente
          </button>
        </div>

        {/* Tab filters */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const isActive = tab === f.key
            const count = tabCounts[f.key]
            return (
              <button
                key={f.key}
                onClick={() => setTab(f.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', borderRadius: '999px', fontSize: '12.5px',
                  fontWeight: isActive ? 700 : 500, border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-manrope), sans-serif', transition: 'all 0.15s',
                  ...(isActive
                    ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                    : { background: 'var(--v2-bg-soft)', color: 'var(--v2-text-muted)' }),
                }}
              >
                {f.emoji && <span>{f.emoji}</span>}
                {f.label}
                <span style={{
                  fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px',
                  ...(isActive
                    ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                    : { background: 'var(--v2-bg-deeper)', color: 'var(--v2-text-subtle)' }),
                }}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <Users size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>
              {search || epsFilter !== 'todas' || tab !== 'all' ? 'Sin coincidencias' : 'Aun no tienes pacientes'}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {search ? `Sin resultados para "${search}"` : 'Los pacientes se registran automaticamente al escribir por WhatsApp'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((p, idx) => (
              <Link
                key={p.id}
                href={`/dashboard/patients/${p.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '14px 18px', textDecoration: 'none',
                  borderBottom: idx < filtered.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: '44px', height: '44px', borderRadius: '50%',
                    background: getGradient(p.name),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                >
                  <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{getInitials(p.name)}</span>
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-primary-soft)', color: 'var(--v2-primary)' }}>
                      {p.eps ?? 'Particular'}
                    </span>
                    {p.total_appointments >= 5 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-green-soft)', color: 'var(--v2-green-deep)' }}>Leal</span>
                    )}
                    {p.no_show_count > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: p.no_show_count >= 3 ? 'var(--v2-red-soft)' : 'var(--v2-amber-soft)', color: p.no_show_count >= 3 ? 'var(--v2-red)' : '#b07d00' }}>
                        {p.no_show_count} no-show{p.no_show_count > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>
                    {formatPhone(p.phone)} &middot; {p.total_appointments} citas
                  </p>
                </div>

                {/* Meta */}
                <div style={{ textAlign: 'right', flexShrink: 0 }} className="hidden sm:block">
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>
                    {p.total_appointments}
                  </p>
                  <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: false, locale: es })}
                  </p>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={(e) => e.preventDefault()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleEdit(p.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }}
                    title="Editar"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }}
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      <PatientFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        initialData={editData}
        onSaved={() => window.location.reload()}
      />

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
