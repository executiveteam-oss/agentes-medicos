'use client'

// ============================================================
// DoctorsListClient — Lista de doctores con create modal
// ============================================================

import { useState, useTransition } from 'react'
import { getInitials, getAvatarGradient, AVATAR_GRADIENTS } from '@/lib/utils/ui-helpers'
import Link from 'next/link'
import { Plus, UserPlus, Stethoscope } from 'lucide-react'
import { createDoctor } from '@/app/actions/doctors'

interface DoctorItem {
  id: string
  name: string
  specialty: string | null
  is_active: boolean
  agenda_closed: boolean
  agenda_closed_reason: string | null
  agenda_closed_until: string | null
  schedule_type: string
  consultation_type_count: number
  future_appointments: number
}




export function DoctorsListClient({ doctors, activeCount }: { doctors: DoctorItem[]; activeCount: number }) {
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const withFuture = doctors.filter((d) => d.future_appointments > 0).length

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-5">
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h2 className="text-xl" style={{ fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>
            Tus{' '}
            <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontWeight: 400, background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              doctores
            </span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
            {activeCount} activos · {withFuture} con citas proximas
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-v2-primary" style={{ fontSize: '13px', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={16} /> Nuevo doctor
        </button>
      </div>

      {/* List */}
      {doctors.length === 0 ? (
        <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', padding: '48px 24px', textAlign: 'center' }}>
          <UserPlus size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
          <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text-muted)' }}>Aun no tienes doctores</p>
          <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Crea tu primer doctor para gestionar agendas</p>
          <button onClick={() => setShowModal(true)} className="btn-v2-primary" style={{ fontSize: '13px', padding: '9px 18px', marginTop: '16px' }}>
            + Nuevo doctor
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {doctors.map((doc) => {
            const dotColor = !doc.is_active ? 'var(--v2-text-subtle)' : doc.agenda_closed ? 'var(--v2-amber)' : 'var(--v2-green)'
            const statusLabel = !doc.is_active ? 'Inactivo' : doc.agenda_closed ? 'Agenda cerrada' : 'Activo'
            const statusBg = !doc.is_active ? 'var(--v2-bg-deeper)' : doc.agenda_closed ? 'var(--v2-amber-soft)' : 'var(--v2-green-soft)'
            const statusFg = !doc.is_active ? 'var(--v2-text-subtle)' : doc.agenda_closed ? '#b07d00' : 'var(--v2-green-deep)'

            return (
              <Link
                key={doc.id}
                href={`/dashboard/settings/doctors/${doc.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '16px 20px', textDecoration: 'none',
                  background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)',
                  borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)',
                  transition: 'box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--v2-shadow)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)'; e.currentTarget.style.transform = 'none' }}
              >
                {/* Avatar */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: '52px', height: '52px', borderRadius: '16px', background: getAvatarGradient(doc.name), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>{getInitials(doc.name)}</span>
                  </div>
                  <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '14px', height: '14px', borderRadius: '50%', background: dotColor, border: '3px solid var(--v2-bg-card)' }} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>{doc.name}</p>
                  {doc.specialty && <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '1px' }}>{doc.specialty}</p>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: statusBg, color: statusFg }}>{statusLabel}</span>
                    {doc.consultation_type_count > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: 'var(--v2-primary-soft)', color: 'var(--v2-primary)' }}>
                        {doc.consultation_type_count} tipo{doc.consultation_type_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ textAlign: 'right', flexShrink: 0 }} className="hidden sm:block">
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>
                    {doc.future_appointments}
                  </p>
                  <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>citas proximas</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <CreateDoctorModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => {
            setShowModal(false)
            showToast('Doctor creado')
            window.location.href = `/dashboard/settings/doctors/${id}`
          }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ---- Create Doctor Modal ----

function CreateDoctorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setError('')
    startTransition(async () => {
      const result = await createDoctor({ name, specialty, phone })
      if (result.ok && result.doctor) {
        onCreated(result.doctor.id)
      } else {
        setError(result.error ?? 'Error creando doctor')
      }
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,21,48,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--v2-bg-card)', borderRadius: 'var(--v2-radius-xl)', boxShadow: 'var(--v2-shadow-lg)', maxWidth: '480px', width: '100%', padding: '24px', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '4px' }}>Nuevo doctor</h2>
        <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginBottom: '20px' }}>Agrega un medico a tu clinica</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Nombre completo *</label>
            <input className="input-v2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jose Martinez" autoFocus />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Especialidad</label>
            <input className="input-v2" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ginecologia" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>Telefono</label>
            <input className="input-v2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" />
            <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Solo para uso interno, no se muestra a pacientes</p>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'var(--v2-red-soft)', borderRadius: 'var(--v2-radius)', fontSize: '13px', color: 'var(--v2-red)' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button onClick={onClose} className="btn-v2-secondary" style={{ flex: 1, fontSize: '13px' }}>Cancelar</button>
            <button onClick={handleSubmit} disabled={isPending} className="btn-v2-primary" style={{ flex: 1, fontSize: '13px', opacity: isPending ? 0.6 : 1 }}>
              {isPending ? 'Creando...' : 'Crear doctor'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
