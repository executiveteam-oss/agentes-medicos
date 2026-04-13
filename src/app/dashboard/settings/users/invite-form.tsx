'use client'

import { useState } from 'react'
import { inviteUserAction } from '@/app/actions/users'

interface Role {
  id: string
  name: string
}

interface Doctor {
  id: string
  name: string
}

export function InviteUserForm({ roles, doctors }: { roles: Role[]; doctors: Doctor[] }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState('')

  // Check if selected role is "Doctor"
  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const isDoctorRole = selectedRole?.name === 'Doctor'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const result = await inviteUserAction(formData)

    if (result.ok) {
      setMessage({ type: 'ok', text: 'Invitación enviada con éxito' })
      ;(e.target as HTMLFormElement).reset()
      setSelectedRoleId('')
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
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
        >
          <option value="">Selecciona un rol</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {isDoctorRole && doctors.length > 0 && (
        <div>
          <label className="label">Vincular con médico</label>
          <select name="doctor_id" className="input-field">
            <option value="">Sin vincular (configurar después)</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Vincula esta cuenta con un perfil de médico para que vea su agenda y horario.
          </p>
        </div>
      )}

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
