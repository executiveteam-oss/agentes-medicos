// ============================================================
// Calendar shared types and helpers
// ============================================================

export interface CalendarAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: string
  attendance_outcome: 'admitido' | 'facturado' | 'inasistente' | null
  survey_sent: boolean
  survey_sent_at: string | null
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
  /** El servicio tal como lo manda iSalud. Se muestra cuando la cita no está
   *  vinculada al catálogo — que es el 22% de las importadas, porque el mismo
   *  procedimiento existe en varias filas y elegir una fabricaría un precio. */
  external_service_name?: string | null
  /** El campo `aseguradora` crudo de iSalud, para separarlo en la UI. */
  external_aseguradora?: string | null
  /** Documento tal como lo manda iSalud ("CC 1053813866"). Es lo único que hay
   *  cuando la cita no está enlazada a una ficha — la mitad de las importadas. */
  external_identificacion?: string | null
  /** Origen de la cita. 'whatsapp_agent' es la única donde payment_type es un dato real. */
  source?: string | null
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
    first_name: string | null
    entidad: string | null
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

// `confirmed` se muestra como "Agendada", NO como "Confirmada".
//
// Es el status TÉCNICO de la fila: el sync de iSalud lo pone en 'confirmed' a
// toda cita que llega con paciente, sin que nadie confirme nada. Las
// secretarias lo leían como "la paciente confirmó al recibir el recordatorio"
// —en la misma tarjeta donde dice "Recordatorio: No enviado"—, y con eso
// dejaban de llamar a pacientes que nunca habían confirmado.
//
// Quien SÍ responde "¿la paciente confirmó?" es `reminder_confirmed`, y se
// muestra aparte en la fila "Recordatorio" del panel.
//
// Solo cambia la etiqueta. El valor 'confirmed' en la DB no se toca: lo usan
// BUSY_STATUSES, el índice único de doble-booking y los crons.
export const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Agendada', rescheduled: 'Reagendada', completed: 'Completada',
  no_show: 'No-show', blocked_external: 'Cupo compartido', cancelled: 'Cancelada',
}

// ============================================================
// `blocked_external` NO es "un bloqueo de agenda". En Algia son 400 filas y las
// 400 tienen paciente real: son citas que iSalud puso en un cupo YA ocupado, y
// como el índice único de Omuwan no admite dos citas con el mismo inicio, el
// sync las degrada a este estado para no perderlas.
//
// Hasta hoy se pintaban EXACTAMENTE igual que una `confirmed` —mismo fondo,
// mismo borde—, así que en la agenda eran indistinguibles de una cita normal.
// Y no lo son: no tienen botones de asistencia (`quick-actions.tsx:98` devuelve
// null) y no cuentan en las métricas del día. Alguien que la ve normal espera
// poder marcarla y no puede.
// ============================================================

/** El `reason` que escribe el sync cuando la fila NO tiene paciente. */
export const BLOQUEO_SIN_PACIENTE = 'Bloqueo iSalud'

/** Un `blocked_external` con nombre es una PACIENTE en cupo compartido; sin
 *  nombre es un bloqueo de agenda de verdad. Se ven distinto y se dicen
 *  distinto. Una sola función para que las tres vistas no diverjan. */
export function esCupoCompartido(status: string, reason?: string | null): boolean {
  return status === 'blocked_external' && (reason ?? '').trim() !== BLOQUEO_SIN_PACIENTE
}

export function etiquetaEstado(status: string, reason?: string | null): string {
  if (status === 'blocked_external') {
    return esCupoCompartido(status, reason) ? 'Cupo compartido' : 'Bloqueo de agenda'
  }
  return STATUS_LABELS[status] ?? status
}

export const STATUS_STYLES: Record<string, { bg: string; fg: string; dot: string }> = {
  confirmed: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', dot: 'var(--v2-primary)' },
  rescheduled: { bg: 'var(--v2-amber-soft)', fg: '#b07d00', dot: 'var(--v2-amber)' },
  completed: { bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)', dot: 'var(--v2-green)' },
  no_show: { bg: 'var(--v2-red-soft)', fg: 'var(--v2-red)', dot: 'var(--v2-red)' },
  // Rosa, no violeta: tenía el MISMO color que `confirmed` y por eso pasaba
  // desapercibida. Distinta de amber (`rescheduled`) y de rojo (`no_show`),
  // que ya significan otra cosa.
  blocked_external: { bg: 'var(--v2-pink-soft)', fg: '#a3306b', dot: 'var(--v2-pink)' },
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


// ============================================================
// ¿LA PACIENTE CONFIRMÓ AL RESPONDER EL RECORDATORIO?
//
// Sale de `appointments.reminder_confirmed`, el MISMO dato que alimenta la fila
// "Confirmación" del panel de detalle. Una sola fuente para la pregunta.
//
// Es una dimensión ORTOGONAL al estado de la cita: una cita puede estar
// Agendada y confirmada, o Agendada y rechazada. Por eso NO se pinta con el
// mismo mecanismo que el estado —el fondo de la píldora sigue siendo suyo— sino
// encima: un símbolo, y para el caso malo también el borde izquierdo.
//
// Y es ASIMÉTRICO a propósito. "Confirmó" es la buena noticia y le alcanza un
// ✓ discreto. "No confirmó" es la que la secretaria tiene que cazar barriendo
// la columna con la vista para llamarla o liberar el cupo, así que grita.
//
// Los colores esquivan los seis que ya significan algo: violeta (agendada),
// ámbar (reagendada), verde (completada / "atiende" en la grilla), rojo oscuro
// (no-show), rosa (cupo compartido / cerrado) y gris (cancelada / fuera de
// horario). Teal y rojo-naranja saturado quedaban libres.
// ============================================================
export interface MarcaConfirmacion {
  color: string
  simbolo: string
  label: string
  /** true = además del símbolo, tiñe el borde izquierdo. Solo el caso malo. */
  resalta: boolean
}

export const CONFIRMO: MarcaConfirmacion = {
  color: '#0E7C86', simbolo: '✓', label: 'Confirmó', resalta: false,
}
export const NO_CONFIRMO: MarcaConfirmacion = {
  color: '#D4351C', simbolo: '✕', label: 'No confirmó', resalta: true,
}

/** null = sin respuesta o sin recordatorio → se ve como hoy, SIN cambio.
 *  Es la abrumadora mayoría (2.929 de 2.933 al escribir esto) y no puede
 *  leerse como un problema. */
export function marcaConfirmacion(reminderConfirmed: boolean | null | undefined): MarcaConfirmacion | null {
  if (reminderConfirmed === true) return CONFIRMO
  if (reminderConfirmed === false) return NO_CONFIRMO
  return null
}
