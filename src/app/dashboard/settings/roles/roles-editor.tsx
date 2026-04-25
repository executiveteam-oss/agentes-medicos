'use client'

// ============================================================
// Editor de roles y permisos
// Permite ver/editar los permisos de cada rol
// ============================================================

import { useState } from 'react'
import { updateRole } from '@/app/actions/roles'
import { MODULES } from '@/types/permissions'
import type { Permissions, ModuleKey } from '@/types/permissions'

const MODULE_LABELS: Record<ModuleKey, string> = {
  agenda: 'Agenda',
  noshow: 'No-Shows',
  cartera: 'Cartera',
  facturacion: 'Facturación',
  espera: 'Lista de espera',
  patients: 'Pacientes',
  conversations: 'Conversaciones',
  analytics: 'Estadísticas',
  whatsapp: 'WhatsApp',
  settings: 'Configuración',
  onboarding: 'Onboarding',
  user_management: 'Gestión de usuarios',
}

interface RoleData {
  id: string
  name: string
  description: string | null
  permissions: Permissions
}

export function RolesEditor({ roles }: { roles: RoleData[] }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id ?? '')
  const [localPermissions, setLocalPermissions] = useState<Permissions | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const permissions = localPermissions ?? selectedRole?.permissions

  function handleRoleChange(roleId: string) {
    setSelectedRoleId(roleId)
    setLocalPermissions(null)
    setSaved(false)
  }

  function togglePermission(module: ModuleKey, type: 'read' | 'write') {
    if (!permissions) return
    const current = permissions[module]
    let newPerm = { ...current, [type]: !current[type] }

    // Si se activa write, también activar read
    if (type === 'write' && newPerm.write) {
      newPerm.read = true
    }
    // Si se desactiva read, también desactivar write
    if (type === 'read' && !newPerm.read) {
      newPerm.write = false
    }

    setLocalPermissions({
      ...(permissions),
      [module]: newPerm,
    } as Permissions)
    setSaved(false)
  }

  async function handleSave() {
    if (!localPermissions || !selectedRole) return
    setSaving(true)

    await updateRole(selectedRole.id, { permissions: localPermissions })

    setSaving(false)
    setSaved(true)
    setLocalPermissions(null)
  }

  if (roles.length === 0) {
    return (
      <div className="card p-12 text-center">
        <p className="text-slate-500 text-sm">No hay roles configurados.</p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Selector de rol (tabs) */}
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => handleRoleChange(r.id)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              selectedRoleId === r.id
                ? 'text-blue-700 border-b-2 border-blue-700 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Editor de permisos */}
      {selectedRole && permissions && (
        <div className="p-5">
          {selectedRole.description && (
            <p className="text-slate-500 text-sm mb-5">{selectedRole.description}</p>
          )}

          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 pb-2 border-b border-slate-200">
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Módulo</span>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider text-center">Ver</span>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider text-center">Editar</span>
            </div>
            {MODULES.map((module) => (
              <div
                key={module}
                className="grid grid-cols-[1fr_80px_80px] gap-2 items-center px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <span className="text-slate-900 text-sm">{MODULE_LABELS[module]}</span>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={permissions[module]?.read ?? false}
                    onChange={() => togglePermission(module, 'read')}
                    className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={permissions[module]?.write ?? false}
                    onChange={() => togglePermission(module, 'write')}
                    className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !localPermissions}
              className="btn-primary"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {saved && (
              <span className="text-emerald-600 text-sm font-medium">Guardado</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
