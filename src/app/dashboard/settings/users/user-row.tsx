'use client'

// ============================================================
// UserRow — Fila de usuario con acciones: rol, estado, reenviar, remover
// ============================================================

import { useState, useTransition } from 'react'
import { toggleUserActive, updateUserRole, resendInvite, removeUserFromClinic } from '@/app/actions/users'
import type { ClinicUserRow } from '@/app/actions/users'

interface Role {
  id: string
  name: string
}

interface Props {
  user: ClinicUserRow
  roles: Role[]
  onToast: (msg: string) => void
}

const STATUS_CONFIG = {
  active: { label: 'Activo', class: 'badge-green' },
  inactive: { label: 'Inactivo', class: 'badge-slate' },
  pending: { label: 'Pendiente', class: 'badge-amber' },
} as const

export function UserRow({ user, roles, onToast }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showConfirmRemove, setShowConfirmRemove] = useState(false)

  function handleToggleActive() {
    startTransition(async () => {
      const result = await toggleUserActive(user.id, !user.is_active)
      if (result.ok) {
        onToast(user.is_active ? 'Usuario desactivado' : 'Usuario activado')
      } else {
        onToast(result.error ?? 'Error')
      }
    })
  }

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    startTransition(async () => {
      const result = await updateUserRole(user.id, e.target.value)
      if (result.ok) {
        onToast('Rol actualizado')
      } else {
        onToast(result.error ?? 'Error')
      }
    })
  }

  function handleResendInvite() {
    startTransition(async () => {
      const result = await resendInvite(user.email)
      if (result.ok) {
        onToast('Invitación reenviada')
      } else {
        onToast(result.error ?? 'Error reenviando')
      }
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeUserFromClinic(user.id)
      if (result.ok) {
        onToast('Usuario removido del consultorio')
        setShowConfirmRemove(false)
      } else {
        onToast(result.error ?? 'Error removiendo')
      }
    })
  }

  const statusInfo = STATUS_CONFIG[user.status]

  return (
    <div className="px-5 py-3.5 hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between gap-4">
        {/* Info del usuario */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-slate-900 text-sm font-medium truncate">{user.full_name}</p>
            <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
          </div>
          <p className="text-xs text-slate-400 truncate">{user.email}</p>
        </div>

        {/* Rol */}
        <select
          value={user.clinic_roles?.id ?? ''}
          onChange={handleRoleChange}
          disabled={isPending}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          <option value="">Sin rol</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        {/* Acciones */}
        <div className="flex items-center gap-1.5">
          {/* Reenviar invitación (solo pendientes) */}
          {user.status === 'pending' && (
            <button
              onClick={handleResendInvite}
              disabled={isPending}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors font-medium disabled:opacity-50"
              title="Reenviar invitación"
            >
              Reenviar
            </button>
          )}

          {/* Activar/Desactivar */}
          <button
            onClick={handleToggleActive}
            disabled={isPending}
            className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-50 ${
              user.is_active
                ? 'border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                : 'border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
            }`}
          >
            {user.is_active ? 'Desactivar' : 'Activar'}
          </button>

          {/* Remover */}
          <button
            onClick={() => setShowConfirmRemove(true)}
            disabled={isPending}
            className="text-slate-400 hover:text-red-600 p-1.5 transition-colors disabled:opacity-50"
            title="Remover del consultorio"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Confirmación de remover */}
      {showConfirmRemove && (
        <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700 flex-1">
            ¿Remover a <strong>{user.full_name}</strong> del consultorio? Esta acción no se puede deshacer.
          </p>
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
          >
            {isPending ? '...' : 'Confirmar'}
          </button>
          <button
            onClick={() => setShowConfirmRemove(false)}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
