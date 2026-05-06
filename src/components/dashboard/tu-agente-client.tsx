'use client'

// ============================================================
// TuAgenteClient — All sections of /dashboard/tu-agente
// ============================================================

import { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import { MessageSquare, Zap, Calendar, CheckCircle, Sparkles, Play, ExternalLink, Clock, AlertTriangle, Shield } from 'lucide-react'
import { updateAgentPersonality, updateEscalationKeywords, updateAutomations } from '@/app/actions/agent-config'
import type { WhatsAppAutomations } from '@/types/database'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

interface Props {
  agentName: string
  agentPersonality: string
  welcomeMessage: string
  clinicInfo: string
  whatsappConnected: boolean
  whatsappPhoneDisplay: string | null
  whatsappPhoneId: string | null
  whatsappConnectedAt: string | null
  escalationKeywords: string[]
  automations: WhatsAppAutomations
  metrics: {
    messagesToday: number
    activeConversations: number
    appointmentsBooked30d: number
    resolvedWithoutHumanPct: number
  }
  clinicId: string
}

const PERSONALITY_OPTIONS = [
  { key: 'formal', emoji: '🎩', title: 'Formal', desc: 'Usa "usted", distancia profesional', dbValue: 'formal' },
  { key: 'calido', emoji: '💛', title: 'Calido', desc: 'Tutea, cercano, usa emojis', dbValue: 'profesional y amable' },
  { key: 'directo', emoji: '⚡', title: 'Directo', desc: 'Conciso, sin rodeos', dbValue: 'directo' },
]

function getPersonalityKey(dbValue: string): string {
  if (dbValue === 'formal') return 'formal'
  if (dbValue === 'directo') return 'directo'
  return 'calido'
}

function getTagline(personality: string): string {
  if (personality === 'formal') return 'Asistente profesional. Agenda con precision, escala con cordialidad.'
  if (personality === 'directo') return 'Asistente eficiente. Agenda rápido, escala sin rodeos.'
  return 'Asistente calido. Agenda con calidez, escala cuando hace falta.'
}

export function TuAgenteClient(props: Props) {
  const [keywords, setKeywords] = useState(props.escalationKeywords)
  const [automations, setAutomations] = useState(props.automations)
  const [personalityKey, setPersonalityKey] = useState(getPersonalityKey(props.agentPersonality))
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const keywordRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleAddKeyword() {
    const input = keywordRef.current
    if (!input) return
    const kw = input.value.trim().toLowerCase()
    if (kw && !keywords.includes(kw)) {
      const newKw = [...keywords, kw]
      const prevKw = [...keywords]
      setKeywords(newKw)
      input.value = ''
      startTransition(async () => {
        const result = await updateEscalationKeywords(newKw)
        if (result.success) showToast('Keyword guardada')
        else { setKeywords(prevKw); showToast(result.error ?? 'Error guardando') }
      })
    }
  }

  function handleRemoveKeyword(kw: string) {
    const newKw = keywords.filter((k) => k !== kw)
    const prevKw = [...keywords]
    setKeywords(newKw)
    startTransition(async () => {
      const result = await updateEscalationKeywords(newKw)
      if (result.success) showToast('Keyword eliminada')
      else { setKeywords(prevKw); showToast(result.error ?? 'Error guardando') }
    })
  }

  function handlePersonalityChange(key: string) {
    const opt = PERSONALITY_OPTIONS.find((o) => o.key === key)
    if (!opt) return
    const prevKey = personalityKey
    setPersonalityKey(key)
    startTransition(async () => {
      const result = await updateAgentPersonality(opt.dbValue)
      if (result.success) showToast('Tono actualizado')
      else { setPersonalityKey(prevKey); showToast(result.error ?? 'Error guardando') }
    })
  }

  function handleToggleAutomation(field: 'post_consulta' | 'reactivacion') {
    const prevAuto = { ...automations }
    const newAuto = {
      ...automations,
      [field]: { ...automations[field], enabled: !automations[field].enabled },
    }
    setAutomations(newAuto)
    startTransition(async () => {
      const result = await updateAutomations({
        post_consulta: newAuto.post_consulta.enabled,
        reactivacion: newAuto.reactivacion.enabled,
      })
      if (result.success) showToast('Automatizacion guardada')
      else { setAutomations(prevAuto); showToast(result.error ?? 'Error guardando') }
    })
  }

  return (
    <div className="space-y-6" style={{ fontFamily: 'var(--font-manrope), sans-serif', maxWidth: '1100px' }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl" style={{ fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>
          Tu{' '}
          <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontWeight: 400, background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            agente
          </span>
        </h1>
        <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
          Personalidad, conexion y comportamiento de {props.agentName}
        </p>
      </div>

      {/* ===== HERO ===== */}
      <div
        style={{
          borderRadius: 'var(--v2-radius-xl)',
          padding: '28px 32px',
          background: 'linear-gradient(135deg, #0F0A1F, #1A0F33, #2A1547)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(107,91,255,0.15), transparent 50%), radial-gradient(circle at 80% 50%, rgba(255,107,170,0.1), transparent 50%)', pointerEvents: 'none' }} />

        <div className="flex flex-col sm:flex-row gap-6 items-start" style={{ position: 'relative' }}>
          {/* Avatar + info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '22px', background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(107,91,255,0.3)' }}>
                <span style={{ color: '#fff', fontSize: '30px', fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}>
                  {props.agentName.charAt(0).toLowerCase()}
                </span>
              </div>
              <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '14px', height: '14px', borderRadius: '50%', background: 'var(--v2-green)', border: '3px solid #1A0F33' }} />
            </div>

            <div>
              <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>{props.agentName}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: 'rgba(52,199,123,0.2)', color: 'var(--v2-green)' }}>● Activo</span>
              </div>
              <p style={{ fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)', marginTop: '6px' }}>
                {getTagline(PERSONALITY_OPTIONS.find((o) => o.key === personalityKey)?.dbValue ?? '')}
              </p>
            </div>
          </div>

          {/* Placeholder buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <button
              disabled
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', borderRadius: '10px', fontSize: '12px', fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'not-allowed' }}
              title="Proximamente"
            >
              <Play size={14} /> Probar agente
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" style={{ marginTop: '24px', position: 'relative' }}>
          {[
            { label: 'Mensajes hoy', value: String(props.metrics.messagesToday), icon: <MessageSquare size={14} /> },
            { label: 'Conversaciones', value: String(props.metrics.activeConversations), icon: <Sparkles size={14} /> },
            { label: 'Respuesta', value: '~3s', icon: <Zap size={14} /> },
            { label: 'Resueltas solo', value: `${props.metrics.resolvedWithoutHumanPct}%`, icon: <CheckCircle size={14} /> },
          ].map((s) => (
            <div key={s.label} style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
                {s.icon}
                <span style={{ fontSize: '10px', fontWeight: 600 }}>{s.label}</span>
              </div>
              <p style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: '#fff' }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ===== CONNECTION ===== */}
      <SectionCard eyebrow="CONEXION" title="Como se conecta el agente" desc="El agente vive en WhatsApp Business">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* WhatsApp */}
          <div style={{ padding: '20px', borderRadius: 'var(--v2-radius)', background: props.whatsappConnected ? 'var(--v2-green-soft)' : 'var(--v2-amber-soft)', border: `1px solid ${props.whatsappConnected ? 'rgba(52,199,123,0.2)' : 'rgba(255,184,69,0.2)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--v2-whatsapp)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageSquare size={18} style={{ color: '#fff' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>WhatsApp Business</p>
                <p style={{ fontSize: '11px', fontWeight: 600, color: props.whatsappConnected ? 'var(--v2-green-deep)' : '#b07d00' }}>
                  {props.whatsappConnected ? '● Conectado' : '● Desconectado'}
                </p>
              </div>
            </div>
            {props.whatsappConnected && (
              <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {props.whatsappPhoneDisplay && <p>Número: {props.whatsappPhoneDisplay}</p>}
                {props.whatsappConnectedAt && <p>Conectado {formatDistanceToNow(new Date(props.whatsappConnectedAt), { addSuffix: true, locale: es })}</p>}
              </div>
            )}
            <Link href="/dashboard/settings/whatsapp" style={{ display: 'inline-block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none', marginTop: '10px' }}>
              {props.whatsappConnected ? 'Editar credenciales →' : 'Conectar ahora →'}
            </Link>
          </div>

          {/* Instagram placeholder */}
          <div style={{ padding: '20px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)', border: '1px solid var(--v2-border-soft)', opacity: 0.7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #833AB4, #E1306C, #F77737)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: '14px' }}>IG</span>
              </div>
              <div>
                <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>Instagram DMs</p>
                <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>Proximamente</p>
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>Conecta Instagram para que el agente responda DMs</p>
          </div>
        </div>
      </SectionCard>

      {/* ===== PERSONALITY ===== */}
      <SectionCard eyebrow="PERSONALIDAD" title="Como habla tu agente" desc="Define el tono y la forma de hablar con tus pacientes">
        {/* Agent name (read-only) */}
        <ReadOnlyField label="Nombre del agente" value={props.agentName} helper="Asi se presenta a tus pacientes" linkHref="/dashboard/settings/clinic" linkText="Editar" />

        {/* Tone selector */}
        <div style={{ marginTop: '20px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)', marginBottom: '10px' }}>Tono de voz</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PERSONALITY_OPTIONS.map((opt) => {
              const isSelected = personalityKey === opt.key
              return (
                <button
                  key={opt.key}
                  onClick={() => handlePersonalityChange(opt.key)}
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--v2-radius)',
                    border: isSelected ? '2px solid var(--v2-primary)' : '1px solid var(--v2-border-soft)',
                    background: isSelected ? 'var(--v2-primary-soft)' : 'var(--v2-bg-card)',
                    boxShadow: isSelected ? 'var(--v2-shadow-sm)' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--font-manrope), sans-serif',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '28px' }}>{opt.emoji}</span>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)', marginTop: '8px' }}>{opt.title}</p>
                  <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>{opt.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Welcome message (read-only) */}
        <div style={{ marginTop: '20px' }}>
          <ReadOnlyField label="Mensaje de bienvenida" value={props.welcomeMessage || 'No configurado'} helper="Primer mensaje a paciente nuevo" linkHref="/dashboard/settings/clinic" linkText="Editar" />
        </div>

        {/* Clinic info (read-only) */}
        <div style={{ marginTop: '12px' }}>
          <ReadOnlyField label="Información de contexto" value={props.clinicInfo || 'No configurado'} helper="Datos adicionales que el agente debe saber" linkHref="/dashboard/settings/clinic" linkText="Editar" />
        </div>
      </SectionCard>

      {/* ===== ESCALATION ===== */}
      <SectionCard eyebrow="ESCALAMIENTO" title="Cuando Omu pasa la conversacion a humano" desc="El agente escala automaticamente cuando detecta estas situaciones">
        {/* Hardcoded rules */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {[
            { icon: <AlertTriangle size={14} />, title: 'Emergencia medica', desc: 'Dolor fuerte, sangrado, emergencia', color: 'var(--v2-red)' },
            { icon: <Shield size={14} />, title: 'Ideacion suicida', desc: 'Siempre escala inmediatamente', color: 'var(--v2-pink)' },
            { icon: <MessageSquare size={14} />, title: 'Peticion de humano', desc: '"Quiero hablar con alguien", "persona real"', color: 'var(--v2-primary)' },
          ].map((rule) => (
            <div key={rule.title} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '10px', background: 'var(--v2-bg-soft)' }}>
              <span style={{ color: rule.color }}>{rule.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{rule.title}</p>
                <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>{rule.desc}</p>
              </div>
              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--v2-text-subtle)', background: 'var(--v2-bg-deeper)', padding: '2px 8px', borderRadius: '4px' }}>Siempre activa</span>
            </div>
          ))}
        </div>

        {/* Custom keywords */}
        <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>Tus palabras clave</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
          {keywords.map((kw) => (
            <span key={kw} className="tag-v2 tag-v2-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              {kw}
              <button onClick={() => handleRemoveKeyword(kw)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-primary)', fontSize: '14px', padding: 0, lineHeight: 1 }}>&times;</button>
            </span>
          ))}
          {keywords.length === 0 && <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', fontStyle: 'italic' }}>Sin palabras personalizadas</p>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            ref={keywordRef}
            type="text"
            placeholder="Escribe y presiona Enter..."
            className="input-v2"
            style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword() } }}
          />
          <button onClick={handleAddKeyword} className="btn-v2-secondary" style={{ fontSize: '12px', padding: '8px 14px' }}>Agregar</button>
        </div>
        <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '6px' }}>Ejemplos: "queja", "reclamo", "cambio EPS"</p>
      </SectionCard>

      {/* ===== AUTOMATIONS ===== */}
      <SectionCard eyebrow="AUTOMATIZACIONES" title="Lo que el agente hace automaticamente" desc="Acciones que toma sin tu intervencion">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <ToggleRow
            title="Mensaje post-consulta"
            desc="Pregunta al paciente como se sintio 24h despues de la cita"
            enabled={automations.post_consulta.enabled}
            onToggle={() => handleToggleAutomation('post_consulta')}
          />
          <ToggleRow
            title="Reactivar pacientes inactivos"
            desc={`Mensaje automático a pacientes sin visita hace ${automations.reactivacion.days_inactive} días`}
            enabled={automations.reactivacion.enabled}
            onToggle={() => handleToggleAutomation('reactivacion')}
          />
        </div>
      </SectionCard>

      {/* ===== TEMPLATES (read-only) ===== */}
      <SectionCard eyebrow="PLANTILLAS" title="Mensajes automáticos" desc="Estos mensajes se envían automáticamente">
        <div style={{ padding: '12px 16px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-primary-tint)', border: '1px solid var(--v2-primary-soft)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={14} style={{ color: 'var(--v2-primary)' }} />
          <p style={{ fontSize: '12px', color: 'var(--v2-primary)', fontWeight: 600 }}>Pronto podras editarlos. Por ahora estan optimizados por nuestro equipo.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TemplateCard icon="⏰" bg="var(--v2-primary-soft)" title="Recordatorio 24h" meta="Se envia 24h antes" preview={'Hola {nombre} 👋 Te recordamos tu cita manana con {doctor} a las {hora}.'} />
          <TemplateCard icon="⚡" bg="var(--v2-pink-soft)" title="Recordatorio 2h" meta="Solo alto riesgo de no-show" preview={'Hola {nombre}, tu cita es en 2 horas con {doctor}. Te esperamos.'} />
          <TemplateCard icon="✅" bg="var(--v2-green-soft)" title="Confirmacion" meta="Al agendar por WhatsApp" preview={'✅ Cita agendada: {fecha} a las {hora} con {doctor} en {clinica}.'} />
          <TemplateCard icon="🚫" bg="var(--v2-amber-soft)" title="Cancelacion" meta="Cuando se cancela por bloqueo" preview={'Hola {nombre}, lamentamos informarte que tu cita fue cancelada. Te ofrecemos estas opciones...'} />
        </div>
      </SectionCard>

      {/* ===== METRICS ===== */}
      <SectionCard eyebrow="MÉTRICAS" title="Cómo está performando el agente" desc="Últimos 30 días">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard icon={<MessageSquare size={16} />} bg="var(--v2-primary-soft)" fg="var(--v2-primary)" label="Conversaciones" value={String(props.metrics.activeConversations)} detail="activas ahora" />
          <MetricCard icon={<Zap size={16} />} bg="var(--v2-pink-soft)" fg="var(--v2-pink)" label="Respuesta" value="3.2s" detail="promedio" />
          <MetricCard icon={<CheckCircle size={16} />} bg="var(--v2-green-soft)" fg="var(--v2-green-deep)" label="Resueltas" value={`${props.metrics.resolvedWithoutHumanPct}%`} detail="sin humano" />
          <MetricCard icon={<Calendar size={16} />} bg="var(--v2-amber-soft)" fg="#b07d00" label="Citas agendadas" value={String(props.metrics.appointmentsBooked30d)} detail="por el agente" />
        </div>
      </SectionCard>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ---- Sub-components ----

function SectionCard({ eyebrow, title, desc, children }: { eyebrow: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)', padding: '22px' }}>
      <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-primary)', marginBottom: '4px' }}>{eyebrow}</p>
      <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '4px' }}>{title}</h3>
      <p style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)', marginBottom: '18px' }}>{desc}</p>
      {children}
    </div>
  )
}

function ReadOnlyField({ label, value, helper, linkHref, linkText }: { label: string; value: string; helper: string; linkHref: string; linkText: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderRadius: '10px', background: 'var(--v2-bg-soft)' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>{label}</p>
        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
        <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '1px' }}>{helper}</p>
      </div>
      <Link href={linkHref} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none', flexShrink: 0 }}>{linkText} →</Link>
    </div>
  )
}

function ToggleRow({ title, desc, enabled, onToggle }: { title: string; desc: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--v2-border-soft)' }}>
      <div>
        <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>{title}</p>
        <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>{desc}</p>
      </div>
      <button
        onClick={onToggle}
        className="toggle-v2"
        data-active={enabled ? 'true' : 'false'}
        style={{ flexShrink: 0 }}
      />
    </div>
  )
}

function TemplateCard({ icon, bg, title, meta, preview }: { icon: string; bg: string; title: string; meta: string; preview: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 'var(--v2-radius)', border: '1px solid var(--v2-border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>{icon}</div>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{title}</p>
          <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)' }}>{meta}</p>
        </div>
      </div>
      <p style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', lineHeight: 1.4, fontStyle: 'italic' }}>{preview}</p>
    </div>
  )
}

function MetricCard({ icon, bg, fg, label, value, detail }: { icon: React.ReactNode; bg: string; fg: string; label: string; value: string; detail: string }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius)', boxShadow: 'var(--v2-shadow-sm)', padding: '16px' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: fg, marginBottom: '10px' }}>{icon}</div>
      <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)' }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>{value}</p>
      <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>{detail}</p>
    </div>
  )
}
