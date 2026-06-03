// ============================================================
// Calendar shared types and helpers
// ============================================================

export interface CalendarAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: string
  reason: string | null
  reminder_24h_sent: boolean
  reminder_confirmed: boolean | null
  payment_type: string
  modality: string
  virtual_link: string | null
  documents_requested: boolean
  documents_received: boolean
  free_text_reason: string | null
  consultation_type_name?: string | null
  doctor_id: string | null
  patient: {
    id: string
    name: string
    phone: string
    no_show_probability: number
    no_show_count: number
    total_appointments: number
    document_type: string
    document_number: string | null
    date_of_birth: string | null
    doctor_notes: string | null
    data_consent_at: string | null
  } | null
  doctor: {
    name: string
    specialty: string | null
  } | null
}

export interface CalendarDoctor {
  id: string
  name: string
  agenda_closed?: boolean
}

export type ViewMode = 'day' | 'week' | 'month'

// ---- Date helpers ----

export const DAYS_ES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
export const DAYS_FULL_ES = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
export const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7am - 8pm

export const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmada', rescheduled: 'Reagendada', completed: 'Completada',
  no_show: 'No-show', blocked_external: 'iSalud', cancelled: 'Cancelada',
}

export const STATUS_STYLES: Record<string, { bg: string; fg: string; dot: string }> = {
  confirmed: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', dot: 'var(--v2-primary)' },
  rescheduled: { bg: 'var(--v2-amber-soft)', fg: '#b07d00', dot: 'var(--v2-amber)' },
  completed: { bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)', dot: 'var(--v2-green)' },
  no_show: { bg: 'var(--v2-red-soft)', fg: 'var(--v2-red)', dot: 'var(--v2-red)' },
  blocked_external: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', dot: 'var(--v2-primary)' },
  cancelled: { bg: 'var(--v2-bg-deeper)', fg: 'var(--v2-text-subtle)', dot: 'var(--v2-text-subtle)' },
}

export const DOCTOR_COLORS = [
  { dot: 'var(--v2-primary)', soft: 'var(--v2-primary-soft)' },
  { dot: 'var(--v2-pink)', soft: 'var(--v2-pink-soft)' },
  { dot: 'var(--v2-green)', soft: 'var(--v2-green-soft)' },
  { dot: 'var(--v2-amber)', soft: 'var(--v2-amber-soft)' },
  { dot: '#5444E5', soft: 'rgba(84,68,229,0.1)' },
  { dot: '#FF8EC4', soft: 'rgba(255,142,196,0.1)' },
]

export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getColombiaDateStr(iso: string): string {
  const d = new Date(iso)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return toDateStr(col)
}

export function getColombiaHour(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getTime() - 5 * 60 * 60 * 1000).getUTCHours()
}

export function getColombiaMinutes(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getTime() - 5 * 60 * 60 * 1000).getUTCMinutes()
}

export function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

export function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}
