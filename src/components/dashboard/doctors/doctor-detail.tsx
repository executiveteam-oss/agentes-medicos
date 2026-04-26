'use client'

// ============================================================
// DoctorDetailClient — Hero + 4 tabs (basic, schedule, types, blocks)
// ============================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, Settings, Calendar, Stethoscope, Lock, Phone, Mail, AlertTriangle, Plus, Trash2, X } from 'lucide-react'
import {
  updateDoctor,
  toggleDoctorActive,
  closeDoctorAgenda,
  reopenDoctorAgenda,
  updateDoctorScheduleType,
  updateDoctorWorkingHours,
  deleteDoctor,
} from '@/app/actions/doctors'
import {
  createConsultationType,
  updateConsultationType,
  deleteConsultationType,
  toggleConsultationType,
} from '@/app/actions/consultation-types'
import { createBlockedDate, deleteBlockedDate } from '@/app/actions/blocked-dates'
import type { ConsultationType } from '@/types/database'
import type { BlockedDate } from '@/app/actions/blocked-dates'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ---- Types ----

interface DoctorData {
  id: string; name: string; specialty: string | null; phone: string | null; email: string | null
  is_active: boolean; agenda_closed: boolean; agenda_closed_reason: string | null; agenda_closed_until: string | null
  schedule_type: 'fixed' | 'manual'; manual_availability_message: string | null
  working_hours: Record<string, unknown> | null; created_at: string
}

type TabKey = 'basic' | 'schedule' | 'types' | 'blocks'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS: Record<string, string> = { monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miercoles', thursday: 'Jueves', friday: 'Viernes', saturday: 'Sabado', sunday: 'Domingo' }

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// ---- Main Component ----

export function DoctorDetailClient({
  doctor: initialDoctor,
  consultationTypes: initialCTs,
  blockedDates: initialBlocks,
}: {
  doctor: DoctorData
  consultationTypes: ConsultationType[]
  blockedDates: BlockedDate[]
}) {
  const [doctor, setDoctor] = useState(initialDoctor)
  const [cts, setCts] = useState(initialCTs)
  const [blocks, setBlocks] = useState(initialBlocks)
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Basic tab state
  const [name, setName] = useState(doctor.name)
  const [specialty, setSpecialty] = useState(doctor.specialty ?? '')
  const [scheduleType, setScheduleType] = useState(doctor.schedule_type)
  const [manualMsg, setManualMsg] = useState(doctor.manual_availability_message ?? '')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const dotColor = !doctor.is_active ? 'var(--v2-text-subtle)' : doctor.agenda_closed ? 'var(--v2-amber)' : 'var(--v2-green)'

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'basic', label: 'Datos', icon: <Settings size={14} /> },
    { key: 'schedule', label: 'Horario', icon: <Calendar size={14} /> },
    { key: 'types', label: 'Servicios', icon: <Stethoscope size={14} />, count: cts.length },
    { key: 'blocks', label: 'Bloqueos', icon: <Lock size={14} />, count: blocks.length },
  ]

  // ---- Handlers ----

  function handleSaveBasic() {
    startTransition(async () => {
      const r = await updateDoctor(doctor.id, { name, specialty })
      if (r.ok) {
        setDoctor((d) => ({ ...d, name, specialty: specialty || null }))
        if (scheduleType !== doctor.schedule_type) {
          await updateDoctorScheduleType(doctor.id, scheduleType, scheduleType === 'manual' ? manualMsg : null)
          setDoctor((d) => ({ ...d, schedule_type: scheduleType, manual_availability_message: scheduleType === 'manual' ? manualMsg : null }))
        }
        showToast('Datos guardados')
      } else showToast(r.error ?? 'Error')
    })
  }

  function handleToggleActive() {
    const newActive = !doctor.is_active
    startTransition(async () => {
      const r = await toggleDoctorActive(doctor.id, newActive)
      if (r.ok) { setDoctor((d) => ({ ...d, is_active: newActive })); showToast(newActive ? 'Doctor activado' : 'Doctor desactivado') }
      else showToast(r.error ?? 'Error')
    })
  }

  function handleCloseAgenda(reason: string, until: string) {
    startTransition(async () => {
      const r = await closeDoctorAgenda(doctor.id, reason || null, until || null)
      if (r.ok) { setDoctor((d) => ({ ...d, agenda_closed: true, agenda_closed_reason: reason, agenda_closed_until: until })); showToast('Agenda cerrada') }
      else showToast(r.error ?? 'Error')
    })
  }

  function handleReopenAgenda() {
    startTransition(async () => {
      const r = await reopenDoctorAgenda(doctor.id)
      if (r.ok) { setDoctor((d) => ({ ...d, agenda_closed: false, agenda_closed_reason: null, agenda_closed_until: null })); showToast('Agenda reabierta') }
      else showToast(r.error ?? 'Error')
    })
  }

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-5">
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
        <Link href="/dashboard/settings/doctors" style={{ color: 'var(--v2-primary)', fontWeight: 600, textDecoration: 'none' }}>Doctores</Link>
        <ChevronRight size={14} style={{ color: 'var(--v2-text-subtle)' }} />
        <span style={{ color: 'var(--v2-text-subtle)' }}>{doctor.name}</span>
      </div>

      {/* Agenda closed banner */}
      {doctor.agenda_closed && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 18px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-amber-soft)', border: '1px solid rgba(255,184,69,0.3)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} style={{ color: '#b07d00' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#b07d00' }}>
              Agenda cerrada{doctor.agenda_closed_reason ? ` · ${doctor.agenda_closed_reason}` : ''}
              {doctor.agenda_closed_until && ` · Hasta ${doctor.agenda_closed_until}`}
            </span>
          </div>
          <button onClick={handleReopenAgenda} disabled={isPending} className="btn-v2-secondary" style={{ fontSize: '11px', padding: '5px 12px' }}>
            Reabrir ahora
          </button>
        </div>
      )}

      {/* Hero */}
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-xl)', boxShadow: 'var(--v2-shadow-sm)', padding: '24px' }}>
        <div className="flex flex-col sm:flex-row gap-5">
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '20px', background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(107,91,255,0.25)' }}>
              <span style={{ color: '#fff', fontSize: '22px', fontWeight: 800 }}>{getInitials(doctor.name)}</span>
            </div>
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '14px', height: '14px', borderRadius: '50%', background: dotColor, border: '3px solid var(--v2-bg-card)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>{doctor.name}</h1>
            {doctor.specialty && <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>{doctor.specialty}</p>}
            <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Doctor desde {format(new Date(doctor.created_at), "MMM yyyy", { locale: es })}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
              {doctor.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--v2-text-muted)' }}><Phone size={11} />{doctor.phone}</span>}
              {doctor.email && <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--v2-text-muted)' }}><Mail size={11} />{doctor.email}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
            {!doctor.agenda_closed && (
              <CloseAgendaBtn onClose={handleCloseAgenda} disabled={isPending} />
            )}
            <button onClick={handleToggleActive} disabled={isPending} className="btn-v2-ghost" style={{ fontSize: '11px', padding: '6px 12px', color: doctor.is_active ? 'var(--v2-red)' : 'var(--v2-green-deep)' }}>
              {doctor.is_active ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '999px', fontSize: '12.5px',
              fontWeight: activeTab === t.key ? 700 : 500, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-manrope), sans-serif', transition: 'all 0.15s',
              ...(activeTab === t.key
                ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                : { background: 'var(--v2-bg-soft)', color: 'var(--v2-text-muted)' }),
            }}
          >
            {t.icon} {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', ...(activeTab === t.key ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : { background: 'var(--v2-bg-deeper)', color: 'var(--v2-text-subtle)' }) }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'basic' && (
        <Card>
          <SectionTitle title="Datos basicos" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre *" value={name} onChange={setName} />
            <Field label="Especialidad" value={specialty} onChange={setSpecialty} />
          </div>
          <div style={{ marginTop: '20px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--v2-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Tipo de horario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RadioCard selected={scheduleType === 'fixed'} onClick={() => setScheduleType('fixed')} title="Horario fijo" desc="Bloques definidos por dia" />
              <RadioCard selected={scheduleType === 'manual'} onClick={() => setScheduleType('manual')} title="Sin horario fijo" desc="Agenda se coordina manualmente" />
            </div>
            {scheduleType === 'manual' && (
              <div style={{ marginTop: '12px' }}>
                <Field label="Mensaje para pacientes" value={manualMsg} onChange={setManualMsg} placeholder="El doctor ajusta su agenda segun disponibilidad..." />
              </div>
            )}
          </div>
          <div style={{ marginTop: '20px' }}>
            <button onClick={handleSaveBasic} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '13px' }}>
              {isPending ? 'Guardando...' : 'Guardar datos'}
            </button>
          </div>
        </Card>
      )}

      {activeTab === 'schedule' && (
        <Card>
          <SectionTitle title="Horario base" />
          {doctor.schedule_type === 'manual' ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <Calendar size={32} style={{ color: 'var(--v2-text-subtle)', opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>Este doctor no tiene horario fijo</p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Cambia el tipo de horario en la tab Datos basicos</p>
            </div>
          ) : (
            <ScheduleEditor doctorId={doctor.id} initialHours={doctor.working_hours} onSaved={() => showToast('Horario guardado')} onError={(e) => showToast(e)} />
          )}
        </Card>
      )}

      {activeTab === 'types' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionTitle title="Tipos de consulta" />
            <NewTypeBtn doctorId={doctor.id} onCreated={(ct) => { setCts((prev) => [...prev, ct]); showToast('Tipo creado') }} />
          </div>
          {cts.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <Stethoscope size={32} style={{ color: 'var(--v2-text-subtle)', opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>Sin tipos de consulta</p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Agrega servicios para que el agente pueda agendar</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {cts.map((ct) => (
                <TypeRow
                  key={ct.id}
                  ct={ct}
                  onUpdated={(updated) => { setCts((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c)); showToast('Tipo actualizado') }}
                  onDeleted={() => { setCts((prev) => prev.filter((c) => c.id !== ct.id)); showToast('Tipo eliminado') }}
                  onError={(e) => showToast(e)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'blocks' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionTitle title="Dias bloqueados" />
            <NewBlockBtn doctorId={doctor.id} onCreated={(b) => { setBlocks((prev) => [b, ...prev]); showToast('Bloqueo creado') }} onError={(e) => showToast(e)} />
          </div>
          {blocks.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <Lock size={32} style={{ color: 'var(--v2-text-subtle)', opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>Sin bloqueos</p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Los bloqueos impiden nuevas citas en esas fechas</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {blocks.map((b) => (
                <BlockRow key={b.id} block={b} onDeleted={() => { setBlocks((prev) => prev.filter((x) => x.id !== b.id)); showToast('Bloqueo eliminado') }} onError={(e) => showToast(e)} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>{toast}</div>
      )}
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)', padding: '22px' }}>{children}</div>
}

function SectionTitle({ title }: { title: string }) {
  return <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '14px' }}>{title}</p>
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>{label}</label>
      <input className="input-v2" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function RadioCard({ selected, onClick, title, desc }: { selected: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '14px', borderRadius: 'var(--v2-radius)', textAlign: 'left', cursor: 'pointer',
        border: selected ? '2px solid var(--v2-primary)' : '1px solid var(--v2-border-soft)',
        background: selected ? 'var(--v2-primary-soft)' : 'var(--v2-bg-card)',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{title}</p>
      <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>{desc}</p>
    </button>
  )
}

function CloseAgendaBtn({ onClose, disabled }: { onClose: (reason: string, until: string) => void; disabled: boolean }) {
  const [show, setShow] = useState(false)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')

  if (!show) return <button onClick={() => setShow(true)} className="btn-v2-secondary" style={{ fontSize: '11px', padding: '6px 12px' }}>Cerrar agenda</button>

  return (
    <div style={{ padding: '12px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-amber-soft)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <input className="input-v2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" style={{ fontSize: '12px' }} />
      <input className="input-v2" type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ fontSize: '12px' }} />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={() => { onClose(reason, until); setShow(false) }} disabled={disabled} className="btn-v2-primary" style={{ fontSize: '11px', padding: '5px 10px' }}>Cerrar</button>
        <button onClick={() => setShow(false)} className="btn-v2-ghost" style={{ fontSize: '11px', padding: '5px 10px' }}>Cancelar</button>
      </div>
    </div>
  )
}

// ---- Schedule Editor ----

function parseWorkingHours(raw: Record<string, unknown> | null): Record<string, Array<{ start: string; end: string }>> {
  const result: Record<string, Array<{ start: string; end: string }>> = {}
  for (const day of DAYS) result[day] = []

  if (!raw || typeof raw !== 'object') return result

  for (const day of DAYS) {
    const val = (raw as Record<string, unknown>)[day]
    if (!val) { result[day] = []; continue }

    // Format: { active, blocks: [{start, end}] }
    if (typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>
      if (Array.isArray(obj.blocks)) {
        result[day] = (obj.blocks as Array<Record<string, unknown>>)
          .filter((b) => typeof b.start === 'string' && typeof b.end === 'string')
          .map((b) => ({ start: b.start as string, end: b.end as string }))
      } else if (typeof obj.start === 'string' && typeof obj.end === 'string') {
        // Old format: { start, end, active }
        result[day] = obj.active !== false ? [{ start: obj.start, end: obj.end }] : []
      }
      continue
    }

    // Format: [{start, end}] directly
    if (Array.isArray(val)) {
      result[day] = (val as Array<Record<string, unknown>>)
        .filter((b) => typeof b.start === 'string' && typeof b.end === 'string')
        .map((b) => ({ start: b.start as string, end: b.end as string }))
    }
  }

  return result
}

function toWorkingHoursForSave(hours: Record<string, Array<{ start: string; end: string }>>): Record<string, { active: boolean; blocks: Array<{ start: string; end: string }> }> {
  const result: Record<string, { active: boolean; blocks: Array<{ start: string; end: string }> }> = {}
  for (const day of DAYS) {
    const blocks = hours[day] ?? []
    result[day] = { active: blocks.length > 0, blocks }
  }
  return result
}

function ScheduleEditor({ doctorId, initialHours, onSaved, onError }: { doctorId: string; initialHours: Record<string, unknown> | null; onSaved: () => void; onError: (e: string) => void }) {
  const [hours, setHours] = useState(() => parseWorkingHours(initialHours))
  const [isPending, startTransition] = useTransition()

  function addBlock(day: string) {
    setHours((prev) => ({ ...prev, [day]: [...(prev[day] ?? []), { start: '08:00', end: '12:00' }] }))
  }

  function removeBlock(day: string, idx: number) {
    setHours((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((_, i) => i !== idx) }))
  }

  function updateBlock(day: string, idx: number, field: 'start' | 'end', value: string) {
    setHours((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((b, i) => i === idx ? { ...b, [field]: value } : b),
    }))
  }

  function handleSave() {
    startTransition(async () => {
      const forSave = toWorkingHoursForSave(hours)
      const r = await updateDoctorWorkingHours(doctorId, forSave as unknown as import('@/types/database').WorkingHours)
      if (r.ok) onSaved()
      else onError(r.error ?? 'Error guardando horario')
    })
  }

  return (
    <div>
      <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginBottom: '16px' }}>El agente solo agenda dentro de estos bloques. Multiples bloques por dia permitidos.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {DAYS.map((day) => {
          const blocks = hours[day] ?? []
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--v2-border-soft)' }}>
              <span style={{ width: '80px', fontSize: '12px', fontWeight: 700, color: 'var(--v2-text)', textTransform: 'uppercase', paddingTop: '8px', flexShrink: 0 }}>{DAY_LABELS[day]}</span>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {blocks.length === 0 && <span style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--v2-text-subtle)' }}>No atiende</span>}
                {blocks.map((b, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '8px', background: 'var(--v2-bg-soft)' }}>
                    <input type="time" value={b.start} onChange={(e) => updateBlock(day, idx, 'start', e.target.value)} style={{ fontSize: '12px', border: 'none', background: 'transparent', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', width: '70px' }} />
                    <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>—</span>
                    <input type="time" value={b.end} onChange={(e) => updateBlock(day, idx, 'end', e.target.value)} style={{ fontSize: '12px', border: 'none', background: 'transparent', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', width: '70px' }} />
                    <button onClick={() => removeBlock(day, idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '2px' }}><X size={12} /></button>
                  </div>
                ))}
                <button onClick={() => addBlock(day)} style={{ fontSize: '10px', fontWeight: 600, color: 'var(--v2-primary)', background: 'none', border: '1px dashed var(--v2-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>+ Bloque</button>
              </div>
            </div>
          )
        })}
      </div>
      <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '13px', marginTop: '16px' }}>
        {isPending ? 'Guardando...' : 'Guardar horario'}
      </button>
    </div>
  )
}

// ---- Consultation Type Row ----

function TypeRow({ ct, onUpdated, onDeleted, onError }: { ct: ConsultationType; onUpdated: (u: Partial<ConsultationType> & { id: string }) => void; onDeleted: () => void; onError: (e: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    startTransition(async () => {
      const r = await toggleConsultationType(ct.id, !ct.is_active)
      if (r.ok) onUpdated({ id: ct.id, is_active: !ct.is_active })
      else onError(r.error ?? 'Error')
    })
  }

  function handleDelete() {
    if (!confirm(`¿Eliminar "${ct.name}"?`)) return
    startTransition(async () => {
      const r = await deleteConsultationType(ct.id)
      if (r.ok) onDeleted()
      else onError(r.error ?? 'Tiene citas futuras, no se puede eliminar')
    })
  }

  const priceFmt = ct.price ? `$${ct.price.toLocaleString('es-CO')}` : '-'

  return (
    <div style={{ border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius)', overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-manrope), sans-serif' }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: ct.eps_name ? 'var(--v2-primary-soft)' : 'var(--v2-bg-deeper)', color: ct.eps_name ? 'var(--v2-primary)' : 'var(--v2-text-subtle)' }}>
          {ct.eps_name ?? 'Particular'}
        </span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{ct.name}</span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-muted)' }}>{ct.duration_minutes}min</span>
        <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>{priceFmt}</span>
        <button onClick={(e) => { e.stopPropagation(); handleToggle() }} disabled={isPending} className="toggle-v2" data-active={ct.is_active ? 'true' : 'false'} style={{ flexShrink: 0 }} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--v2-text-subtle)', transition: 'transform 0.15s', transform: expanded ? 'rotate(180deg)' : 'none' }}><path d="M19 9l-7 7-7-7" /></svg>
      </button>

      {expanded && (
        <TypeExpandedEditor ct={ct} onUpdated={onUpdated} onDelete={handleDelete} onError={onError} />
      )}
    </div>
  )
}

function TypeExpandedEditor({ ct, onUpdated, onDelete, onError }: { ct: ConsultationType; onUpdated: (u: Partial<ConsultationType> & { id: string }) => void; onDelete: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState(ct.name)
  const [duration, setDuration] = useState(ct.duration_minutes)
  const [price, setPrice] = useState(ct.price ?? 0)
  const [epsName, setEpsName] = useState(ct.eps_name ?? '')
  const [bookable, setBookable] = useState(ct.bookable_via_whatsapp)
  const [modality, setModality] = useState(ct.modality)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      const r = await updateConsultationType(ct.id, { doctor_id: ct.doctor_id, name, duration_minutes: duration, price: price || null, eps_name: epsName || null, bookable_via_whatsapp: bookable, modality, requires_preparation: ct.requires_preparation, preparation_instructions: ct.preparation_instructions, is_active: ct.is_active, requires_documents: ct.requires_documents, required_documents_description: ct.required_documents_description })
      if (r.ok) {
        onUpdated({ id: ct.id, name, duration_minutes: duration, price: price || null, eps_name: epsName || null, bookable_via_whatsapp: bookable, modality })
      } else onError(r.error ?? 'Error')
    })
  }

  return (
    <div style={{ padding: '16px 18px', background: 'var(--v2-primary-tint)', borderTop: '1px solid var(--v2-border-soft)', borderLeft: '3px solid var(--v2-primary)' }}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" style={{ marginBottom: '12px' }}>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Nombre</label><input className="input-v2" value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: '12px', marginTop: '2px' }} /></div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Duracion (min)</label><input className="input-v2" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ fontSize: '12px', marginTop: '2px' }} /></div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Precio COP</label><input className="input-v2" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ fontSize: '12px', marginTop: '2px' }} /></div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>EPS/Convenio</label><input className="input-v2" value={epsName} onChange={(e) => setEpsName(e.target.value)} placeholder="Particular" style={{ fontSize: '12px', marginTop: '2px' }} /></div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Modalidad</label>
          <select className="input-v2" value={modality} onChange={(e) => setModality(e.target.value as typeof modality)} style={{ fontSize: '12px', marginTop: '2px' }}>
            <option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="ambas">Ambas</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setBookable(!bookable)} className="toggle-v2" data-active={bookable ? 'true' : 'false'} />
        <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Agendable por WhatsApp</span>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '12px', padding: '7px 14px' }}>{isPending ? 'Guardando...' : 'Guardar'}</button>
        <button onClick={onDelete} disabled={isPending} style={{ fontSize: '12px', color: 'var(--v2-red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Eliminar</button>
      </div>
    </div>
  )
}

// ---- New Type Button ----

function NewTypeBtn({ doctorId, onCreated }: { doctorId: string; onCreated: (ct: ConsultationType) => void }) {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()

  if (!show) return <button onClick={() => setShow(true)} className="btn-v2-secondary" style={{ fontSize: '11px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Plus size={12} /> Nuevo tipo</button>

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input className="input-v2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del servicio" style={{ fontSize: '12px', width: '200px' }} autoFocus />
      <button
        onClick={() => {
          if (!name.trim()) return
          startTransition(async () => {
            const r = await createConsultationType({ doctor_id: doctorId, name, duration_minutes: 30, requires_preparation: false, preparation_instructions: null, price: null, is_active: true, bookable_via_whatsapp: true, requires_documents: false, required_documents_description: null, modality: 'presencial' })
            if (r.ok && r.data) { onCreated(r.data); setName(''); setShow(false) }
          })
        }}
        disabled={isPending}
        className="btn-v2-primary" style={{ fontSize: '11px', padding: '6px 12px' }}
      >
        Crear
      </button>
      <button onClick={() => setShow(false)} className="btn-v2-ghost" style={{ fontSize: '11px', padding: '6px 8px' }}>×</button>
    </div>
  )
}

// ---- Block Row ----

function BlockRow({ block, onDeleted, onError }: { block: BlockedDate; onDeleted: () => void; onError: (e: string) => void }) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('¿Eliminar este bloqueo?')) return
    startTransition(async () => {
      const r = await deleteBlockedDate(block.id)
      if (r.ok) onDeleted()
      else onError(r.error ?? 'Error')
    })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius)' }}>
      <span style={{ fontSize: '20px' }}>🚫</span>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{block.reason ?? 'Bloqueo'}</p>
        <p style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-muted)' }}>{block.start_date} → {block.end_date}</p>
      </div>
      <button onClick={handleDelete} disabled={isPending} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px' }}><Trash2 size={14} /></button>
    </div>
  )
}

// ---- New Block Button ----

function NewBlockBtn({ doctorId, onCreated, onError }: { doctorId: string; onCreated: (b: BlockedDate) => void; onError: (e: string) => void }) {
  const [show, setShow] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  if (!show) return <button onClick={() => setShow(true)} className="btn-v2-secondary" style={{ fontSize: '11px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Plus size={12} /> Bloquear fechas</button>

  return (
    <div style={{ padding: '14px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '280px' }}>
      <div className="grid grid-cols-2 gap-3">
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Desde</label><input className="input-v2" type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ fontSize: '12px' }} /></div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Hasta</label><input className="input-v2" type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ fontSize: '12px' }} /></div>
      </div>
      <input className="input-v2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (vacaciones, congreso...)" style={{ fontSize: '12px' }} />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => {
            if (!start || !end) return
            startTransition(async () => {
              const r = await createBlockedDate({ doctorId, startDate: start, endDate: end, reason: reason || null })
              if (r.ok) {
                onCreated({ id: crypto.randomUUID(), clinic_id: '', doctor_id: doctorId, start_date: start, end_date: end, reason, patient_reason: null, created_at: new Date().toISOString() })
                setShow(false); setStart(''); setEnd(''); setReason('')
              } else onError(r.error ?? 'Error')
            })
          }}
          disabled={isPending}
          className="btn-v2-primary" style={{ fontSize: '11px', padding: '6px 12px' }}
        >
          {isPending ? 'Creando...' : 'Crear bloqueo'}
        </button>
        <button onClick={() => setShow(false)} className="btn-v2-ghost" style={{ fontSize: '11px', padding: '6px 8px' }}>Cancelar</button>
      </div>
    </div>
  )
}
