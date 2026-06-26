'use client'

// ============================================================
// UsersPanel — Panel interactivo de gestión de usuarios
// ============================================================

import { useState, useTransition } from 'react'
import { InviteUserForm } from './invite-form'
import { UserRow } from './user-row'
import { resendInvite, deletePendingInvitation } from '@/app/actions/users'
import type { ClinicUserRow, PendingInvitationRow } from '@/app/actions/users'

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
  pendingInvitations: PendingInvitationRow[]
}

export function UsersPanel({ users, roles, doctors, pendingInvitations }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const activeCount = users.filter((u) => u.status === 'active').length
  const pendingCount = users.filter((u) => u.status === 'pending').length
  const invitationsCount = pendingInvitations.length
  const expiredInvitationsCount = pendingInvitations.filter((i) => i.is_expired).length

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
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
          <p className="text-[10px] text-slate-400 mt-1">aceptadas, sin login</p>
        </div>
        <div className="card-v2 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Invitaciones</p>
          <p className="text-2xl font-semibold text-blue-600">{invitationsCount}</p>
          <p className="text-[10px] text-slate-400 mt-1">
            {expiredInvitationsCount > 0
              ? `${expiredInvitationsCount} expiradas`
              : 'todas vigentes'}
          </p>
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

      {/* Invitaciones sin aceptar (incluye expiradas) */}
      {pendingInvitations.length > 0 && (
        <div className="card-v2 overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Invitaciones sin aceptar</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Personas que no han completado el registro. Reenviá el link si expiró.
              </p>
            </div>
            <span className="badge badge-blue">{pendingInvitations.length}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingInvitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} onToast={showToast} />
            ))}
          </div>
        </div>
      )}

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

// ============================================================
// InvitationRow — fila para invitaciones sin aceptar
// ============================================================

function InvitationRow({
  invitation,
  onToast,
}: {
  invitation: PendingInvitationRow
  onToast: (msg: string) => void
}): React.JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  function handleResend(): void {
    startTransition(async () => {
      const r = await resendInvite(invitation.email)
      onToast(r.ok ? 'Invitación reenviada (válida 7 días)' : (r.error ?? 'Error reenviando'))
    })
  }

  function handleDelete(): void {
    startTransition(async () => {
      const r = await deletePendingInvitation(invitation.id)
      if (r.ok) {
        onToast('Invitación eliminada')
        setShowConfirmDelete(false)
      } else {
        onToast(r.error ?? 'Error eliminando')
      }
    })
  }

  const created = new Date(invitation.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' })
  const expires = new Date(invitation.expires_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' })

  return (
    <div className="px-5 py-3.5 hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-slate-900 text-sm font-medium truncate">{invitation.full_name}</p>
            <span className={`badge ${invitation.is_expired ? 'badge-red' : 'badge-amber'}`}>
              {invitation.is_expired ? 'Expirada' : 'Vigente'}
            </span>
            {invitation.clinic_role && (
              <span className="badge badge-slate">{invitation.clinic_role.name}</span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate">{invitation.email}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Enviada: {created} · Expira: {expires}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleResend}
            disabled={isPending}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Enviando…' : '↻ Reenviar'}
          </button>
          {!showConfirmDelete ? (
            <button
              onClick={() => setShowConfirmDelete(true)}
              disabled={isPending}
              className="text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
            >
              Eliminar
            </button>
          ) : (
            <>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-xs font-medium text-red-600 disabled:opacity-50"
              >
                {isPending ? 'Eliminando…' : 'Confirmar'}
              </button>
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={isPending}
                className="text-xs font-medium text-slate-400"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
