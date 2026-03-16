'use client'

import { useState } from 'react'
import { inviteUserAction } from '@/app/actions/users'

interface Role {
  id: string
  name: string
}

export function InviteUserForm({ roles }: { roles: Role[] }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const result = await inviteUserAction(formData)

    if (result.ok) {
      setMessage({ type: 'ok', text: 'Invitación enviada con éxito' })
      ;(e.target as HTMLFormElement).reset()
    } else {
      setMessage({ type: 'error', text: result.error ?? 'Error desconocido' })
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Nombre completo</label>
          <input
            name="full_name"
            required
            className="input-field"
            placeholder="Ana García"
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            name="email"
            type="email"
            required
            className="input-field"
            placeholder="ana@consultorio.com"
          />
        </div>
      </div>
      <div>
        <label className="label">Rol</label>
        <select
          name="role_id"
          required
          className="input-field"
        >
          <option value="">Selecciona un rol</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'ok'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-primary"
      >
        {loading ? 'Enviando...' : 'Enviar invitación'}
      </button>
    </form>
  )
}
