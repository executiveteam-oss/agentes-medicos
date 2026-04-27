'use client'

// ============================================================
// Página de recuperación de contraseña
// Ruta: /forgot-password
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { forgotPasswordAction } from '@/app/actions/auth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await forgotPasswordAction(email)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Recuperar contraseña</h2>
      <p className="text-sm text-slate-500 mb-6">Te enviaremos un enlace para restablecer tu contraseña</p>

      {sent ? (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
            <p className="font-medium mb-1">Correo enviado</p>
            <p>Revisa tu bandeja de entrada (y spam) para restablecer tu contraseña.</p>
          </div>
          <Link
            href="/login"
            className="block w-full text-center bg-[var(--v2-primary-deep)] hover:bg-[var(--v2-primary)] text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input-v2"
              placeholder="tu@consultorio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--v2-primary-deep)] hover:bg-[var(--v2-primary)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
          >
            {loading ? 'Enviando...' : 'Enviar link de recuperación'}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link href="/login" className="text-[var(--v2-primary-deep)] hover:text-[var(--v2-primary)] font-medium">
          Volver al login
        </Link>
      </p>
    </div>
  )
}
