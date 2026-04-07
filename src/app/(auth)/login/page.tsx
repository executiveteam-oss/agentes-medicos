'use client'

// ============================================================
// Página de login — Omuwan branded
// Ruta: /login
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { loginAction, resendConfirmationAction } from '@/app/actions/auth'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [emailValue, setEmailValue] = useState('')
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const justRegistered = searchParams.get('registered') === 'true'
  const passwordReset = searchParams.get('password_reset') === 'true'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setResendSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    setEmailValue(formData.get('email') as string)
    const result = await loginAction(formData)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  async function handleResend() {
    if (!emailValue || resending) return
    setResending(true)
    await resendConfirmationAction(emailValue)
    setResendSuccess(true)
    setResending(false)
  }

  const isUnconfirmed = error === 'EMAIL_NOT_CONFIRMED'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Iniciar sesión</h2>
      <p className="text-sm text-slate-500 mb-6">Ingresa a tu consultorio</p>

      {justRegistered && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
          Cuenta creada. Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.
        </div>
      )}

      {passwordReset && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
          Contraseña actualizada. Inicia sesión con tu nueva contraseña.
        </div>
      )}

      {urlError === 'callback_error' && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Error al verificar el enlace. Intenta de nuevo.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-field"
            placeholder="tu@consultorio.com"
            onChange={(e) => setEmailValue(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input-field"
            placeholder="••••••••"
          />
          <div className="mt-1.5 text-right">
            <Link href="/forgot-password" className="text-xs text-slate-400 hover:text-[#0f2a6e] transition-colors">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </div>

        {isUnconfirmed && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm space-y-2">
            <p>Confirma tu email antes de iniciar sesión. ¿No recibiste el correo? Revisa tu spam.</p>
            {resendSuccess ? (
              <p className="text-emerald-600 font-medium">Correo reenviado. Revisa tu bandeja.</p>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="text-[#0f2a6e] hover:text-[#1a3a8a] font-medium underline disabled:opacity-60"
              >
                {resending ? 'Enviando...' : 'Reenviar confirmación'}
              </button>
            )}
          </div>
        )}

        {error && !isUnconfirmed && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0f2a6e] hover:bg-[#1a3a8a] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        ¿No tienes cuenta?{' '}
        <Link href="/register" className="text-[#0f2a6e] hover:text-[#1a3a8a] font-medium">
          Crear cuenta
        </Link>
      </p>

      <p className="mt-3 text-center">
        <Link href="/status" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
          Estado del sistema
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 h-72 animate-pulse" />}>
      <LoginForm />
    </Suspense>
  )
}
