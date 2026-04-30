'use client'

// ============================================================
// PendingContactsButton — Checklist icon + badge + side panel
// Shows patients who couldn't be reached via WhatsApp
// Uses Supabase Realtime for live updates
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { ClipboardCheck, ExternalLink, Check, ChevronDown } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useUserSession } from '@/context/user-session'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { markPendingContactResolved, getPendingContacts } from '@/app/actions/pending-contacts'

interface PendingContact {
  id: string
  clinic_id: string
  patient_id: string | null
  appointment_id: string | null
  reason_type: string
  reason_text: string
  patient_name: string
  patient_phone: string
  doctor_name: string | null
  appointment_date: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_method: string | null
  created_at: string
}

const REASON_LABELS: Record<string, string> = {
  reminder_failed: 'Recordatorios no entregados',
  cancellation_no_delivery: 'Cancelaciones sin avisar',
  waitlist_notification_failed: 'Avisos de lista de espera fallidos',
}

function formatPhone(phone: string): string {
  const clean = phone.replace('+', '').replace('57', '')
  if (clean.length === 10) return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`
  return clean
}

function getPrefilledMessage(contact: PendingContact, clinicName: string): string {
  const name = contact.patient_name
  const doctor = contact.doctor_name ?? 'su doctor'

  if (!contact.appointment_date) {
    return `Hola ${name}, te escribimos de ${clinicName}. No pudimos comunicarnos contigo por WhatsApp. Por favor escribenos cuando puedas.`
  }

  const date = format(parseISO(contact.appointment_date), "EEEE d 'de' MMMM", { locale: es })
  const time = format(parseISO(contact.appointment_date), 'h:mm a')

  if (contact.reason_type === 'cancellation_no_delivery') {
    return `Hola ${name}, te escribimos de ${clinicName} para avisarte que tu cita del ${date} a las ${time} con ${doctor} fue cancelada. Disculpa las molestias. Podemos reagendarte?`
  }

  return `Hola ${name}, te recordamos tu cita del ${date} a las ${time} con ${doctor}. Confirmas?`
}

export function PendingContactsButton() {
  const session = useUserSession()
  const [contacts, setContacts] = useState<PendingContact[]>([])
  const [history, setHistory] = useState<PendingContact[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const clinicId = session?.clinicId
  const clinicName = 'el consultorio'

  // Load initial data via server action (bypasses RLS, avoids clinic_users recursion)
  useEffect(() => {
    if (!clinicId) return
    getPendingContacts().then(({ pending, history: hist }) => {
      setContacts(pending)
      setHistory(hist)
      setLoaded(true)
    })
  }, [clinicId])

  // Realtime subscription
  useEffect(() => {
    if (!clinicId) return
    const supabase = createSupabaseBrowserClient()

    const channel = supabase
      .channel('pending-contacts-rt')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pending_contacts',
        filter: `clinic_id=eq.${clinicId}`,
      }, (payload) => {
        const newItem = payload.new as PendingContact
        if (!newItem.resolved_at) {
          setContacts((prev) => [newItem, ...prev])
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'pending_contacts',
        filter: `clinic_id=eq.${clinicId}`,
      }, (payload) => {
        const updated = payload.new as PendingContact
        if (updated.resolved_at) {
          setContacts((prev) => prev.filter((c) => c.id !== updated.id))
          setHistory((prev) => [updated, ...prev].slice(0, 20))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [clinicId])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleMarkContacted = useCallback(async (id: string) => {
    setMarking(id)
    await markPendingContactResolved(id)
    // Optimistic: remove from list immediately (realtime will confirm)
    setContacts((prev) => prev.filter((c) => c.id !== id))
    setMarking(null)
  }, [])

  function openWhatsApp(contact: PendingContact) {
    const phone = contact.patient_phone.replace('+', '')
    const message = getPrefilledMessage(contact, clinicName)
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank')
  }

  if (!loaded || !clinicId) return null

  const pendingCount = contacts.length

  // Group by reason_type
  const grouped = contacts.reduce<Record<string, PendingContact[]>>((acc, c) => {
    const key = c.reason_type
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Pendientes de contactar"
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px',
          color: isOpen ? 'var(--v2-primary)' : 'var(--v2-text-muted)',
          transition: 'color 0.15s',
          marginRight: '4px',
        }}
      >
        <ClipboardCheck size={20} />
        {pendingCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '2px',
              right: '0px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#D4537E',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-jetbrains), monospace',
            }}
          >
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            width: '380px',
            maxHeight: '560px',
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: 'var(--v2-shadow-lg)',
            overflow: 'hidden',
            zIndex: 50,
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>
              Pendientes de contactar
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
              {pendingCount === 0 ? 'Todos los pacientes fueron notificados' : `${pendingCount} paciente${pendingCount !== 1 ? 's' : ''} sin notificar`}
            </p>
          </div>

          {/* Pending list */}
          <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
            {pendingCount === 0 && history.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <ClipboardCheck size={28} style={{ color: 'var(--v2-text-subtle)', opacity: 0.3, margin: '0 auto 8px' }} />
                <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>Sin pendientes</p>
              </div>
            ) : (
              <>
                {Object.entries(grouped).map(([type, items]) => (
                  <div key={type}>
                    {/* Section header */}
                    <div style={{ padding: '8px 16px', background: 'var(--v2-bg-soft)', borderBottom: '1px solid var(--v2-border-soft)' }}>
                      <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--v2-text-subtle)', letterSpacing: '0.5px' }}>
                        {REASON_LABELS[type] ?? type} ({items.length})
                      </p>
                    </div>

                    {/* Items */}
                    {items.map((contact) => (
                      <div
                        key={contact.id}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--v2-border-soft)',
                          transition: 'background 0.1s',
                        }}
                      >
                        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>
                          {contact.patient_name}
                        </p>
                        <p style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
                          {contact.appointment_date
                            ? format(parseISO(contact.appointment_date), "EEE d MMM, h:mm a", { locale: es })
                            : 'Sin fecha'}
                          {contact.doctor_name && ` · ${contact.doctor_name}`}
                          {' · '}
                          {formatPhone(contact.patient_phone)}
                        </p>
                        <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>
                          {contact.reason_text}
                        </p>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                          <button
                            onClick={() => openWhatsApp(contact)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: 'none',
                              cursor: 'pointer',
                              background: '#25D366',
                              color: '#fff',
                              fontFamily: 'var(--font-manrope), sans-serif',
                            }}
                          >
                            <ExternalLink size={11} />
                            Abrir WhatsApp
                          </button>

                          <button
                            disabled
                            title="Proximamente — por ahora abri WhatsApp manual"
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: '1px solid var(--v2-border)',
                              background: 'var(--v2-bg-soft)',
                              color: 'var(--v2-text-subtle)',
                              cursor: 'not-allowed',
                              fontFamily: 'var(--font-manrope), sans-serif',
                              opacity: 0.5,
                            }}
                          >
                            Reenviar
                          </button>

                          <div style={{ flex: 1 }} />

                          <button
                            onClick={() => handleMarkContacted(contact.id)}
                            disabled={marking === contact.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: '1px solid var(--v2-border)',
                              background: 'transparent',
                              color: 'var(--v2-text-muted)',
                              cursor: marking === contact.id ? 'wait' : 'pointer',
                              fontFamily: 'var(--font-manrope), sans-serif',
                            }}
                          >
                            <Check size={12} />
                            Contactada
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {/* History section */}
                {history.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 16px',
                        background: 'var(--v2-bg-soft)',
                        borderBottom: '1px solid var(--v2-border-soft)',
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-manrope), sans-serif',
                      }}
                    >
                      <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--v2-text-subtle)', letterSpacing: '0.5px' }}>
                        Historico ({history.length})
                      </p>
                      <ChevronDown
                        size={12}
                        style={{
                          color: 'var(--v2-text-subtle)',
                          transition: 'transform 0.15s',
                          transform: showHistory ? 'rotate(180deg)' : 'none',
                        }}
                      />
                    </button>

                    {showHistory && history.map((contact) => (
                      <div
                        key={contact.id}
                        style={{
                          padding: '10px 16px',
                          borderBottom: '1px solid var(--v2-border-soft)',
                          opacity: 0.6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>
                            {contact.patient_name}
                          </p>
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: contact.resolution_method === 'manual_whatsapp' ? 'var(--v2-green-soft)' : 'var(--v2-bg-deeper)',
                            color: contact.resolution_method === 'manual_whatsapp' ? 'var(--v2-green-deep)' : 'var(--v2-text-subtle)',
                          }}>
                            {contact.resolution_method === 'manual_whatsapp' ? 'Contactada' : 'Expirada'}
                          </span>
                        </div>
                        <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>
                          {contact.resolved_at && formatDistanceToNow(new Date(contact.resolved_at), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--v2-border-soft)', textAlign: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>
              Marca como contactada al enviar el mensaje
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
