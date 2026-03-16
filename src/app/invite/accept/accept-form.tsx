'use client'

// ============================================================
// AcceptInviteForm — Formulario para aceptar invitación
// Setea nombre y contraseña, luego redirige al dashboard
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInviteAction } from '@/app/actions/accept-invite'

interface Props {
  defaultName: string
}

export function AcceptInviteForm({ defaultName }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(defaultName)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) {
      setError('Ingresa tu nombre completo')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    startTransition(async () => {
      const result = await acceptInviteAction({ fullName: fullName.trim(), password })
      if (result.ok) {
        router.push('/dashboard')
      } else {
        setError(result.error ?? 'Error inesperado')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre completo</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input-field"
          placeholder="Tu nombre completo"
          autoFocus
        />
      </div>

      <div>
        <label className="label">Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field"
          placeholder="Mínimo 6 caracteres"
        />
      </div>

      <div>
        <label className="label">Confirmar contraseña</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="input-field"
          placeholder="Repite la contraseña"
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary w-full"
      >
        {isPending ? 'Creando cuenta...' : 'Crear mi cuenta'}
      </button>
    </form>
  )
}
