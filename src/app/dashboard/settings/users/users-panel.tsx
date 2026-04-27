'use client'

// ============================================================
// UsersPanel — Panel interactivo de gestión de usuarios
// ============================================================

import { useState } from 'react'
import { InviteUserForm } from './invite-form'
import { UserRow } from './user-row'
import type { ClinicUserRow } from '@/app/actions/users'

interface Role {
  id: string
  name: string
}

interface DoctorOption {
  id: string
  name: string
}

interface Props {
  users: ClinicUserRow[]
  roles: Role[]
  doctors: DoctorOption[]
}

export function UsersPanel({ users, roles, doctors }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const activeCount = users.filter((u) => u.status === 'active').length
  const pendingCount = users.filter((u) => u.status === 'pending').length

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card-v2 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Total</p>
          <p className="text-2xl font-semibold text-slate-900">{users.length}</p>
        </div>
        <div className="card-v2 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Activos</p>
          <p className="text-2xl font-semibold text-emerald-600">{activeCount}</p>
        </div>
        <div className="card-v2 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Pendientes</p>
          <p className="text-2xl font-semibold text-amber-600">{pendingCount}</p>
        </div>
      </div>

      {/* Tabla de usuarios */}
      <div className="card-v2 overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Miembros del equipo</h2>
            <p className="text-slate-400 text-xs mt-0.5">Gestiona los usuarios de tu consultorio</p>
          </div>
          {users.length > 0 && (
            <span className="badge badge-blue">{users.length}</span>
          )}
        </div>
        {users.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-3xl mb-3">👥</p>
            <p className="text-slate-900 font-medium mb-1">Sin miembros</p>
            <p className="text-slate-500 text-sm">Invita a tu equipo con el formulario de abajo</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                roles={roles}
                doctors={doctors}
                onToast={showToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* Formulario de invitación */}
      <div className="card-v2 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Invitar usuario</h2>
        <InviteUserForm roles={roles} doctors={doctors} />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
    </>
  )
}
