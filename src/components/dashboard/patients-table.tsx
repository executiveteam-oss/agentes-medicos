'use client'

// ============================================================
// PatientsTable — Pure client-side filtering, no server calls
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { deletePatient, getPatientForEdit } from '@/app/actions/patients'
import type { PatientFormData } from '@/app/actions/patients'
import { PatientFormModal } from '@/components/dashboard/patient-form-modal'
import { PriorityBadge } from '@/components/dashboard/priority-badge'
import type { PriorityTier } from '@/components/dashboard/priority-badge'
import { formatPhone } from '@/lib/utils/dates'

interface Patient {
  id: string
  name: string
  phone: string
  eps: string | null
  total_appointments: number
  no_show_count: number
}

/** Calcular tier de prioridad del paciente (client-side, sin cartera ni waitlist) */
function getPatientTier(p: Patient): PriorityTier | null {
  let score = 0
  // Pago: particular (+30) si no tiene EPS, EPS (+10) si tiene
  if (!p.eps || p.eps === 'Particular') score += 30
  else score += 10
  // Frecuencia
  if (p.total_appointments >= 5) score += 25
  else if (p.total_appointments >= 2) score += 15
  // No-shows
  if (p.no_show_count === 0) score += 20
  else if (p.no_show_count === 1) score += 5
  else score -= 10

  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return null // Don't show badge for low-priority patients in patient list
}

const EPS_OPTIONS = ['todas', 'Sura', 'Compensar', 'Nueva EPS', 'Sanitas', 'Coosalud', 'Medimás', 'Particular']

export function PatientsTable({ initialPatients }: { initialPatients: Patient[] }) {
  const [allPatients, setAllPatients] = useState(initialPatients)
  const [search, setSearch] = useState('')
  const [epsFilter, setEpsFilter] = useState('todas')
  const [showModal, setShowModal] = useState(false)
  const [editData, setEditData] = useState<PatientFormData | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)

  // 100% client-side filter
  const filtered = allPatients.filter((p) => {
    if (search.trim()) {
      const term = search.trim().toLowerCase()
      if (!p.name.toLowerCase().includes(term) && !p.phone.toLowerCase().includes(term)) return false
    }
    if (epsFilter !== 'todas') {
      if (epsFilter === 'Particular') {
        if (p.eps !== null && p.eps !== 'Particular') return false
      } else {
        if (p.eps !== epsFilter) return false
      }
    }
    return true
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleEdit(patientId: string) {
    const fullData = await getPatientForEdit(patientId)
    if (fullData) {
      setEditData(fullData)
      setShowModal(true)
    } else {
      showToast('Error cargando datos del paciente')
    }
  }

  async function handleDelete(patientId: string) {
    if (!confirm('¿Eliminar este paciente?')) return
    const result = await deletePatient(patientId)
    if (result.ok) {
      setAllPatients((prev) => prev.filter((p) => p.id !== patientId))
      showToast('Paciente eliminado')
    } else {
      showToast(result.error ?? 'Error eliminando')
    }
  }

  return (
    <div className="space-y-4">
      {/* Search + EPS filter + Add */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
          className="flex-1 input-field text-slate-900 bg-white border border-slate-200"
        />
        <select
          value={epsFilter}
          onChange={(e) => setEpsFilter(e.target.value)}
          className="input-field w-auto min-w-[160px]"
        >
          {EPS_OPTIONS.map((eps) => (
            <option key={eps} value={eps}>
              {eps === 'todas' ? 'Todas las EPS' : eps}
            </option>
          ))}
        </select>
        <button
          onClick={() => { setEditData(undefined); setShowModal(true) }}
          className="btn-primary whitespace-nowrap"
        >
          + Agregar paciente
        </button>
      </div>

      {/* Modal */}
      <PatientFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        initialData={editData}
        onSaved={() => window.location.reload()}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Directorio de pacientes</h2>
          <span className="badge badge-blue">
            {filtered.length} de {allPatients.length} pacientes
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-slate-900 font-medium mb-1">
              {search || epsFilter !== 'todas' ? 'Sin resultados' : 'No hay pacientes registrados'}
            </p>
            <p className="text-slate-500 text-sm">
              {search || epsFilter !== 'todas'
                ? 'Intenta con otros criterios de búsqueda'
                : 'Los pacientes se registran automáticamente al escribir por WhatsApp'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Nombre</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Teléfono</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">EPS</th>
                  <th className="text-center py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Citas</th>
                  <th className="text-center py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">No-shows</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const tier = getPatientTier(p)
                  return (
                  <tr key={p.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/patients/${p.id}`} className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline">
                          {p.name}
                        </Link>
                        {tier && <PriorityBadge tier={tier} size="xs" />}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-slate-500 text-sm">{formatPhone(p.phone)}</td>
                    <td className="py-3.5 px-5">
                      <span className="badge badge-slate">{p.eps ?? 'Particular'}</span>
                    </td>
                    <td className="py-3.5 px-5 text-center text-slate-700 text-sm font-medium">{p.total_appointments}</td>
                    <td className="py-3.5 px-5 text-center">
                      {p.no_show_count > 0 ? (
                        <span className={`text-sm font-medium ${p.no_show_count >= 3 ? 'text-red-600' : 'text-amber-600'}`}>{p.no_show_count}</span>
                      ) : (
                        <span className="text-slate-400 text-sm">0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleEdit(p.id)} className="text-slate-400 hover:text-blue-600 p-1 transition-colors" title="Editar">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                        </button>
                        <button onClick={() => handleDelete(p.id)} className="text-slate-400 hover:text-red-600 p-1 transition-colors" title="Eliminar">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
