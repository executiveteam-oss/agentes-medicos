'use client'

// ============================================================
// DoctorSelector — dropdown to pick active doctor for agenda views
// Persists selection in localStorage (SSR-safe)
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import { getInitials, getAvatarGradient } from '@/lib/utils/ui-helpers'
import type { CalendarDoctor } from './types'

const STORAGE_KEY = 'agenda-selected-doctor-id'

interface Props {
  doctors: CalendarDoctor[]
  selectedId: string
  onChange: (doctorId: string) => void
  restrictDoctorId?: string | null
}

export function DoctorSelector({ doctors, selectedId, onChange, restrictDoctorId }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const selected = doctors.find((d) => d.id === selectedId) ?? doctors[0]

  // If doctor role, just show name (no dropdown)
  if (restrictDoctorId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '10px', background: 'var(--v2-bg-soft)', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <DoctorAvatar name={selected?.name ?? ''} size={24} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{selected?.name ?? 'Doctor'}</span>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 12px', borderRadius: '10px',
          background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)',
          cursor: 'pointer', fontFamily: 'var(--font-manrope), sans-serif',
          boxShadow: 'var(--v2-shadow-sm)',
          transition: 'border-color 0.15s',
        }}
      >
        <DoctorAvatar name={selected?.name ?? ''} size={24} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.name ?? 'Seleccionar'}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--v2-text-subtle)', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            minWidth: '220px', maxHeight: '320px', overflowY: 'auto',
            background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius)', boxShadow: 'var(--v2-shadow-lg)',
            zIndex: 30, padding: '4px',
          }}
        >
          {doctors.map((doc) => {
            const isSelected = doc.id === selectedId
            return (
              <button
                key={doc.id}
                onClick={() => { onChange(doc.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                  padding: '8px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: isSelected ? 'var(--v2-primary-soft)' : 'transparent',
                  textAlign: 'left', fontFamily: 'var(--font-manrope), sans-serif',
                  transition: 'background 0.1s',
                  textDecoration: doc.agenda_closed ? 'line-through' : 'none',
                  opacity: doc.agenda_closed ? 0.6 : 1,
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <DoctorAvatar name={doc.name} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: isSelected ? 700 : 500, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.name}
                  </p>
                </div>
                {doc.agenda_closed && <Lock size={12} style={{ color: 'var(--v2-text-subtle)', flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DoctorAvatar({ name, size }: { name: string; size: number }) {
  return (
    <div
      style={{
        width: `${size}px`, height: `${size}px`, borderRadius: '50%',
        background: getAvatarGradient(name),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ color: '#fff', fontSize: `${Math.round(size * 0.4)}px`, fontWeight: 700 }}>
        {getInitials(name).slice(0, 1)}
      </span>
    </div>
  )
}

/** Read doctor ID from localStorage (SSR-safe) */
export function getStoredDoctorId(doctors: CalendarDoctor[], restrictDoctorId?: string | null): string {
  if (restrictDoctorId) return restrictDoctorId
  if (typeof window === 'undefined') return doctors[0]?.id ?? ''

  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && doctors.some((d) => d.id === stored)) return stored

  return doctors[0]?.id ?? ''
}

/** Persist doctor selection */
export function storeDoctorId(id: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, id)
  }
}
