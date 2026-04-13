'use client'

// ============================================================
// Formulario para aceptar invitación con token propio (Resend flow)
// ============================================================

import { useState, useTransition } from 'react'
import { acceptTokenInvitation } from '@/app/actions/accept-invite'

interface TokenInviteFormProps {
  token: string
  defaultName: string
  email: string
}

export function TokenInviteForm({ token, defaultName, email }: TokenInviteFormProps) {
  const [fullName, setFullName] = useState(defaultName)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setError('')

    if (!fullName.trim()) { setError('Ingresa tu nombre completo'); return }
    if (password.length < 10) { setError('La contraseña debe tener al menos 10 caracteres'); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden'); return }

    startTransition(async () => {
      const result = await acceptTokenInvitation(token, fullName.trim(), password)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Email</label>
        <input type="email" value={email} disabled className="input-field bg-slate-50 text-slate-500" />
      </div>

      <div>
        <label className="label">Nombre completo</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input-field"
          placeholder="Tu nombre completo"
        />
      </div>

      <div>
        <label className="label">Contraseña</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field pr-10"
            placeholder="Mínimo 10 caracteres"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div>
        <label className="label">Confirmar contraseña</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="input-field"
          placeholder="Repite tu contraseña"
        />
        {confirmPassword.length > 0 && (
          password === confirmPassword ? (
            <p className="text-xs text-emerald-600 mt-1">✓ Las contraseñas coinciden</p>
          ) : (
            <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
          )
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full btn-primary disabled:opacity-60"
      >
        {isPending ? 'Creando cuenta...' : 'Aceptar invitación'}
      </button>
    </div>
  )
}
