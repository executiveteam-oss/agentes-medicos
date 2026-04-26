// ============================================================
// Design System Preview — Omuwan v2 "Soft Tech Amigable"
// Solo accesible por URL directa, no en sidebar
// ============================================================

'use client'

import { useState } from 'react'

const COLORS = [
  { token: '--v2-bg', hex: '#FBFAFD', label: 'Background' },
  { token: '--v2-bg-card', hex: '#FFFFFF', label: 'Card' },
  { token: '--v2-bg-soft', hex: '#F4F2FB', label: 'Soft' },
  { token: '--v2-bg-tinted', hex: '#EEEAFA', label: 'Tinted' },
  { token: '--v2-bg-deeper', hex: '#E5DFF5', label: 'Deeper' },
  { token: '--v2-border', hex: '#E8E4F4', label: 'Border' },
  { token: '--v2-border-soft', hex: '#F0EDF8', label: 'Border Soft' },
]

const TEXT_COLORS = [
  { token: '--v2-text', hex: '#1A1530', label: 'Text' },
  { token: '--v2-text-muted', hex: '#6B6580', label: 'Muted' },
  { token: '--v2-text-subtle', hex: '#9590A8', label: 'Subtle' },
]

const BRAND_COLORS = [
  { token: '--v2-primary', hex: '#6B5BFF', label: 'Primary' },
  { token: '--v2-primary-deep', hex: '#5444E5', label: 'Primary Deep' },
  { token: '--v2-pink', hex: '#FF6BAA', label: 'Pink' },
  { token: '--v2-green', hex: '#34C77B', label: 'Green' },
  { token: '--v2-green-deep', hex: '#1f8a4f', label: 'Green Deep' },
  { token: '--v2-amber', hex: '#FFB845', label: 'Amber' },
  { token: '--v2-red', hex: '#FF5757', label: 'Red' },
  { token: '--v2-whatsapp', hex: '#25D366', label: 'WhatsApp' },
  { token: '--v2-whatsapp-deep', hex: '#128C7E', label: 'WhatsApp Deep' },
]

function ColorSwatch({ hex, label, token }: { hex: string; label: string; token: string }) {
  const isDark = ['#1A1530', '#5444E5', '#6B5BFF', '#128C7E', '#1f8a4f'].includes(hex)
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-16 h-16 rounded-v2-lg border border-v2-border"
        style={{ background: hex }}
      />
      <span className="text-xs font-semibold" style={{ color: 'var(--v2-text)', fontFamily: 'var(--font-manrope), sans-serif' }}>
        {label}
      </span>
      <code className="text-[10px]" style={{ color: 'var(--v2-text-subtle)', fontFamily: 'var(--font-jetbrains), monospace' }}>
        {hex}
      </code>
    </div>
  )
}

function ToggleDemo() {
  const [active, setActive] = useState(false)
  return (
    <button
      className="toggle-v2"
      data-active={active ? 'true' : 'false'}
      onClick={() => setActive(!active)}
      aria-label="Toggle"
    />
  )
}

export default function DesignSystemPage() {
  return (
    <div
      style={{
        background: 'var(--v2-bg)',
        color: 'var(--v2-text)',
        fontFamily: 'var(--font-manrope), sans-serif',
        minHeight: '100vh',
        backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(107, 91, 255, 0.04), transparent 40%), radial-gradient(circle at 100% 100%, rgba(255, 107, 170, 0.03), transparent 40%)',
      }}
    >
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--v2-primary)' }}>
            Design System
          </p>
          <h1
            className="text-4xl font-extrabold mt-2"
            style={{ color: 'var(--v2-text)' }}
          >
            Omuwan v2
          </h1>
          <p
            className="text-lg mt-2"
            style={{ color: 'var(--v2-text-muted)', fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic' }}
          >
            Soft Tech Amigable — futurista pero calido
          </p>
        </div>

        {/* Palette: Backgrounds */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--v2-text)' }}>Fondos</h2>
          <div className="flex flex-wrap gap-5">
            {COLORS.map((c) => <ColorSwatch key={c.token} {...c} />)}
          </div>
        </section>

        {/* Palette: Text */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--v2-text)' }}>Texto</h2>
          <div className="flex flex-wrap gap-5">
            {TEXT_COLORS.map((c) => <ColorSwatch key={c.token} {...c} />)}
          </div>
        </section>

        {/* Palette: Brand */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--v2-text)' }}>Marca</h2>
          <div className="flex flex-wrap gap-5">
            {BRAND_COLORS.map((c) => <ColorSwatch key={c.token} {...c} />)}
          </div>
        </section>

        {/* Typography */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Tipografia</h2>
          <div className="card-v2 p-8 space-y-6">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>Manrope — Display</p>
              <h1 className="text-4xl font-extrabold" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Tu consultorio atendiendo 24/7
              </h1>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>Manrope — Heading</p>
              <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Agenda inteligente con IA
              </h2>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>Manrope — Subheading</p>
              <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Reduccion de no-shows del 35%
              </h3>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>Manrope — Body</p>
              <p className="text-base" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text-muted)' }}>
                Omuwan atiende a tus pacientes por WhatsApp, agenda citas automaticamente, envia recordatorios y reduce los no-shows. Todo sin contratar mas personal.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>Instrument Serif — Decorativo</p>
              <p className="text-3xl" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', color: 'var(--v2-primary)' }}>
                La secretaria que nunca descansa
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--v2-text-subtle)' }}>JetBrains Mono — Datos</p>
              <p className="text-sm" style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>
                23 citas hoy &middot; 3 no-shows &middot; $2.450.000 COP
              </p>
            </div>
          </div>
        </section>

        {/* Buttons */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Botones</h2>
          <div className="card-v2 p-8">
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <button className="btn-v2-primary">Agendar cita</button>
              <button className="btn-v2-secondary">Ver pacientes</button>
              <button className="btn-v2-ghost">Cancelar</button>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button className="btn-v2-primary" disabled>Disabled</button>
              <button className="btn-v2-primary" style={{ background: 'var(--v2-whatsapp)' }}>
                WhatsApp
              </button>
              <button className="btn-v2-primary" style={{ background: 'var(--v2-pink)' }}>
                Urgente
              </button>
            </div>
          </div>
        </section>

        {/* Cards */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="card-v2 p-6">
              <div className="w-10 h-10 rounded-v2 flex items-center justify-center mb-3" style={{ background: 'var(--v2-primary-soft)' }}>
                <span style={{ color: 'var(--v2-primary)', fontSize: '1.25rem' }}>&#128197;</span>
              </div>
              <h3 className="font-bold text-base mb-1" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Citas hoy
              </h3>
              <p className="text-3xl font-extrabold" style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-primary)' }}>
                23
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--v2-text-subtle)' }}>
                +4 vs. ayer
              </p>
            </div>

            <div className="card-v2 p-6">
              <div className="w-10 h-10 rounded-v2 flex items-center justify-center mb-3" style={{ background: 'var(--v2-green-soft)' }}>
                <span style={{ color: 'var(--v2-green)', fontSize: '1.25rem' }}>&#9989;</span>
              </div>
              <h3 className="font-bold text-base mb-1" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Tasa de asistencia
              </h3>
              <p className="text-3xl font-extrabold" style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-green)' }}>
                87%
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--v2-text-subtle)' }}>
                Meta: 90%
              </p>
            </div>

            <div className="card-v2 p-6">
              <div className="w-10 h-10 rounded-v2 flex items-center justify-center mb-3" style={{ background: 'var(--v2-pink-soft)' }}>
                <span style={{ color: 'var(--v2-pink)', fontSize: '1.25rem' }}>&#128172;</span>
              </div>
              <h3 className="font-bold text-base mb-1" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)' }}>
                Chats activos
              </h3>
              <p className="text-3xl font-extrabold" style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-pink)' }}>
                12
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--v2-text-subtle)' }}>
                3 esperando respuesta
              </p>
            </div>
          </div>
        </section>

        {/* Tags */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Tags</h2>
          <div className="card-v2 p-8">
            <div className="flex flex-wrap gap-3">
              <span className="tag-v2 tag-v2-primary">Confirmada</span>
              <span className="tag-v2 tag-v2-green">Completada</span>
              <span className="tag-v2 tag-v2-amber">Pendiente</span>
              <span className="tag-v2 tag-v2-red">No-show</span>
              <span className="tag-v2 tag-v2-pink">Urgente</span>
            </div>
          </div>
        </section>

        {/* Toggles + Input */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Controles</h2>
          <div className="card-v2 p-8 space-y-6">
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--v2-text-subtle)' }}>Toggle</p>
              <div className="flex items-center gap-3">
                <ToggleDemo />
                <span className="text-sm" style={{ color: 'var(--v2-text-muted)' }}>Recordatorios 24h</span>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--v2-text-subtle)' }}>Input</p>
              <input className="input-v2 max-w-md" placeholder="Buscar paciente..." />
            </div>
          </div>
        </section>

        {/* Shadows */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Sombras</h2>
          <div className="flex flex-wrap gap-8 items-center">
            <div className="w-32 h-32 rounded-v2-lg flex items-center justify-center text-xs font-medium" style={{ background: 'var(--v2-bg-card)', boxShadow: 'var(--v2-shadow-sm)', color: 'var(--v2-text-muted)' }}>
              shadow-sm
            </div>
            <div className="w-32 h-32 rounded-v2-lg flex items-center justify-center text-xs font-medium" style={{ background: 'var(--v2-bg-card)', boxShadow: 'var(--v2-shadow)', color: 'var(--v2-text-muted)' }}>
              shadow
            </div>
            <div className="w-32 h-32 rounded-v2-lg flex items-center justify-center text-xs font-medium" style={{ background: 'var(--v2-bg-card)', boxShadow: 'var(--v2-shadow-lg)', color: 'var(--v2-text-muted)' }}>
              shadow-lg
            </div>
          </div>
        </section>

        {/* Radii */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--v2-text)' }}>Border Radius</h2>
          <div className="flex flex-wrap gap-6 items-end">
            <div className="text-center">
              <div className="w-20 h-20 border-2 flex items-center justify-center text-[10px]" style={{ borderColor: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-sm)', color: 'var(--v2-text-muted)' }}>8px</div>
              <p className="text-xs mt-2" style={{ color: 'var(--v2-text-subtle)' }}>sm</p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 border-2 flex items-center justify-center text-[10px]" style={{ borderColor: 'var(--v2-primary)', borderRadius: 'var(--v2-radius)', color: 'var(--v2-text-muted)' }}>12px</div>
              <p className="text-xs mt-2" style={{ color: 'var(--v2-text-subtle)' }}>default</p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 border-2 flex items-center justify-center text-[10px]" style={{ borderColor: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-lg)', color: 'var(--v2-text-muted)' }}>18px</div>
              <p className="text-xs mt-2" style={{ color: 'var(--v2-text-subtle)' }}>lg</p>
            </div>
            <div className="text-center">
              <div className="w-20 h-20 border-2 flex items-center justify-center text-[10px]" style={{ borderColor: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-xl)', color: 'var(--v2-text-muted)' }}>22px</div>
              <p className="text-xs mt-2" style={{ color: 'var(--v2-text-subtle)' }}>xl</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-8 border-t" style={{ borderColor: 'var(--v2-border-soft)' }}>
          <p className="text-sm" style={{ color: 'var(--v2-text-subtle)' }}>
            Omuwan Design System v2 &mdash; Fase 0: Tokens y fundacion
          </p>
        </footer>
      </div>
    </div>
  )
}
