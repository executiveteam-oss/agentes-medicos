'use client'

// ============================================================
// Login page — Omuwan v2 "Soft Tech Amigable"
// Ruta: /login
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { loginAction } from '@/app/actions/auth'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Mail, Lock, Eye, EyeOff, ChevronLeft, ArrowRight, Loader2 } from 'lucide-react'

function LoginForm() {
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const passwordReset = searchParams.get('password_reset') === 'true'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await loginAction(formData)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <>
      {/* Top nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '24px 32px',
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(107, 91, 255, 0.25)',
            }}
          >
            <span style={{ color: '#fff', fontWeight: 800, fontSize: '12px' }}>O</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: '16px', color: 'var(--v2-text)', letterSpacing: '-0.3px' }}>
            Omuwan
          </span>
        </Link>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--v2-text-muted)',
            textDecoration: 'none',
          }}
        >
          <ChevronLeft size={16} />
          Volver
        </Link>
      </div>

      {/* Form container */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 32px 40px' }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          {/* Welcome */}
          <div style={{ marginBottom: '32px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--v2-green-deep)',
              }}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--v2-green)' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--v2-green)' }} />
              </span>
              Bienvenida de vuelta
            </div>
            <h1 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '10px' }}>
              Hola de{' '}
              <span
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: 'italic',
                  fontWeight: 400,
                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                nuevo
              </span>
              .
            </h1>
            <p style={{ fontSize: '14.5px', color: 'var(--v2-text-muted)', lineHeight: 1.5 }}>
              Tus pacientes te estan esperando — ingresa para ver tu agenda del dia.
            </p>
          </div>

          {/* Alerts */}
          {passwordReset && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                background: 'var(--v2-green-soft)',
                border: '1px solid rgba(52, 199, 123, 0.3)',
                borderRadius: 'var(--v2-radius)',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--v2-green-deep)',
              }}
            >
              Contraseña actualizada. Inicia sesión con tu nueva contraseña.
            </div>
          )}

          {urlError === 'callback_error' && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                background: 'var(--v2-red-soft)',
                border: '1px solid rgba(255, 87, 87, 0.3)',
                borderRadius: 'var(--v2-radius)',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--v2-red)',
              }}
            >
              Error al verificar el enlace. Intenta de nuevo.
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '6px' }}
              >
                Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--v2-text-subtle)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="tu@clinica.com"
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 42px',
                    border: '1.5px solid var(--v2-border)',
                    borderRadius: 'var(--v2-radius)',
                    fontSize: '14px',
                    color: 'var(--v2-text)',
                    background: 'var(--v2-bg-card)',
                    outline: 'none',
                    transition: 'all 0.2s',
                    fontFamily: 'var(--font-manrope), sans-serif',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--v2-primary)'
                    e.target.style.boxShadow = '0 0 0 4px var(--v2-primary-soft)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--v2-border)'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label
                  htmlFor="password"
                  style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text)' }}
                >
                  Contraseña
                </label>
                <Link
                  href="/forgot-password"
                  style={{ fontSize: '12px', fontWeight: 500, color: 'var(--v2-primary)', textDecoration: 'none' }}
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--v2-text-subtle)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 42px',
                    border: '1.5px solid var(--v2-border)',
                    borderRadius: 'var(--v2-radius)',
                    fontSize: '14px',
                    color: 'var(--v2-text)',
                    background: 'var(--v2-bg-card)',
                    outline: 'none',
                    transition: 'all 0.2s',
                    fontFamily: 'var(--font-manrope), sans-serif',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--v2-primary)'
                    e.target.style.boxShadow = '0 0 0 4px var(--v2-primary-soft)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--v2-border)'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--v2-text-subtle)',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--v2-red-soft)',
                  border: '1px solid rgba(255, 87, 87, 0.3)',
                  borderRadius: 'var(--v2-radius)',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--v2-red)',
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '14px 24px',
                borderRadius: 'var(--v2-radius)',
                fontSize: '15px',
                fontWeight: 700,
                color: '#fff',
                background: loading
                  ? 'var(--v2-primary)'
                  : 'linear-gradient(135deg, var(--v2-primary), var(--v2-primary-deep))',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                boxShadow: '0 4px 14px rgba(107, 91, 255, 0.3)',
                transition: 'all 0.2s',
                fontFamily: 'var(--font-manrope), sans-serif',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Bottom */}
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)' }}>
              ¿Aún no tienes cuenta?{' '}
              <a
                href="/register/invite"
                style={{ fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none' }}
              >
                Crear cuenta con código →
              </a>
            </p>
          </div>

          {/* Footer */}
          <div style={{ marginTop: '48px', textAlign: 'center' }}>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
              &copy; 2026 Omuwan &middot; Lonco Capital S.A.S. &middot; Pereira, Colombia 🇨🇴
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '420px', padding: '0 32px' }}>
            <div
              style={{
                height: '400px',
                borderRadius: 'var(--v2-radius-lg)',
                background: 'var(--v2-bg-soft)',
              }}
              className="animate-pulse"
            />
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
