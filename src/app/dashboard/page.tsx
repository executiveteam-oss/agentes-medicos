// ============================================================
// DASHBOARD — Vista de citas del día
// Ruta: /dashboard
//
// Muestra:
// - Banner punto de equilibrio (completadas / meta diaria)
// - Alerta de festivos próximos
// - Citas del día con semáforo de no-show
// - Botones Confirmó / No-show por cita
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { formatTimeForPatient, nowColombia, formatCOP, formatPhone } from '@/lib/utils/dates'
import { festivosProximos } from '@/lib/utils/festivos'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { NewAppointmentButton, CancelAppointmentButton } from '@/components/dashboard/dashboard-actions'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

const PAYMENT_COLORS: Record<string, string> = {
  EPS: 'bg-blue-50 text-blue-700',
  Particular: 'bg-emerald-50 text-emerald-700',
  Póliza: 'bg-purple-50 text-purple-700',
  ARL: 'bg-amber-50 text-amber-700',
  SOAT: 'bg-yellow-50 text-yellow-700',
}

const INVOICE_COLORS: Record<string, string> = {
  pendiente: 'bg-amber-50 text-amber-700',
  emitida: 'bg-emerald-50 text-emerald-700',
  vencida: 'bg-red-50 text-red-700',
}

export default async function DashboardPage() {
  const now = nowColombia()
  const today = format(now, 'yyyy-MM-dd')
  const todayFormatted = format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })

  const session = await getUserSession()
  if (!session) redirect('/login')

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('*')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-4">🏥</p>
          <p className="text-slate-900 font-semibold text-lg mb-1">No hay clínica configurada</p>
          <p className="text-slate-500 text-sm">Completa el onboarding para empezar</p>
        </div>
      </div>
    )
  }

  // Doctores activos (para el modal de nueva cita)
  const { data: activeDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .order('name')

  // Citas del día con datos del paciente y doctor
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, reason, reminder_24h_sent, reminder_confirmed,
      payment_type, invoice_status, outstanding_balance,
      patients(id, name, phone, no_show_probability, no_show_count, total_appointments, document_type, document_number, date_of_birth, doctor_notes, data_consent_at),
      doctors(name, specialty)
    `)
    .eq('clinic_id', clinic.id)
    .in('status', ['confirmed', 'rescheduled', 'completed', 'no_show'])
    .gte('starts_at', `${today}T00:00:00-05:00`)
    .lte('starts_at', `${today}T23:59:59-05:00`)
    .order('starts_at', { ascending: true })

  // Estadísticas
  const { count: totalAllTime } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])

  const { count: totalNoShows } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .eq('status', 'no_show')

  const completedToday = (appointments ?? []).filter((a) => a.status === 'completed').length
  const dailyGoal = clinic.daily_goal_appointments ?? 8
  const goalPercent = Math.min(Math.round((completedToday / dailyGoal) * 100), 100)

  const noShowRate = totalAllTime && totalAllTime > 0
    ? Math.round(((totalNoShows ?? 0) / totalAllTime) * 100)
    : 0

  // Festivos en los próximos 3 días
  const festivosAlert = festivosProximos(3)

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{clinic.name}</h1>
          {Array.isArray(clinic.specialty) && clinic.specialty.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {clinic.specialty.map((spec: string) => (
                <span key={spec} className="badge badge-blue">
                  {spec}
                </span>
              ))}
            </div>
          )}
          <p className="text-slate-500 capitalize text-sm mt-1">{todayFormatted}</p>
        </div>
        <NewAppointmentButton doctors={(activeDoctors ?? []) as { id: string; name: string; specialty: string | null }[]} />
      </div>

      {/* Alerta festivos */}
      {festivosAlert.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-sm">📅</span>
          </div>
          <p className="text-amber-800 text-sm font-medium">
            Festivo próximo: {festivosAlert.map((f) => `${f.nombre} (${f.fecha})`).join(', ')}
          </p>
        </div>
      )}

      {/* Banner punto de equilibrio */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Punto de equilibrio del día</p>
          <span className="text-slate-900 font-semibold text-sm">{completedToday} / {dailyGoal} citas</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              goalPercent >= 100 ? 'bg-emerald-500' : goalPercent >= 60 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${goalPercent}%` }}
          />
        </div>
        <p className="text-slate-400 text-xs mt-2">{goalPercent}% de la meta diaria</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Citas hoy"
          value={String(appointments?.length ?? 0)}
          iconBg="bg-blue-50"
          iconColor="text-blue-700"
          icon={<CalendarIcon />}
        />
        <StatCard
          label="Tasa no-show"
          value={`${noShowRate}%`}
          iconBg={noShowRate > 20 ? 'bg-red-50' : 'bg-emerald-50'}
          iconColor={noShowRate > 20 ? 'text-red-600' : 'text-emerald-600'}
          icon={<TrendIcon />}
        />
        <StatCard
          label="Precio consulta"
          value={clinic.consultation_price ? formatCOP(clinic.consultation_price) : '-'}
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
          icon={<PriceIcon />}
        />
      </div>

      {/* Leyenda */}
      <div className="flex gap-5 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Confirmó
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Pendiente
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Alto riesgo
        </span>
      </div>

      {/* Lista de citas */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Citas del día</h2>
        {(!appointments || appointments.length === 0) ? (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-slate-900 font-medium mb-1">No hay citas agendadas para hoy</p>
            <p className="text-slate-500 text-sm">Las citas nuevas aparecerán aquí automáticamente</p>
          </div>
        ) : (
          <div className="card divide-y divide-slate-100 overflow-hidden">
            {appointments.map((apt) => {
              const patient = apt.patients as unknown as {
                id: string; name: string; phone: string;
                no_show_probability: number; no_show_count: number;
                total_appointments: number; document_type: string;
                document_number: string; date_of_birth: string;
                doctor_notes: string; data_consent_at: string;
              } | null
              const doctor = apt.doctors as unknown as { name: string; specialty: string } | null

              const probability = patient?.no_show_probability ?? 0

              // Status indicator dot color
              let dotColor = 'bg-amber-400' // pendiente
              let rowBg = ''

              if ((apt as { reminder_confirmed?: boolean }).reminder_confirmed === true) {
                dotColor = 'bg-emerald-500'
              } else if (probability > 40) {
                dotColor = 'bg-red-500'
              }

              if (apt.status === 'completed') {
                dotColor = 'bg-emerald-500'
                rowBg = 'bg-emerald-50/50'
              } else if (apt.status === 'no_show') {
                dotColor = 'bg-red-500'
                rowBg = 'bg-red-50/50'
              }

              const paymentType = (apt as { payment_type?: string }).payment_type ?? 'Particular'
              const invoiceStatus = (apt as { invoice_status?: string }).invoice_status ?? 'pendiente'

              return (
                <details key={apt.id} className={`group ${rowBg}`}>
                  <summary className="cursor-pointer flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors list-none">
                    <div className="flex items-center gap-4">
                      {/* Status dot */}
                      <div className="flex-shrink-0">
                        <div className={`w-3 h-3 rounded-full ${dotColor}`} />
                      </div>
                      {/* Time + Patient */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-sm">
                            {formatTimeForPatient(apt.starts_at)}
                          </span>
                          <span className="text-slate-300">—</span>
                          <span className={`text-slate-700 text-sm font-medium ${apt.status === 'no_show' ? 'line-through text-slate-400' : ''}`}>
                            {patient?.name ?? 'Paciente'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {doctor && <span className="text-xs text-slate-400">{doctor.name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Badges */}
                      <span className={`badge ${PAYMENT_COLORS[paymentType] ?? 'badge-slate'}`}>
                        {paymentType}
                      </span>
                      <span className={`badge ${INVOICE_COLORS[invoiceStatus] ?? 'badge-slate'}`}>
                        {invoiceStatus}
                      </span>
                      {/* Risk indicator */}
                      {probability > 0 && apt.status !== 'completed' && apt.status !== 'no_show' && (
                        <span className={`text-xs font-medium ${probability > 40 ? 'text-red-600' : 'text-slate-400'}`}>
                          {probability}%
                        </span>
                      )}
                      {/* Completed / NoShow badges */}
                      {apt.status === 'completed' && <span className="badge badge-green">Completada</span>}
                      {apt.status === 'no_show' && <span className="badge badge-red">No-show</span>}
                      {/* Expand chevron */}
                      <svg className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </summary>

                  {/* Detalle del paciente (expandible) */}
                  {patient && (
                    <div className="px-5 pb-5 pt-2 bg-slate-50/50">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                        <DetailItem label="Teléfono" value={formatPhone(patient.phone)} />
                        <DetailItem label="Documento" value={`${patient.document_type} ${patient.document_number ?? 'No registrado'}`} />
                        <DetailItem label="Fecha de nacimiento" value={patient.date_of_birth ?? 'No registrada'} />
                        <DetailItem label="Doctor" value={doctor?.name ?? '-'} />
                        <DetailItem label="Motivo" value={apt.reason ?? 'No especificado'} />
                        <DetailItem
                          label="Recordatorio"
                          value={
                            (apt as { reminder_confirmed?: boolean }).reminder_confirmed === true ? 'Confirmó' :
                            (apt as { reminder_confirmed?: boolean }).reminder_confirmed === false ? 'No confirmó' :
                            apt.reminder_24h_sent ? 'Enviado, sin respuesta' : 'No enviado'
                          }
                          valueClass={
                            (apt as { reminder_confirmed?: boolean }).reminder_confirmed === true ? 'text-emerald-600' :
                            (apt as { reminder_confirmed?: boolean }).reminder_confirmed === false ? 'text-red-600' :
                            undefined
                          }
                        />
                        <DetailItem
                          label="Historial"
                          value={`${patient.total_appointments} citas, ${patient.no_show_count} no-shows`}
                        />
                        <DetailItem
                          label="Riesgo no-show"
                          value={`${probability}%`}
                          valueClass={probability > 40 ? 'text-red-600' : probability > 20 ? 'text-amber-600' : 'text-emerald-600'}
                        />
                      </div>
                      {patient.doctor_notes && (
                        <div className="mt-3 p-3 bg-white rounded-lg border border-slate-100">
                          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">Notas del doctor</p>
                          <p className="text-slate-700 text-sm">{patient.doctor_notes}</p>
                        </div>
                      )}

                      {/* Botones de acción rápida */}
                      <QuickActions
                        appointmentId={apt.id}
                        currentStatus={apt.status as 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'rescheduled'}
                      />
                      {(apt.status === 'confirmed' || apt.status === 'rescheduled') && (
                        <CancelAppointmentButton appointmentId={apt.id} />
                      )}
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({
  label,
  value,
  iconBg,
  iconColor,
  icon,
}: {
  label: string
  value: string
  iconBg: string
  iconColor: string
  icon: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center ${iconColor}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function DetailItem({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${valueClass ?? 'text-slate-700'}`}>{value}</p>
    </div>
  )
}

// Simple inline SVG icons for stat cards
function CalendarIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function TrendIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
    </svg>
  )
}

function PriceIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
