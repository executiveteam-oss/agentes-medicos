// ============================================================
// Layout de autenticacion — Split screen v2
// Rutas: /login, /register, /forgot-password, /reset-password
// ============================================================

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        fontFamily: 'var(--font-manrope), -apple-system, sans-serif',
      }}
      className="grid-cols-1 lg:grid-cols-[1fr_1.1fr]"
    >
      {/* Form side */}
      <div
        style={{
          background: 'var(--v2-bg)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        {children}
      </div>

      {/* Visual side — hidden on mobile */}
      <div
        className="hidden lg:flex"
        style={{
          background: 'linear-gradient(180deg, #0F0A1F 0%, #1A0F33 50%, #2A1547 100%)',
          position: 'relative',
          overflow: 'hidden',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '60px 48px',
        }}
      >
        {/* Decorative gradients */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 70% 20%, rgba(107, 91, 255, 0.2), transparent 50%), radial-gradient(circle at 30% 80%, rgba(255, 107, 170, 0.12), transparent 50%)',
            pointerEvents: 'none',
          }}
        />

        {/* Content */}
        <div style={{ position: 'relative', maxWidth: '460px', width: '100%', textAlign: 'center' }}>
          {/* Eyebrow pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(10px)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.7)',
              marginBottom: '28px',
            }}
          >
            <Zap /> En vivo en tu clinica
          </div>

          <h2
            style={{
              fontSize: '38px',
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              marginBottom: '14px',
            }}
          >
            Tu agente trabajo{' '}
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                color: 'var(--v2-pink)',
              }}
            >
              mientras dormias
            </span>
            .
          </h2>

          <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: '48px' }}>
            Mientras estabas fuera, Omuwan respondio mensajes, agendo citas y cuido tu agenda.
          </p>

          {/* Preview cards */}
          <div style={{ position: 'relative', height: '280px' }}>
            <GlassCard
              top="0" left="0"
              rotate="-2deg"
              delay="0s"
              icon={<CheckIcon />}
              iconColor="var(--v2-green)"
              label="Citas agendadas anoche"
              value="+12 citas"
              valueColor="var(--v2-green)"
              detail="5 con Dra. Lina · 4 con Dr. Jose · 3 con Dra. Daniela"
            />
            <GlassCard
              top="60px" right="0"
              rotate="1deg"
              delay="1.5s"
              icon={<MsgIcon />}
              iconColor="var(--v2-primary)"
              label="Mensajes resueltos"
              value="47 conversaciones"
              valueColor="#fff"
              detail="Sin necesitar tu intervencion"
            />
            <GlassCard
              bottom="0" left="20px"
              rotate="-1deg"
              delay="3s"
              icon={<ClockIcon />}
              iconColor="var(--v2-pink)"
              label="Proxima cita"
              value="8:30 AM"
              valueColor="var(--v2-pink)"
              detail="Maria Gonzalez · Histeroscopia · Dr. Jose"
            />
          </div>
        </div>

        {/* Stats footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            padding: '20px 48px',
          }}
        >
          {[
            { value: '↓34%', label: 'No-shows' },
            { value: '87%', label: 'Resueltos' },
            { value: '3.2s', label: 'Respuesta' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <p
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: 'italic',
                  fontSize: '22px',
                  color: 'var(--v2-pink)',
                }}
              >
                {s.value}
              </p>
              <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Mini icons (inline SVG to avoid client component for layout) ----

function Zap() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function MsgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

// ---- Glass Card ----

function GlassCard({
  top, bottom, left, right, rotate, delay,
  icon, iconColor, label, value, valueColor, detail,
}: {
  top?: string; bottom?: string; left?: string; right?: string
  rotate: string; delay: string
  icon: React.ReactNode; iconColor: string
  label: string; value: string; valueColor: string; detail: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top, bottom, left, right,
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '16px 20px',
        width: '260px',
        transform: `rotate(${rotate})`,
        animation: `landingFloat 5s ease-in-out ${delay} infinite`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ color: iconColor }}>{icon}</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      </div>
      <p style={{ fontSize: '18px', fontWeight: 800, color: valueColor, fontFamily: 'var(--font-jetbrains), monospace', marginBottom: '4px' }}>
        {value}
      </p>
      <p style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{detail}</p>
    </div>
  )
}
