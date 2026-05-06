'use client'

// ============================================================
// Landing Page — Omuwan "Soft Tech Amigable"
// Completa: Nav, Hero, Social Proof, Problem, Solution,
// Features, How it Works, Pricing, FAQ, Final CTA, Footer
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingDown,
  Calendar,
  Zap,
  MessageSquare,
  Clock,
  AlertTriangle,
  Shield,
  RefreshCw,
  BarChart2,
  Check,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react'

// ---- Shared styles ----

const GRADIENT_TEXT: React.CSSProperties = {
  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const SERIF_ACCENT: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: 'italic',
  fontWeight: 400,
  ...GRADIENT_TEXT,
}

const SECTION_EYEBROW: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  color: 'var(--v2-primary)',
  marginBottom: '12px',
}

// ---- MAIN COMPONENT ----

export function LandingPage() {
  return (
    <div
      style={{
        fontFamily: 'var(--font-manrope), -apple-system, sans-serif',
        color: 'var(--v2-text)',
        background: 'var(--v2-bg)',
        minHeight: '100vh',
      }}
    >
      <Nav />
      <Hero />
      <Problem />
      <Solution />
      <Features />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  )
}

// ============================================================
// 1. NAV
// ============================================================

const NAV_LINKS = [
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'Features', href: '#features' },
  { label: 'Precios', href: '#precios' },
  { label: 'Preguntas', href: '#faq' },
]

function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(251, 250, 253, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--v2-border-soft)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px', height: '64px', display: 'flex', alignItems: 'center' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '40px' }}>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(107, 91, 255, 0.25)',
            }}
          >
            <span style={{ color: '#fff', fontWeight: 800, fontSize: '13px' }}>O</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: '18px', color: 'var(--v2-text)', letterSpacing: '-0.3px' }}>
            Omuwan
          </span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex" style={{ gap: '28px', flex: 1 }}>
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{ fontSize: '14px', fontWeight: 500, color: 'var(--v2-text-muted)', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--v2-text)' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--v2-text-muted)' }}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex" style={{ gap: '12px', alignItems: 'center' }}>
          <Link href="/login" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)', textDecoration: 'none' }}>
            Ingresar
          </Link>
          <Link href="/register/invite" className="btn-v2-secondary" style={{ fontSize: '13px', padding: '8px 20px' }}>
            Crear cuenta
          </Link>
          <a href="mailto:hola@omuwan.co" className="btn-v2-primary" style={{ fontSize: '13px', padding: '8px 20px' }}>
            Solicitar demo
          </a>
        </div>

        {/* Mobile hamburger */}
        <div className="flex md:hidden" style={{ marginLeft: 'auto', gap: '12px', alignItems: 'center' }}>
          <a href="mailto:hola@omuwan.co" className="btn-v2-primary" style={{ fontSize: '12px', padding: '7px 14px' }}>
            Demo
          </a>
          <button onClick={() => setMobileOpen(!mobileOpen)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text)' }}>
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden" style={{ padding: '8px 24px 16px', borderTop: '1px solid var(--v2-border-soft)' }}>
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              style={{ display: 'block', padding: '10px 0', fontSize: '14px', fontWeight: 500, color: 'var(--v2-text-muted)', textDecoration: 'none' }}
            >
              {l.label}
            </a>
          ))}
          <Link href="/login" style={{ display: 'block', padding: '10px 0', fontSize: '14px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none' }}>
            Ingresar
          </Link>
          <Link href="/register/invite" style={{ display: 'block', padding: '10px 0', fontSize: '14px', fontWeight: 600, color: 'var(--v2-text)', textDecoration: 'none' }}>
            Crear cuenta
          </Link>
        </div>
      )}
    </nav>
  )
}

// ============================================================
// 2. HERO
// ============================================================

function Hero() {
  return (
    <section
      style={{
        padding: '90px 24px 80px',
        backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(107, 91, 255, 0.06), transparent 50%), radial-gradient(circle at 100% 100%, rgba(255, 107, 170, 0.04), transparent 50%)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }} className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        {/* Left */}
        <div>
          {/* Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '999px',
              background: 'var(--v2-green-soft)',
              marginBottom: '24px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--v2-green-deep)',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--v2-green)' }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--v2-green)' }} />
            </span>
            Diseñado para clínicas en Colombia
          </div>

          {/* H1 */}
          <h1
            className="text-4xl sm:text-5xl lg:text-[56px]"
            style={{
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              color: 'var(--v2-text)',
              marginBottom: '20px',
            }}
          >
            El agente de WhatsApp que{' '}
            <span style={SERIF_ACCENT}>agenda tus citas</span>{' '}
            mientras tú atiendes pacientes.
          </h1>

          {/* Subhead */}
          <p style={{ fontSize: '17px', lineHeight: 1.6, color: 'var(--v2-text-muted)', maxWidth: '520px', marginBottom: '32px' }}>
            Tus pacientes agendan, confirman y reagendan solos por WhatsApp.
            Tu equipo deja de copiar citas a mano y reduce los no-shows.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '28px' }}>
            <a
              href="mailto:hola@omuwan.co"
              className="btn-v2-primary"
              style={{ fontSize: '15px', padding: '13px 28px', fontWeight: 700 }}
            >
              Solicitar demo gratuita
            </a>
            <a
              href="#como-funciona"
              className="btn-v2-secondary"
              style={{ fontSize: '15px', padding: '13px 28px' }}
            >
              Ver cómo funciona
            </a>
          </div>

          {/* Trust signals */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
            {['Sin tarjeta', 'Implementación rápida', 'Cancela cuando quieras'].map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={14} style={{ color: 'var(--v2-green)' }} />
                <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--v2-text-subtle)' }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Phone mockup */}
        <div className="hidden sm:flex" style={{ justifyContent: 'center', position: 'relative' }}>
          <PhoneMockup />
          {/* Floating cards */}
          <FloatingCard top="50%" right="-30px" value="24/7" color="var(--v2-primary)" icon={<Clock size={14} />} label="Disponible" delay="0s" />
        </div>
      </div>
    </section>
  )
}

// ---- Phone mockup ----

const CHAT_MESSAGES = [
  { role: 'patient', text: 'Hola, quiero agendar una cita con el Dr. Martinez' },
  { role: 'bot', text: '¡Hola! Soy Omu, asistente de tu clínica. ¿Qué tipo de consulta necesitas?' },
  { role: 'patient', text: 'Histeroscopia' },
  { role: 'bot', text: 'Perfecto. ¿Manejas alguna EPS o sería particular?' },
  { role: 'patient', text: 'Coomeva' },
  { role: 'bot', text: 'Tengo estos espacios esta semana:\n\n📅 Mie 30 · 10:00 AM\n📅 Jue 1 · 2:00 PM\n📅 Vie 2 · 9:00 AM' },
  { role: 'patient', text: 'Mie 30 · 10 AM' },
  { role: 'bot', text: '¡Listo! Tu cita quedó agendada.\n\n📅 Mie 30 abril\n🕐 10:00 AM\n👨‍⚕️ Dr. Martínez\n📍 Centro Médico' },
]

function PhoneMockup() {
  return (
    <div
      style={{
        width: '300px',
        height: '520px',
        borderRadius: '36px',
        background: '#000',
        padding: '12px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', height: '100%', borderRadius: '26px', overflow: 'hidden', background: '#ECE5DD', display: 'flex', flexDirection: 'column' }}>
        {/* WA Header */}
        <div style={{ background: '#075E54', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '13px', fontStyle: 'italic', fontFamily: "'Instrument Serif', serif" }}>o</span>
          </div>
          <div>
            <p style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>Omu · Tu Clínica</p>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px' }}>en línea</p>
          </div>
        </div>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {CHAT_MESSAGES.map((msg, i) => (
            <div
              key={i}
              style={{
                alignSelf: msg.role === 'patient' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: msg.role === 'patient' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                background: msg.role === 'patient' ? '#DCF8C6' : '#fff',
                fontSize: '11.5px',
                lineHeight: 1.4,
                color: '#111',
                whiteSpace: 'pre-line',
              }}
            >
              {msg.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Floating card ----

function FloatingCard({
  top, bottom, left, right, value, color, icon, label, delay,
}: {
  top?: string; bottom?: string; left?: string; right?: string
  value: string; color: string; icon: React.ReactNode; label: string; delay: string
}) {
  return (
    <div
      className="hidden lg:flex"
      style={{
        position: 'absolute',
        top, bottom, left, right,
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: '14px',
        padding: '10px 14px',
        boxShadow: 'var(--v2-shadow)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        animation: `landingFloat 4s ease-in-out ${delay} infinite`,
        zIndex: 2,
      }}
    >
      <div style={{ color }}>{icon}</div>
      <div>
        <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontWeight: 800, fontSize: '15px', color, lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>{label}</p>
      </div>
    </div>
  )
}

// ============================================================
// 3. SOCIAL PROOF
// ============================================================

const STATS = [
  { value: '9,200+', label: 'Mensajes' },
  { value: '87%', label: 'Resueltos' },
  { value: '3.2s', label: 'Respuesta' },
  { value: '$1.8M', label: 'Recuperados' },
]

function SocialProof() {
  return (
    <section style={{ padding: '50px 24px', borderBottom: '1px solid var(--v2-border-soft)' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--v2-text-subtle)', marginBottom: '28px' }}>
          Resultados reales en clinicas reales
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-3xl sm:text-4xl" style={{ fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', ...GRADIENT_TEXT, letterSpacing: '-0.02em' }}>
                {s.value}
              </p>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text-subtle)', marginTop: '4px' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 4. PROBLEM
// ============================================================

const PROBLEMS = [
  {
    emoji: '😩',
    title: 'Tu equipo responde lo mismo todo el día',
    desc: '"¿Cuánto cuesta?" "¿Dónde quedan?" "¿Hay cita para mañana?" — todo el día, todos los días.',
    cost: '~3 horas/día perdidas',
  },
  {
    emoji: '📉',
    title: 'Los pacientes no confirman y no llegan',
    desc: 'Nadie confirma, el slot se pierde. El 20-35% de tus citas son no-shows.',
    cost: '~$2.5M COP/mes perdidos',
  },
  {
    emoji: '😤',
    title: 'Tu agenda se desborda los lunes',
    desc: 'Pacientes que escriben el fin de semana no reciben respuesta. El lunes es un caos.',
    cost: 'Estrés operativo',
  },
]

function Problem() {
  return (
    <section id="problema" style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <p style={SECTION_EYEBROW}>El problema</p>
        <h2 className="text-3xl sm:text-4xl" style={{ fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '12px' }}>
          Tu secretaria{' '}
          <span style={SERIF_ACCENT}>se está ahogando</span>{' '}
          en mensajes.
        </h2>
        <p style={{ fontSize: '17px', color: 'var(--v2-text-muted)', maxWidth: '600px', marginBottom: '48px', lineHeight: 1.6 }}>
          Mientras más crece tu consultorio, más WhatsApps llegan. Y el equipo no da abasto.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PROBLEMS.map((p) => (
            <div
              key={p.title}
              style={{
                background: 'var(--v2-bg-card)',
                border: '1px solid var(--v2-border-soft)',
                borderRadius: 'var(--v2-radius-lg)',
                padding: '28px 24px 20px',
                boxShadow: 'var(--v2-shadow-sm)',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--v2-shadow)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)' }}
            >
              <span style={{ fontSize: '28px' }}>{p.emoji}</span>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginTop: '12px', marginBottom: '8px' }}>{p.title}</h3>
              <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)', lineHeight: 1.5, marginBottom: '16px' }}>{p.desc}</p>
              <div style={{ borderTop: '1px dashed var(--v2-border)', paddingTop: '12px' }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-red)' }}>{p.cost}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 5. SOLUTION (dark section)
// ============================================================

function Solution() {
  return (
    <section style={{ padding: '0 24px' }}>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          borderRadius: '32px',
          background: 'linear-gradient(180deg, #0F0A1F, #1A0F33, #2A1547)',
          padding: '80px 40px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(107, 91, 255, 0.15), transparent 50%), radial-gradient(circle at 80% 70%, rgba(255, 107, 170, 0.1), transparent 50%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', textAlign: 'center', maxWidth: '700px', margin: '0 auto' }}>
          <p style={{ ...SECTION_EYEBROW, color: 'rgba(255,255,255,0.5)' }}>La solución</p>
          <h2
            className="text-3xl sm:text-4xl lg:text-5xl"
            style={{ fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', marginBottom: '40px', lineHeight: 1.1 }}
          >
            Imaginate un agente que{' '}
            <span style={{ ...SERIF_ACCENT, WebkitTextFillColor: 'transparent' }}>nunca duerme</span>,{' '}
            nunca se enferma y conoce tu clínica mejor que nadie.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              { value: '24/7', label: 'Disponible' },
              { value: '<5s', label: 'Tiempo de respuesta' },
              { value: '∞', label: 'Paciencia' },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '16px',
                  padding: '24px 16px',
                }}
              >
                <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '28px', fontWeight: 800, color: '#fff' }}>{s.value}</p>
                <p style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 6. FEATURES
// ============================================================

const FEATURES = [
  { icon: <Clock size={20} />, title: 'Recordatorios inteligentes', desc: 'Reduce los no-shows con recordatorios automáticos 72h, 24h y 2h antes.', color: 'var(--v2-amber)' },
  { icon: <AlertTriangle size={20} />, title: 'Escalamiento automático', desc: 'Sabe cuándo pasarte la conversación. Emergencias, dudas complejas, peticiones de humano.', color: 'var(--v2-red)' },
  { icon: <RefreshCw size={20} />, title: 'Cancela y reagenda con empatia', desc: 'Si un paciente cancela, ofrece alternativas y libera el slot para otro.', color: 'var(--v2-green)' },
  { icon: <BarChart2 size={20} />, title: 'Dashboard operativo', desc: 'Sabes que pasa en tu consultorio: citas, no-shows, conversaciones, en tiempo real.', color: 'var(--v2-primary)' },
]

function Features() {
  return (
    <section id="features" style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <p style={SECTION_EYEBROW}>Cómo lo hace</p>
        <h2 className="text-3xl sm:text-4xl" style={{ fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '48px' }}>
          No es un chatbot. Es un{' '}
          <span style={SERIF_ACCENT}>asistente de consultorio real</span>.
        </h2>

        {/* Large feature */}
        <div
          style={{
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-xl)',
            padding: '36px',
            marginBottom: '20px',
            boxShadow: 'var(--v2-shadow-sm)',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <MessageSquare size={20} style={{ color: 'var(--v2-primary)' }} />
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-primary)' }}>Feature principal</span>
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '8px' }}>Conoce tu clínica como tu mejor secretaria</h3>
              <p style={{ fontSize: '15px', color: 'var(--v2-text-muted)', lineHeight: 1.6 }}>
                Sabe tus horarios, tus doctores, tus precios, tus EPS. Responde preguntas frecuentes, agenda citas verificando disponibilidad real. Diseñado para no inventar información — si no sabe algo, escala a tu equipo.
              </p>
            </div>
            <div style={{ background: 'var(--v2-bg-soft)', borderRadius: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  { r: 'patient', t: '¿Cuánto cuesta la cita?' },
                  { r: 'bot', t: 'La consulta con el Dr. Martínez tiene un valor de $180.000 COP. ¿Te gustaría agendar?' },
                  { r: 'patient', t: 'Si, mañana en la tarde' },
                  { r: 'bot', t: 'Tengo disponible a las 2:00 PM y 4:00 PM. ¿Cuál prefieres?' },
                ].map((m, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: m.r === 'patient' ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                      padding: '8px 12px',
                      borderRadius: '10px',
                      background: m.r === 'patient' ? '#DCF8C6' : '#fff',
                      fontSize: '12.5px',
                      color: '#111',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    {m.t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Small feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{
                background: 'var(--v2-bg-card)',
                border: '1px solid var(--v2-border-soft)',
                borderRadius: 'var(--v2-radius-lg)',
                padding: '24px 20px',
                boxShadow: 'var(--v2-shadow-sm)',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--v2-shadow)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)' }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: `${f.color}18`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: f.color,
                  marginBottom: '14px',
                }}
              >
                {f.icon}
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>{f.title}</h3>
              <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)', lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 7. HOW IT WORKS
// ============================================================

const STEPS = [
  { num: '1', title: 'Solicita tu demo', desc: 'En 15 minutos te mostramos cómo funciona con tu clínica real.', color: 'var(--v2-primary)' },
  { num: '2', title: 'Tú tienes el control', desc: 'Horarios, doctores, precios, EPS, FAQ. Cambios en tiempo real, sin pedir ayuda técnica.', color: 'var(--v2-pink)' },
  { num: '3', title: 'Conectamos tu WhatsApp', desc: 'Tu agente empieza a atender pacientes desde el día 1.', color: 'var(--v2-green)' },
]

function HowItWorks() {
  return (
    <section id="como-funciona" style={{ padding: '80px 24px', background: 'var(--v2-bg-soft)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
        <p style={SECTION_EYEBROW}>Implementación</p>
        <h2 className="text-3xl sm:text-4xl" style={{ fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '56px' }}>
          De cero a operando{' '}
          <span style={SERIF_ACCENT}>rápido</span>.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 relative">
          {/* Connecting line */}
          <div className="hidden sm:block absolute top-[28px] left-[16.5%] right-[16.5%] h-[2px]" style={{ background: 'linear-gradient(90deg, var(--v2-primary), var(--v2-pink), var(--v2-green))' }} />

          {STEPS.map((s) => (
            <div key={s.num} style={{ position: 'relative' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${s.color}, ${s.color}CC)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  boxShadow: `0 4px 16px ${s.color}40`,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <span style={{ color: '#fff', fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace' }}>{s.num}</span>
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{s.title}</h3>
              <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', lineHeight: 1.5 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 8. PRICING
// ============================================================

const PLANS = [
  { name: 'Solo', doctors: '1 médico', price: '$390k', features: ['Agente WhatsApp 24/7', 'Recordatorios automáticos', 'Dashboard operativo', 'Soporte por chat'] },
  { name: 'Equipo', doctors: '2-3 médicos', price: '$620k', featured: true, features: ['Todo en Solo', 'Multi-doctor', 'Horarios individuales', 'Soporte prioritario'] },
  { name: 'Clínica', doctors: '4-6 médicos', price: '$850k', features: ['Todo en Equipo', 'Onboarding dedicado'] },
  { name: 'Red', doctors: '7-10 médicos', price: '$1.090k', features: ['Todo en Clínica', 'Multi-sede', 'Account manager'] },
]

function Pricing() {
  return (
    <section id="precios" style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <p style={SECTION_EYEBROW}>Precios</p>
          <h2 className="text-3xl sm:text-4xl" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Planes que{' '}
            <span style={SERIF_ACCENT}>crecen contigo</span>.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              style={{
                background: 'var(--v2-bg-card)',
                border: plan.featured ? '2px solid var(--v2-primary)' : '1px solid var(--v2-border-soft)',
                borderRadius: 'var(--v2-radius-xl)',
                padding: '28px 22px',
                boxShadow: plan.featured ? 'var(--v2-shadow)' : 'var(--v2-shadow-sm)',
                transform: plan.featured ? 'scale(1.04)' : 'none',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { if (!plan.featured) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--v2-shadow)' } }}
              onMouseLeave={(e) => { if (!plan.featured) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)' } }}
            >
              {plan.featured && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-12px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    ...GRADIENT_TEXT,
                    background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '4px 14px',
                    borderRadius: '999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    WebkitTextFillColor: '#fff',
                  }}
                >
                  Más popular
                </div>
              )}

              <h3 style={{ fontSize: '18px', fontWeight: 800 }}>{plan.name}</h3>
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--v2-text-subtle)', marginBottom: '16px' }}>{plan.doctors}</p>

              <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {plan.price}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginBottom: '20px' }}>COP/mes</p>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--v2-text-muted)' }}>
                    <Check size={14} style={{ color: 'var(--v2-green)', flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href="mailto:hola@omuwan.co"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 'var(--v2-radius)',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  ...(plan.featured
                    ? { background: 'var(--v2-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(107,91,255,0.3)' }
                    : { background: 'var(--v2-bg-soft)', color: 'var(--v2-text)', border: '1px solid var(--v2-border)' }
                  ),
                }}
              >
                Empezar prueba
              </a>
            </div>
          ))}
        </div>

        {/* Enterprise bar */}
        <div
          style={{
            marginTop: '24px',
            background: 'linear-gradient(135deg, #0F0A1F, #1A0F33)',
            borderRadius: '16px',
            padding: '20px 28px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 600 }}>
            ¿Más de 10 médicos o multi-sede compleja?
          </p>
          <a
            href="mailto:hola@omuwan.co"
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#fff',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              padding: '8px 20px',
              borderRadius: '10px',
              textDecoration: 'none',
            }}
          >
            Hablemos →
          </a>
        </div>

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12.5px', color: 'var(--v2-text-subtle)' }}>
          Sin tarjeta · Cancela cuando quieras
        </p>
      </div>
    </section>
  )
}

// ============================================================
// 9. FAQ
// ============================================================

const FAQ_ITEMS = [
  { q: '¿Mis pacientes notan que es un agente, no una persona?', a: 'La mayoría no. Omuwan habla en español natural, con tono empático, emojis moderados y expresiones colombianas. Muchos pacientes agradecen al agente como si fuera humano.' },
  { q: '¿Tengo que cambiar mi número de WhatsApp?', a: 'No. Conectamos Omuwan a tu número actual vía WhatsApp Business API (Meta). Tu número sigue siendo el mismo que tus pacientes ya conocen.' },
  { q: '¿Qué pasa si Omuwan se equivoca o no entiende?', a: 'Omuwan escala la conversación a un humano si no está seguro. Está diseñado para no inventar información. Si no sabe algo, dice "Lo consulto con el consultorio" y te notifica.' },
  { q: '¿Cuánto tarda en estar funcionando?', a: 'Pocos días hábiles. Tú configuras horarios, doctores, precios, FAQ y EPS desde el dashboard.' },
  { q: '¿Mis datos médicos están seguros?', a: 'Sí. Cumplimos con la Ley 1581/2012 (Habeas Data). Los datos se almacenan con encriptación, acceso controlado por roles, y RLS (Row Level Security) para multi-tenancy.' },
  { q: '¿Funciona con iSalud, Carisma u otros sistemas?', a: 'Estamos trabajando en integraciones directas. Por ahora, sincronizamos la agenda manualmente.' },
]

function FAQ() {
  const [openIdx, setOpenIdx] = useState(0)

  return (
    <section id="faq" style={{ padding: '80px 24px', background: 'var(--v2-bg-soft)' }}>
      <div style={{ maxWidth: '750px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <p style={SECTION_EYEBROW}>Preguntas frecuentes</p>
          <h2 className="text-3xl sm:text-4xl" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Respondemos lo que{' '}
            <span style={SERIF_ACCENT}>todos preguntan</span>.
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              style={{
                background: 'var(--v2-bg-card)',
                border: '1px solid var(--v2-border-soft)',
                borderRadius: 'var(--v2-radius)',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setOpenIdx(openIdx === i ? -1 : i)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14.5px',
                  fontWeight: 600,
                  color: 'var(--v2-text)',
                  textAlign: 'left',
                  fontFamily: 'var(--font-manrope), sans-serif',
                }}
              >
                <span>{item.q}</span>
                <ChevronDown
                  size={18}
                  style={{
                    color: 'var(--v2-text-subtle)',
                    transition: 'transform 0.2s',
                    transform: openIdx === i ? 'rotate(180deg)' : 'none',
                    flexShrink: 0,
                    marginLeft: '12px',
                  }}
                />
              </button>
              {openIdx === i && (
                <div style={{ padding: '0 20px 16px' }}>
                  <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)', lineHeight: 1.6 }}>{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 10. FINAL CTA (dark section)
// ============================================================

function FinalCTA() {
  return (
    <section style={{ padding: '0 24px', marginTop: '20px' }}>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          borderRadius: '32px',
          background: 'linear-gradient(180deg, #0F0A1F, #1A0F33)',
          padding: '80px 40px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: 'radial-gradient(circle at 30% 40%, rgba(107, 91, 255, 0.15), transparent 50%), radial-gradient(circle at 70% 60%, rgba(255, 107, 170, 0.1), transparent 50%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', maxWidth: '650px', margin: '0 auto' }}>
          <h2
            className="text-3xl sm:text-4xl lg:text-5xl"
            style={{ fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', marginBottom: '16px', lineHeight: 1.1 }}
          >
            Tu equipo se merece{' '}
            <span style={{ ...SERIF_ACCENT, WebkitTextFillColor: 'transparent' }}>respirar</span>.
          </h2>
          <p style={{ fontSize: '17px', color: 'rgba(255,255,255,0.6)', marginBottom: '36px', lineHeight: 1.6 }}>
            Tus pacientes se merecen una respuesta inmediata. Conecta Omuwan y deja que tu equipo se enfoque en lo que importa.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '14px' }}>
            <a
              href="mailto:hola@omuwan.co"
              className="btn-v2-primary"
              style={{ fontSize: '15px', padding: '14px 30px', fontWeight: 700 }}
            >
              Solicitar demo gratuita
            </a>
            <a
              href="https://wa.me/573015525881?text=Hola%2C%20quiero%20conocer%20Omuwan"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '15px',
                fontWeight: 600,
                color: '#fff',
                background: 'var(--v2-whatsapp)',
                padding: '14px 24px',
                borderRadius: 'var(--v2-radius)',
                textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(37, 211, 102, 0.3)',
                transition: 'all 0.2s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.934 11.934 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.336 0-4.512-.748-6.281-2.02l-.438-.328-3.156 1.058 1.058-3.156-.328-.438A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" /></svg>
              Escribenos por WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ============================================================
// 11. FOOTER
// ============================================================

function Footer() {
  return (
    <footer style={{ padding: '60px 24px 30px', borderTop: '1px solid var(--v2-border-soft)', marginTop: '60px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '24px', height: '24px', borderRadius: '7px',
                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span style={{ color: '#fff', fontWeight: 800, fontSize: '11px' }}>O</span>
              </div>
              <span style={{ fontWeight: 800, fontSize: '15px' }}>Omuwan</span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--v2-text-subtle)', lineHeight: 1.5 }}>
              El agente WhatsApp para consultorios médicos en Colombia.
            </p>
          </div>

          {/* Producto */}
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '12px' }}>Producto</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {['Agente WhatsApp', 'Dashboard', 'Recordatorios', 'No-Shows'].map((l) => (
                <a key={l} href="#features" style={{ fontSize: '13px', color: 'var(--v2-text-muted)', textDecoration: 'none' }}>{l}</a>
              ))}
            </div>
          </div>

          {/* Empresa */}
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '12px' }}>Empresa</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <a href="mailto:hola@omuwan.co" style={{ fontSize: '13px', color: 'var(--v2-text-muted)', textDecoration: 'none' }}>Contacto</a>
              <a href="https://wa.me/573015525881" target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: 'var(--v2-text-muted)', textDecoration: 'none' }}>WhatsApp</a>
            </div>
          </div>

          {/* Legal */}
          <div>
            <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '12px' }}>Legal</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Link href="/dashboard/legal" style={{ fontSize: '13px', color: 'var(--v2-text-muted)', textDecoration: 'none' }}>Privacidad</Link>
              <Link href="/dashboard/legal" style={{ fontSize: '13px', color: 'var(--v2-text-muted)', textDecoration: 'none' }}>Terminos</Link>
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--v2-border-soft)', paddingTop: '20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px' }}>
          <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>
            &copy; 2026 Omuwan &middot; Lonco Capital S.A.S.
          </p>
          <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>
            Pereira, Colombia 🇨🇴
          </p>
        </div>
      </div>
    </footer>
  )
}
