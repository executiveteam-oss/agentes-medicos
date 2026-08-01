'use client'

// ============================================================
// PatientsListV2 — Lista server-driven: búsqueda + paginación (escala a 15K+)
// La búsqueda navega a ?q= y la paginación a ?page= (re-query en el server).
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getInitials, getAvatarGradient } from '@/lib/utils/ui-helpers'
import Link from 'next/link'
import { Search, Plus, Edit2, Trash2, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import { deletePatient, getPatientForEdit } from '@/app/actions/patients'
import type { PatientFormData, PatientListItem } from '@/app/actions/patients'
import { PatientFormModal } from '@/components/dashboard/patient-form-modal'
import { formatPhone } from '@/lib/utils/dates'

interface Props {
  patients: PatientListItem[]
  total: number
  page: number
  totalPages: number
  search: string
}

export function PatientsListV2({ patients, total, page, totalPages, search }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [term, setTerm] = useState(search)
  const [showModal, setShowModal] = useState(false)
  const [editData, setEditData] = useState<PatientFormData | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)
  const firstRender = useRef(true)

  // Búsqueda con debounce → navega a ?q= (page 1). No dispara en el primer render.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (term.trim()) params.set('q', term.trim())
      else params.delete('q')
      params.delete('page')
      router.push(`/dashboard/patients?${params.toString()}`)
    }, 400)
    return () => clearTimeout(t)
  }, [term]) // eslint-disable-line react-hooks/exhaustive-deps

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(p))
    router.push(`/dashboard/patients?${params.toString()}`)
  }

  function showToastMsg(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function handleEdit(patientId: string) {
    const fullData = await getPatientForEdit(patientId)
    if (fullData) { setEditData(fullData); setShowModal(true) }
    else showToastMsg('Error cargando datos')
  }

  async function handleDelete(patientId: string) {
    if (!confirm('¿Eliminar este paciente?')) return
    const result = await deletePatient(patientId)
    if (result.ok) { showToastMsg('Paciente eliminado'); router.refresh() }
    else showToastMsg(result.error ?? 'Error')
  }

  const rangeFrom = total === 0 ? 0 : (page - 1) * 20 + 1
  const rangeTo = Math.min(page * 20, total)

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)', overflow: 'hidden' }}>
        {/* Search + Add */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por nombre, documento o teléfono..."
              className="input-v2"
              style={{ paddingLeft: '38px' }}
            />
          </div>
          <button
            onClick={() => { setEditData(undefined); setShowModal(true) }}
            className="btn-v2-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '10px 16px', whiteSpace: 'nowrap' }}
          >
            <Plus size={16} /> Nuevo paciente
          </button>
        </div>

        {/* List */}
        {patients.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <Users size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>
              {search ? 'Sin coincidencias' : 'Aun no tienes pacientes'}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {search ? `Sin resultados para "${search}"` : 'Los pacientes se registran automaticamente al escribir por WhatsApp'}
            </p>
          </div>
        ) : (
          <div>
            {patients.map((p, idx) => (
              <Link
                key={p.id}
                href={`/dashboard/patients/${p.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', textDecoration: 'none', borderBottom: idx < patients.length - 1 ? '1px solid var(--v2-border-soft)' : 'none', transition: 'background 0.1s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: getAvatarGradient(p.name), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{getInitials(p.name)}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-primary-soft)', color: 'var(--v2-primary)' }}>
                      {p.entidad ?? p.eps ?? 'Sin registrar'}
                    </span>
                    {p.tratante_names.length > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-pink-soft)', color: 'var(--v2-pink)' }} title="Médico tratante">
                        {p.tratante_names.join(', ')}
                      </span>
                    )}
                    {p.no_show_count > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: p.no_show_count >= 3 ? 'var(--v2-red-soft)' : 'var(--v2-amber-soft)', color: p.no_show_count >= 3 ? 'var(--v2-red)' : '#b07d00' }}>
                        {p.no_show_count} no-show{p.no_show_count > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>
                    {p.phone ? formatPhone(p.phone) : 'Sin teléfono'} &middot; {p.total_appointments} citas
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }} className="hidden sm:block">
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>{p.total_appointments}</p>
                  <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>{p.document_number ?? ''}</p>
                </div>
                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={(e) => e.preventDefault()}>
                  <button onClick={(e) => { e.stopPropagation(); handleEdit(p.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }} title="Editar"><Edit2 size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }} title="Eliminar"><Trash2 size={14} /></button>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Paginación */}
        {totalPages > 1 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--v2-border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
              {rangeFrom.toLocaleString('es-CO')}–{rangeTo.toLocaleString('es-CO')} de {total.toLocaleString('es-CO')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="btn-v2-ghost"
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12.5px', padding: '6px 12px', opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
              >
                <ChevronLeft size={15} /> Anterior
              </button>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>Página {page} de {totalPages}</span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="btn-v2-ghost"
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12.5px', padding: '6px 12px', opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'default' : 'pointer' }}
              >
                Siguiente <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      <PatientFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        initialData={editData}
        onSaved={() => window.location.reload()}
      />

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
