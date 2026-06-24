'use client'

// ============================================================
// DoctorDetailClient — Hero + 4 tabs (basic, schedule, types, blocks)
// ============================================================

import { useState, useTransition, useEffect } from 'react'
import { getInitials } from '@/lib/utils/ui-helpers'
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
  classifyInsurerType,
} from '@/app/actions/consultation-types'
import { getSchedulesForType, saveSchedulesForType, type CtSchedule } from '@/app/actions/consultation-type-schedules'
import {
  enableEscalateHumanRule,
  disableEscalateHumanRule,
  getRulesForConsultationType,
} from '@/app/actions/consultation-type-rules'
import { createBlockedDate, deleteBlockedDate } from '@/app/actions/blocked-dates'
import { classifyRes256Category } from '@/app/actions/res256'
import { getConsultationTypes } from '@/app/actions/consultation-types'
import { TypesImportPanel } from '@/components/dashboard/doctors/types-import-panel'
import type { ConsultationType, Res256Category } from '@/types/database'
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


// ---- Main Component ----

export function DoctorDetailClient({
  doctor: initialDoctor,
  consultationTypes: initialCTs,
  blockedDates: initialBlocks,
  canWrite = true,
  userRoleName,
}: {
  doctor: DoctorData
  consultationTypes: ConsultationType[]
  blockedDates: BlockedDate[]
  canWrite?: boolean
  userRoleName?: string
}) {
  const [doctor, setDoctor] = useState(initialDoctor)
  const [cts, setCts] = useState(initialCTs)
  const [blocks, setBlocks] = useState(initialBlocks)
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [importPanelOpen, setImportPanelOpen] = useState(false)

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

      {/* Read-only banner para roles sin permiso de escritura */}
      {!canWrite && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-amber-soft)', border: '1px solid rgba(255,184,69,0.3)' }}>
          <Lock size={16} style={{ color: '#b07d00', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: '13px', color: '#7a5500' }}>
            <strong style={{ fontWeight: 700 }}>Modo solo lectura.</strong>{' '}
            Tu rol{userRoleName ? ` (${userRoleName})` : ''} no permite editar datos de médicos, horarios, servicios ni bloqueos.
            Pedile al administrador del consultorio que actualice tus permisos si necesitás hacer cambios.
          </div>
        </div>
      )}

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
          {canWrite && (
            <button onClick={handleReopenAgenda} disabled={isPending} className="btn-v2-secondary" style={{ fontSize: '11px', padding: '5px 12px' }}>
              Reabrir ahora
            </button>
          )}
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
          {canWrite && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
              {!doctor.agenda_closed && (
                <CloseAgendaBtn onClose={handleCloseAgenda} disabled={isPending} />
              )}
              <button onClick={handleToggleActive} disabled={isPending} className="btn-v2-ghost" style={{ fontSize: '11px', padding: '6px 12px', color: doctor.is_active ? 'var(--v2-red)' : 'var(--v2-green-deep)' }}>
                {doctor.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          )}
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
            <Field label="Nombre *" value={name} onChange={setName} disabled={!canWrite} />
            <Field label="Especialidad" value={specialty} onChange={setSpecialty} disabled={!canWrite} />
          </div>
          <div style={{ marginTop: '20px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--v2-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Tipo de horario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RadioCard selected={scheduleType === 'fixed'} onClick={() => canWrite && setScheduleType('fixed')} title="Horario fijo" desc="Bloques definidos por dia" disabled={!canWrite} />
              <RadioCard selected={scheduleType === 'manual'} onClick={() => canWrite && setScheduleType('manual')} title="Sin horario fijo" desc="Agenda se coordina manualmente" disabled={!canWrite} />
            </div>
            {scheduleType === 'manual' && (
              <div style={{ marginTop: '12px' }}>
                <Field label="Mensaje para pacientes" value={manualMsg} onChange={setManualMsg} placeholder="El doctor ajusta su agenda segun disponibilidad..." disabled={!canWrite} />
              </div>
            )}
          </div>
          {canWrite && (
            <div style={{ marginTop: '20px' }}>
              <button onClick={handleSaveBasic} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '13px' }}>
                {isPending ? 'Guardando...' : 'Guardar datos'}
              </button>
            </div>
          )}
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
            <ScheduleEditor doctorId={doctor.id} initialHours={doctor.working_hours} onSaved={() => showToast('Horario guardado')} onError={(e) => showToast(e)} canWrite={canWrite} />
          )}
        </Card>
      )}

      {activeTab === 'types' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
            <SectionTitle title="Tipos de consulta" />
            {canWrite && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setImportPanelOpen(true)}
                  className="btn-v2-ghost"
                  style={{ fontSize: '12px' }}
                  title="Sugerencias derivadas de citas iSalud del médico + catálogo completo"
                >
                  + Importar sugerencias de iSalud
                </button>
                <NewTypeBtn doctorId={doctor.id} onCreated={(ct) => { setCts((prev) => [...prev, ct]); showToast('Tipo creado') }} />
              </div>
            )}
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
                  canWrite={canWrite}
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
            {canWrite && (
              <NewBlockBtn doctorId={doctor.id} onCreated={(b) => { setBlocks((prev) => [b, ...prev]); showToast('Bloqueo creado') }} onError={(e) => showToast(e)} />
            )}
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
                <BlockRow key={b.id} block={b} canWrite={canWrite} onDeleted={() => { setBlocks((prev) => prev.filter((x) => x.id !== b.id)); showToast('Bloqueo eliminado') }} onError={(e) => showToast(e)} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>{toast}</div>
      )}

      {/* Modal: import sugerencias iSalud doctor-first */}
      {importPanelOpen && (
        <TypesImportPanel
          doctorId={doctor.id}
          doctorName={doctor.name}
          existingConsultationTypes={cts}
          onClose={() => setImportPanelOpen(false)}
          onCreated={(count) => {
            if (count > 0) {
              // Refrescar la lista de consultation_types tras la creación
              getConsultationTypes(doctor.id).then((types) => {
                if (Array.isArray(types)) setCts(types)
              })
              showToast(`${count} tipo${count === 1 ? '' : 's'} creado${count === 1 ? '' : 's'}`)
            }
          }}
        />
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

function Field({ label, value, onChange, placeholder, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>{label}</label>
      <input
        className="input-v2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={disabled}
        style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
      />
    </div>
  )
}

function RadioCard({ selected, onClick, title, desc, disabled }: { selected: boolean; onClick: () => void; title: string; desc: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px', borderRadius: 'var(--v2-radius)', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
        border: selected ? '2px solid var(--v2-primary)' : '1px solid var(--v2-border-soft)',
        background: selected ? 'var(--v2-primary-soft)' : 'var(--v2-bg-card)',
        fontFamily: 'var(--font-manrope), sans-serif',
        opacity: disabled ? 0.6 : 1,
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

function ScheduleEditor({ doctorId, initialHours, onSaved, onError, canWrite = true }: { doctorId: string; initialHours: Record<string, unknown> | null; onSaved: () => void; onError: (e: string) => void; canWrite?: boolean }) {
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
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '8px', background: 'var(--v2-bg-soft)', opacity: canWrite ? 1 : 0.6 }}>
                    <input type="time" value={b.start} onChange={(e) => updateBlock(day, idx, 'start', e.target.value)} disabled={!canWrite} style={{ fontSize: '12px', border: 'none', background: 'transparent', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', width: '70px' }} />
                    <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>—</span>
                    <input type="time" value={b.end} onChange={(e) => updateBlock(day, idx, 'end', e.target.value)} disabled={!canWrite} style={{ fontSize: '12px', border: 'none', background: 'transparent', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', width: '70px' }} />
                    {canWrite && (
                      <button onClick={() => removeBlock(day, idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '2px' }}><X size={12} /></button>
                    )}
                  </div>
                ))}
                {canWrite && (
                  <button onClick={() => addBlock(day)} style={{ fontSize: '10px', fontWeight: 600, color: 'var(--v2-primary)', background: 'none', border: '1px dashed var(--v2-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>+ Bloque</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {canWrite && (
        <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '13px', marginTop: '16px' }}>
          {isPending ? 'Guardando...' : 'Guardar horario'}
        </button>
      )}
    </div>
  )
}

// ---- Consultation Type Row ----

function TypeRow({ ct, onUpdated, onDeleted, onError, canWrite = true }: { ct: ConsultationType; onUpdated: (u: Partial<ConsultationType> & { id: string }) => void; onDeleted: () => void; onError: (e: string) => void; canWrite?: boolean }) {
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

  function handleClassify(type: 'EPS' | 'Prepagada') {
    startTransition(async () => {
      const r = await classifyInsurerType(ct.id, type)
      if (r.ok) onUpdated({ id: ct.id, insurer_type: type, insurer_type_set_by_staff: true })
      else onError(r.error ?? 'Error clasificando')
    })
  }

  const priceFmt = ct.price ? `$${ct.price.toLocaleString('es-CO')}` : '-'
  const needsClassification = ct.eps_name !== null && ct.insurer_type === null

  return (
    <div style={{ border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius)', overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-manrope), sans-serif' }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: ct.eps_name ? 'var(--v2-primary-soft)' : 'var(--v2-bg-deeper)', color: ct.eps_name ? 'var(--v2-primary)' : 'var(--v2-text-subtle)' }}>
          {ct.eps_name ?? 'Particular'}
        </span>
        {ct.eps_name && (
          ct.insurer_type ? (
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: ct.insurer_type === 'EPS' ? '#dbeafe' : '#fef3c7', color: ct.insurer_type === 'EPS' ? '#1e40af' : '#92400e' }}>
              {ct.insurer_type}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#fee2e2', color: '#991b1b' }}>Sin clasificar</span>
              {canWrite && (
                <>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); handleClassify('EPS') }}
                    style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#dbeafe', color: '#1e40af', cursor: 'pointer' }}
                    title="Clasificar como EPS"
                  >EPS</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); handleClassify('Prepagada') }}
                    style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', cursor: 'pointer' }}
                    title="Clasificar como Prepagada"
                  >Prepagada</span>
                </>
              )}
            </span>
          )
        )}
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{ct.name}</span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-muted)' }}>{ct.duration_minutes}min</span>
        <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>{priceFmt}</span>
        <button onClick={(e) => { e.stopPropagation(); if (canWrite) handleToggle() }} disabled={isPending || !canWrite} className="toggle-v2" data-active={ct.is_active ? 'true' : 'false'} style={{ flexShrink: 0, opacity: canWrite ? 1 : 0.5, cursor: canWrite ? 'pointer' : 'not-allowed' }} />
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
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Categoría Res-256 (reporte MinSalud)</label>
          <select
            className="input-v2"
            value={ct.res256_category ?? ''}
            onChange={(e) => {
              const value = e.target.value === '' ? null : (e.target.value as Res256Category)
              startTransition(async () => {
                const r = await classifyRes256Category(ct.id, value)
                if (r.ok) onUpdated({ id: ct.id, res256_category: value })
                else onError(r.error ?? 'Error')
              })
            }}
            style={{ fontSize: '12px', marginTop: '2px' }}
          >
            <option value="">— Sin clasificar —</option>
            <option value="Ginecología">Ginecología</option>
            <option value="Obstetricia">Obstetricia</option>
            <option value="Ecografía">Ecografía</option>
            <option value="Resonancia Magnética">Resonancia Magnética</option>
            <option value="NoAplica">No aplica al reporte</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setBookable(!bookable)} className="toggle-v2" data-active={bookable ? 'true' : 'false'} />
        <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Agendable por WhatsApp</span>
      </div>

      {/* Reglas especiales — Bloque 1: escalar siempre a humano */}
      <EscalateHumanRuleToggle ctId={ct.id} ctName={ct.name} onError={onError} />

      {/* Schedules section */}
      <CtSchedulesEditor ctId={ct.id} />

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '12px', padding: '7px 14px' }}>{isPending ? 'Guardando...' : 'Guardar'}</button>
        <button onClick={onDelete} disabled={isPending} style={{ fontSize: '12px', color: 'var(--v2-red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Eliminar</button>
      </div>
    </div>
  )
}

// ---- Consultation Type Schedules Editor ----

const SCHED_DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']

function CtSchedulesEditor({ ctId }: { ctId: string }) {
  const [schedules, setSchedules] = useState<CtSchedule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Load once on mount
  useEffect(() => {
    let cancelled = false
    getSchedulesForType(ctId).then((data) => {
      if (!cancelled) { setSchedules(data); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [ctId])

  function addRow() {
    setSchedules((prev) => [...prev, { id: 'new-' + Date.now(), day_of_week: 1, start_time: '08:00', end_time: '12:00' }])
    setDirty(true); setSaved(false)
  }

  function removeRow(idx: number) {
    setSchedules((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true); setSaved(false)
  }

  function updateRow(idx: number, field: string, value: string | number) {
    setSchedules((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
    setDirty(true); setSaved(false)
  }

  function validate(): string | null {
    for (const s of schedules) {
      if (s.start_time >= s.end_time) return `Hora inicio debe ser menor que fin (${SCHED_DAY_LABELS[s.day_of_week]})`
    }
    // Check overlaps per day
    const byDay = new Map<number, Array<{ start: string; end: string }>>()
    for (const s of schedules) {
      const existing = byDay.get(s.day_of_week) ?? []
      for (const e of existing) {
        if (s.start_time < e.end && s.end_time > e.start) {
          return `Franjas se solapan en ${SCHED_DAY_LABELS[s.day_of_week]}`
        }
      }
      existing.push({ start: s.start_time, end: s.end_time })
      byDay.set(s.day_of_week, existing)
    }
    return null
  }

  function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError(null)
    startTransition(async () => {
      const result = await saveSchedulesForType(ctId, schedules.map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time.slice(0, 5),
        end_time: s.end_time.slice(0, 5),
      })))
      if (result.ok) { setSaved(true); setDirty(false); setTimeout(() => setSaved(false), 2000) }
      else setError(result.error ?? 'Error guardando franjas')
    })
  }

  return (
    <div style={{ marginTop: '14px', padding: '14px 16px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)', border: '1px solid var(--v2-border-soft)' }}>
      <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-primary)', marginBottom: '4px' }}>Franjas horarias</p>
      <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginBottom: '10px' }}>
        Sin franjas = se agenda en cualquier horario. Con franjas = solo dentro de ellas.
      </p>

      {!loaded && <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>Cargando franjas...</p>}

      {loaded && (
        <>
          {schedules.length === 0 && (
            <p style={{ fontSize: '11px', fontStyle: 'italic', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>Sin franjas · Se agenda en cualquier horario del doctor</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {schedules.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <select
                  value={s.day_of_week}
                  onChange={(e) => updateRow(i, 'day_of_week', Number(e.target.value))}
                  className="input-v2"
                  style={{ fontSize: '11px', padding: '5px 8px', width: '70px' }}
                >
                  {SCHED_DAY_LABELS.map((d, di) => <option key={di} value={di}>{d}</option>)}
                </select>
                <input
                  type="time"
                  value={s.start_time.slice(0, 5)}
                  onChange={(e) => updateRow(i, 'start_time', e.target.value)}
                  className="input-v2"
                  style={{ fontSize: '11px', padding: '5px 8px', width: '90px', fontFamily: 'var(--font-jetbrains), monospace' }}
                />
                <span style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-subtle)' }}>—</span>
                <input
                  type="time"
                  value={s.end_time.slice(0, 5)}
                  onChange={(e) => updateRow(i, 'end_time', e.target.value)}
                  className="input-v2"
                  style={{ fontSize: '11px', padding: '5px 8px', width: '90px', fontFamily: 'var(--font-jetbrains), monospace' }}
                />
                <button
                  onClick={() => removeRow(i)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px', fontSize: '14px', lineHeight: 1 }}
                  title="Eliminar franja"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-primary)', background: 'none', border: '1px dashed var(--v2-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', marginTop: '8px' }}
          >
            + Agregar franja
          </button>

          {error && <p style={{ fontSize: '11px', color: 'var(--v2-red)', marginTop: '6px' }}>{error}</p>}

          {dirty && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <button onClick={handleSave} disabled={isPending} className="btn-v2-primary" style={{ fontSize: '11px', padding: '5px 12px' }}>
                {isPending ? 'Guardando...' : 'Guardar franjas'}
              </button>
              {saved && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-green-deep)' }}>Guardado ✓</span>}
            </div>
          )}
          {!dirty && saved && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-green-deep)', marginTop: '6px', display: 'block' }}>Guardado ✓</span>}
        </>
      )}
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

function BlockRow({ block, onDeleted, onError, canWrite = true }: { block: BlockedDate; onDeleted: () => void; onError: (e: string) => void; canWrite?: boolean }) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!canWrite) return
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
      {canWrite && (
        <button onClick={handleDelete} disabled={isPending} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px' }}><Trash2 size={14} /></button>
      )}
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

// ============================================================
// EscalateHumanRuleToggle — Bloque 1 de "Reglas especiales"
//
// Lady activa/desactiva "Escalar siempre a humano" para un tipo
// de consulta. Cuando está activa, el agente NO agenda — deriva
// al staff. Defense in depth: el agente del WhatsApp respeta la
// regla (prompt) Y create_appointment la rechaza físicamente
// (check duro en executor).
// ============================================================

function EscalateHumanRuleToggle({
  ctId,
  ctName,
  onError,
}: {
  ctId: string
  ctName: string
  onError: (e: string) => void
}): React.JSX.Element {
  const [active, setActive] = useState<boolean | null>(null) // null = cargando
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let mounted = true
    getRulesForConsultationType(ctId).then((rules) => {
      if (!mounted) return
      const escalateRule = rules.find((r) => r.rule_type === 'escalate_human')
      setActive(!!escalateRule?.active)
    }).catch(() => {
      if (mounted) setActive(false)
    })
    return () => { mounted = false }
  }, [ctId])

  function handleToggle(): void {
    if (active === null) return
    const newValue = !active
    setActive(newValue) // optimistic
    startTransition(async () => {
      const r = newValue
        ? await enableEscalateHumanRule(ctId)
        : await disableEscalateHumanRule(ctId)
      if (!r.ok) {
        setActive(!newValue) // rollback
        onError(r.error ?? 'Error al actualizar la regla')
      }
    })
  }

  const loading = active === null
  const isActive = active === true

  return (
    <div style={{
      marginBottom: '12px',
      padding: '12px 14px',
      background: isActive ? '#fef3c7' : 'var(--v2-bg-soft)',
      border: `1px solid ${isActive ? '#f5b500' : 'var(--v2-border-soft)'}`,
      borderRadius: 'var(--v2-radius)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
    }}>
      <button
        onClick={handleToggle}
        disabled={loading || isPending}
        className="toggle-v2"
        data-active={isActive ? 'true' : 'false'}
        style={{
          flexShrink: 0,
          marginTop: '2px',
          opacity: loading ? 0.5 : 1,
          cursor: loading ? 'wait' : 'pointer',
        }}
        title="Escalar siempre a humano"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 700,
          color: isActive ? '#7a5500' : 'var(--v2-text)',
          marginBottom: '2px',
        }}>
          {isActive ? '🚨 Escalar siempre a humano (activa)' : 'Escalar siempre a humano'}
        </div>
        <div style={{
          fontSize: '11px',
          color: isActive ? '#7a5500' : 'var(--v2-text-muted)',
          lineHeight: 1.4,
        }}>
          Cuando un paciente pide <strong>{ctName}</strong>, el agente NO agenda.
          Lo deriva al staff para validar. Usado para servicios complejos
          (procedimientos con sedación, biopsias, histeroscopias).
        </div>
      </div>
    </div>
  )
}
