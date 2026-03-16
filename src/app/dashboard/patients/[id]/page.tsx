// ============================================================
// Detalle de paciente — Perfil, citas, conversaciones, cartera
// Ruta: /dashboard/patients/[id]
// ============================================================

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPatientDetail } from '@/app/actions/patients'
import { formatCOP, formatPhone, formatTimeForPatient } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  confirmed: { label: 'Confirmada', class: 'badge-blue' },
  completed: { label: 'Completada', class: 'badge-green' },
  no_show: { label: 'No-show', class: 'badge-red' },
  cancelled: { label: 'Cancelada', class: 'badge-slate' },
  rescheduled: { label: 'Reagendada', class: 'badge-amber' },
}

const INVOICE_LABELS: Record<string, { label: string; class: string }> = {
  pendiente: { label: 'Pendiente', class: 'badge-amber' },
  emitida: { label: 'Emitida', class: 'badge-green' },
  en_tramite: { label: 'En trámite', class: 'badge-blue' },
  pagada: { label: 'Pagada', class: 'badge-green' },
  glosada: { label: 'Glosada', class: 'badge-red' },
  vencida: { label: 'Vencida', class: 'badge-red' },
}

const PAYMENT_COLORS: Record<string, string> = {
  EPS: 'badge-blue',
  Particular: 'badge-green',
  Póliza: 'badge-slate',
  ARL: 'badge-amber',
}

const CONV_STATUS: Record<string, { label: string; class: string }> = {
  active: { label: 'Activa', class: 'badge-green' },
  resolved: { label: 'Resuelta', class: 'badge-slate' },
  escalated: { label: 'Escalada', class: 'badge-red' },
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const result = await getPatientDetail(id)

  if (!result) notFound()

  const { patient, appointments, conversations, cartera } = result

  const totalCartera = cartera
    .filter((c) => c.status === 'pendiente')
    .reduce((sum, c) => sum + c.amount, 0)

  const noShowRate = patient.total_appointments > 0
    ? Math.round((patient.no_show_count / patient.total_appointments) * 100)
    : 0

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb + Back */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard/patients" className="text-blue-700 hover:text-blue-800 hover:underline">
          Pacientes
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500 truncate">{patient.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{patient.name}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{formatPhone(patient.phone)}</p>
        </div>
        <div className="flex gap-2">
          <span className={`badge ${patient.eps && patient.eps !== 'Particular' ? 'badge-blue' : 'badge-slate'}`}>
            {patient.eps ?? 'Particular'}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat label="Total citas" value={String(patient.total_appointments)} />
        <MiniStat
          label="No-shows"
          value={`${patient.no_show_count} (${noShowRate}%)`}
          valueClass={noShowRate > 30 ? 'text-red-600' : noShowRate > 15 ? 'text-amber-600' : undefined}
        />
        <MiniStat
          label="Saldo pendiente"
          value={totalCartera > 0 ? formatCOP(totalCartera) : '$0'}
          valueClass={totalCartera > 0 ? 'text-red-600' : undefined}
        />
        <MiniStat
          label="Paciente desde"
          value={format(new Date(patient.created_at), "d MMM yyyy", { locale: es })}
        />
      </div>

      {/* Profile card */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Información personal</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <InfoItem label="Documento" value={`${patient.document_type} ${patient.document_number ?? 'No registrado'}`} />
          <InfoItem label="Fecha de nacimiento" value={patient.date_of_birth ? format(new Date(patient.date_of_birth + 'T12:00:00'), "d MMM yyyy", { locale: es }) : 'No registrada'} />
          <InfoItem label="Email" value={patient.email ?? 'No registrado'} />
          <InfoItem label="EPS" value={patient.eps ?? 'Particular'} />
        </div>
        {patient.notes && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">Notas</p>
            <p className="text-slate-700 text-sm">{patient.notes}</p>
          </div>
        )}
      </div>

      {/* Appointments */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Historial de citas</h2>
          {appointments.length > 0 && (
            <span className="badge badge-blue">{appointments.length}</span>
          )}
        </div>
        {appointments.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 text-sm">No hay citas registradas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Fecha</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Motivo</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Doctor</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Estado</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Pago</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Factura</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => {
                  const statusInfo = STATUS_LABELS[a.status] ?? { label: a.status, class: 'badge-slate' }
                  const invoiceInfo = INVOICE_LABELS[a.invoice_status] ?? { label: a.invoice_status, class: 'badge-slate' }
                  return (
                    <tr key={a.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-5 text-sm text-slate-900">
                        <span className="font-medium">{format(new Date(a.starts_at), "d MMM yyyy", { locale: es })}</span>
                        <span className="text-slate-400 ml-1.5">{formatTimeForPatient(a.starts_at)}</span>
                      </td>
                      <td className="py-3 px-5 text-slate-600 text-sm">{a.reason ?? '-'}</td>
                      <td className="py-3 px-5 text-slate-600 text-sm">{a.doctor_name ?? '-'}</td>
                      <td className="py-3 px-5">
                        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                      </td>
                      <td className="py-3 px-5">
                        <span className={`badge ${PAYMENT_COLORS[a.payment_type] ?? 'badge-slate'}`}>{a.payment_type}</span>
                      </td>
                      <td className="py-3 px-5">
                        <span className={`badge ${invoiceInfo.class}`}>{invoiceInfo.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Conversaciones WhatsApp</h2>
          {conversations.length > 0 && (
            <span className="badge badge-blue">{conversations.length}</span>
          )}
        </div>
        {conversations.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 text-sm">No hay conversaciones registradas</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {conversations.map((c) => {
              const convStatus = CONV_STATUS[c.status] ?? { label: c.status, class: 'badge-slate' }
              return (
                <div key={c.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`badge ${convStatus.class}`}>{convStatus.label}</span>
                    <span className="text-slate-500 text-sm">{c.message_count} mensajes</span>
                  </div>
                  <span className="text-slate-400 text-xs">
                    {format(new Date(c.last_message_at), "d MMM yyyy, h:mm a", { locale: es })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cartera */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Cartera</h2>
          {totalCartera > 0 && (
            <span className="badge badge-red">{formatCOP(totalCartera)} pendiente</span>
          )}
        </div>
        {cartera.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 text-sm">Sin saldos pendientes</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tratamiento</th>
                  <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Monto</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Vencida</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tipo pago</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Estado</th>
                </tr>
              </thead>
              <tbody>
                {cartera.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-5 text-sm text-slate-900">{c.treatment ?? '-'}</td>
                    <td className="py-3 px-5 text-right text-sm font-semibold text-slate-900">{formatCOP(c.amount)}</td>
                    <td className="py-3 px-5">
                      <span className={`badge ${c.days_overdue > 30 ? 'badge-red' : 'badge-amber'}`}>
                        {c.days_overdue}d
                      </span>
                    </td>
                    <td className="py-3 px-5">
                      <span className={`badge ${PAYMENT_COLORS[c.payment_type] ?? 'badge-slate'}`}>{c.payment_type}</span>
                    </td>
                    <td className="py-3 px-5">
                      <span className={`badge ${c.status === 'pendiente' ? 'badge-amber' : c.status === 'pagado' ? 'badge-green' : 'badge-red'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function MiniStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${valueClass ?? 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-700">{value}</p>
    </div>
  )
}
