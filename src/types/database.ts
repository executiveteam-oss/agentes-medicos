// ============================================================
// Tipos TypeScript para TODAS las tablas de Supabase
// Cada tipo refleja exactamente las columnas de la tabla SQL
// ============================================================

// --- Horarios de trabajo (usado por clínicas y doctores) ---
export interface WorkingDay {
  start: string   // "08:00"
  end: string     // "18:00"
  active: boolean // true = atiende ese día
}

export interface WorkingHours {
  monday: WorkingDay
  tuesday: WorkingDay
  wednesday: WorkingDay
  thursday: WorkingDay
  friday: WorkingDay
  saturday: WorkingDay
  sunday: WorkingDay
}

// --- FAQ personalizada de cada clínica ---
export interface FaqItem {
  pregunta: string
  respuesta: string
}

// --- Configuración WhatsApp del agente ---
export interface WhatsAppScheduleConfig {
  start: string          // "07:00"
  end: string            // "20:00"
  days: number[]         // 0=dom, 1=lun, ..., 6=sáb
  out_of_hours_message: string
}

export interface WhatsAppAppointmentConfig {
  default_duration: number   // minutos
  max_duration: number       // minutos
}

export interface WhatsAppDoctorConfig {
  active: boolean
  days: number[]             // días activos (0-6)
  start: string              // "08:00"
  end: string                // "18:00"
  duration: number           // duración de cita en minutos
}

export interface WhatsAppAutomations {
  post_consulta: {
    enabled: boolean
  }
  reactivacion: {
    enabled: boolean
    days_inactive: number              // días sin visita para considerar inactivo
  }
}

// --- Consultas virtuales (config por clínica) ---
export type VirtualPlatform = 'google_meet' | 'zoom' | 'teams' | 'custom' | 'isalud'

export interface VirtualConsultationConfig {
  enabled: boolean
  platform: VirtualPlatform
  base_url: string | null       // URL base para Zoom/Teams/Custom
  instructions: string | null   // Instrucciones para el paciente
}

export type ConsultationModality = 'presencial' | 'virtual' | 'ambas'
export type AppointmentModality = 'presencial' | 'virtual'

export interface WhatsAppConfig {
  schedule: WhatsAppScheduleConfig
  appointment: WhatsAppAppointmentConfig
  escalation_keywords: string[]
  doctors: Record<string, WhatsAppDoctorConfig>  // doctor_id → config
  automations: WhatsAppAutomations
}

// --- CLÍNICAS (tabla: clinics) ---
export interface Clinic {
  id: string
  name: string
  slug: string
  phone: string
  whatsapp_phone_id: string | null
  whatsapp_token: string | null
  whatsapp_access_token: string | null
  whatsapp_app_secret: string | null
  whatsapp_verify_token: string | null
  whatsapp_connected: boolean
  whatsapp_display_name: string | null
  whatsapp_phone_display: string | null
  whatsapp_connected_at: string | null
  address: string | null
  city: string
  department: string
  building: string | null                  // Edificio / Centro médico (migración 00015)
  floor: string | null                     // Piso (migración 00015)
  office: string | null                    // Consultorio / Oficina (migración 00015)
  specialty: string[]                      // Array de especialidades (migración 00008)
  consultation_price: number | null        // COP sin decimales
  consultation_duration_minutes: number
  working_hours: WorkingHours
  faq: FaqItem[]
  agent_name: string
  agent_personality: string
  welcome_message: string | null
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired'
  subscription_plan: 'core' | 'basic' | 'pro'
  trial_ends_at: string | null             // ISO 8601
  whatsapp_config: WhatsAppConfig | null    // Configuración del agente (migración 00012)
  google_sheet_id: string | null           // ID de Google Sheets vinculado
  doctor_email: string | null              // Email del doctor para compartir Sheet
  daily_goal_appointments: number          // Meta diaria (punto de equilibrio), migración 00006
  contact_email: string | null              // Email de contacto (migración 00016)
  website: string | null                    // Sitio web (migración 00016)
  logo_url: string | null                   // URL del logo (migración 00016)
  notification_settings: NotificationSettings // Config notificaciones (migración 00016)
  min_booking_advance_hours: number        // Mínimo horas de anticipación para agendar (migración 00024)
  max_booking_advance_days: number         // Máximo días hacia el futuro para agendar (migración 00024)
  virtual_config: VirtualConsultationConfig | null  // Config consultas virtuales (migración 00027)
  integrations: IntegrationsDbConfig | null // Config integraciones externas (migración 00032)
  feature_config: FeatureConfig | null     // Config features del configurador (migración 00039)
  preferred_plan: string | null            // Plan seleccionado en configurador
  expected_doctors: number | null          // Médicos esperados
  expected_monthly_appointments: number | null // Citas mensuales esperadas
  onboarded_at: string | null              // Null = no ha completado el wizard (migración 00007)
  created_at: string
  updated_at: string
}

// --- Integraciones externas ---
export interface HisCredentials {
  api_url?: string
  api_key?: string
  clinic_code?: string
  username?: string
  password?: string
  subdomain?: string
  token?: string
  [key: string]: string | undefined
}

export interface HisIntegrationConfig {
  software: string
  status: 'pending' | 'active' | 'error'
  credentials: HisCredentials
  last_sync: string | null
  error_message: string | null
}

export interface IntegrationsDbConfig {
  his?: HisIntegrationConfig
}

// --- CONFIGURACIÓN DE FEATURES (configurador de pricing) ---
export interface FeatureConfig {
  agent: boolean
  reminders_24h: boolean
  reminders_72h: boolean
  docs_required: boolean
  waitlist: boolean
  reactivation: boolean
  dashboard: boolean
  insights: boolean
  virtual: boolean
}

// --- NOTIFICACIONES ---
export interface NotificationSettings {
  reminder_72h: boolean
  reminder_24h: boolean
  reminder_2h: boolean
  morning_report: boolean
  morning_report_hour: string
  weekly_report: boolean
  noshow_alert: boolean
  noshow_alert_threshold: number
  overdue_billing_alert: boolean
  overdue_billing_days: number
}

// --- TIPOS DE CONSULTA (tabla: consultation_types) ---
export interface ConsultationType {
  id: string
  clinic_id: string
  doctor_id: string
  name: string
  duration_minutes: number
  requires_preparation: boolean
  preparation_instructions: string | null
  price: number | null            // COP
  is_active: boolean
  bookable_via_whatsapp: boolean  // Si el agente puede ofrecer este servicio (migración 00025)
  requires_documents: boolean     // Si requiere documentos previos (migración 00025)
  required_documents_description: string | null  // Instrucciones de documentos (migración 00025)
  modality: ConsultationModality  // presencial / virtual / ambas (migración 00027)
  created_at: string
}

// --- DOCTORES (tabla: doctors) ---
export type DoctorScheduleType = 'fixed' | 'manual'

export interface Doctor {
  id: string
  clinic_id: string
  name: string
  specialty: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  working_hours: WorkingHours | null       // null = usa horarios de la clínica
  agenda_closed: boolean                   // Agenda cerrada temporalmente (migración 00026)
  agenda_closed_reason: string | null      // Motivo del cierre (migración 00026)
  agenda_closed_until: string | null       // Fecha hasta la cual está cerrada YYYY-MM-DD (migración 00026)
  schedule_type: DoctorScheduleType        // fixed = horario fijo, manual = sin horario fijo (migración 00029)
  manual_availability_message: string | null // Mensaje para pacientes cuando schedule_type = manual (migración 00029)
  created_at: string
}

// --- PACIENTES (tabla: patients) ---
export type DocumentType = 'CC' | 'TI' | 'CE' | 'PP'

export interface Patient {
  id: string
  clinic_id: string
  name: string
  phone: string                            // +573XXXXXXXXX
  email: string | null
  document_type: DocumentType
  document_number: string | null
  date_of_birth: string | null             // YYYY-MM-DD
  eps: string | null
  notes: string | null
  no_show_count: number
  total_appointments: number
  data_consent_at: string | null           // null = no ha aceptado privacidad
  last_reactivation_sent: string | null    // YYYY-MM-DD, última reactivación enviada (migración 00020)
  visit_frequency_days: number | null      // Promedio días entre visitas (migración 00030)
  created_at: string
  updated_at: string
}

// --- CITAS (tabla: appointments) ---
export type AppointmentStatus =
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'rescheduled'

export type AppointmentSource =
  | 'whatsapp_agent'
  | 'manual'
  | 'dashboard'

export type PaymentType = 'EPS' | 'Particular' | 'Póliza' | 'ARL' | 'SOAT'

export type InvoiceStatus = 'pendiente' | 'emitida' | 'en_tramite' | 'pagada' | 'glosada' | 'vencida'

export type CollectionStatus = 'pendiente' | 'en_tramite' | 'cobrada' | 'glosada' | 'vencida'

export type GlosaStatus = 'none' | 'pending' | 'responded' | 'lifted' | 'definitive'

export type EpsName = 'Sura' | 'Compensar' | 'Nueva EPS' | 'Sanitas'

export interface Appointment {
  id: string
  clinic_id: string
  doctor_id: string
  patient_id: string
  starts_at: string                        // ISO 8601 en UTC
  ends_at: string
  status: AppointmentStatus
  reason: string | null
  source: AppointmentSource
  notes: string | null
  reminder_24h_sent: boolean
  reminder_2h_sent: boolean
  confirmation_received: boolean
  cancelled_at: string | null
  cancellation_reason: string | null
  payment_type: PaymentType               // Tipo de pago (migración 00006)
  invoice_status: InvoiceStatus           // Estado factura (migración 00006)
  outstanding_balance: number             // Saldo pendiente COP (migración 00006)
  eps_name: EpsName | null                // EPS que cubre al paciente (migración 00010)
  authorization_code: string | null       // Código autorización EPS (migración 00010)
  clinic_value: number                    // Valor cobrado por la clínica COP (migración 00010)
  eps_value: number                       // Valor que paga la EPS COP (migración 00010)
  patient_copago: number                  // Cuota moderadora COP (migración 00010)
  invoice_radication_date: string | null  // Fecha radicación YYYY-MM-DD (migración 00010)
  glosa_value: number                     // Monto glosa COP (migración 00010)
  glosa_reason: string | null             // Razón de la glosa (migración 00010)
  invoice_number: string | null           // N° factura del software externo (migración 00014)
  invoice_date: string | null             // Fecha emisión YYYY-MM-DD (migración 00014)
  invoice_amount: number | null           // Valor facturado COP (migración 00014)
  invoice_observations: string | null     // Notas de facturación (migración 00014)
  collection_status: CollectionStatus     // Estado cobro (migración 00014)
  followup_sent: boolean                 // Seguimiento post-consulta enviado (migración 00020)
  nps_score: number | null               // Calificación 1-10 del paciente (migración 00020)
  consultation_type_id: string | null    // Tipo de consulta (migración 00023)
  modality: AppointmentModality         // presencial / virtual (migración 00027)
  virtual_link: string | null           // Link de videollamada (migración 00027)
  virtual_link_sent_at: string | null   // Cuándo se envió el link (migración 00027)
  documents_requested: boolean         // Si la cita requiere documentos previos (migración 00028)
  documents_received: boolean          // Si los documentos fueron recibidos (migración 00028)
  documents_received_at: string | null // Cuándo se recibieron (migración 00028)
  documents_notes: string | null       // Notas sobre los documentos (migración 00028)
  glosa_notification_date: string | null  // Fecha notificación glosa YYYY-MM-DD (migración 00031)
  glosa_response_date: string | null      // Fecha respuesta glosa YYYY-MM-DD (migración 00031)
  glosa_status: GlosaStatus               // Estado de la glosa (migración 00031)
  glosa_notes: string | null              // Notas/argumentos de respuesta (migración 00031)
  external_his_id: string | null          // ID en sistema de HC externo (migración 00032)
  created_at: string
  updated_at: string
}

// --- CONVERSACIONES (tabla: conversations) ---
export type ConversationStatus = 'active' | 'resolved' | 'escalated'

export interface Conversation {
  id: string
  clinic_id: string
  patient_id: string | null
  whatsapp_phone: string
  status: ConversationStatus
  escalated_to: string | null
  escalated_at: string | null
  last_message_at: string
  context: Record<string, unknown>
  created_at: string
}

// --- MENSAJES (tabla: messages) ---
export type MessageRole = 'patient' | 'agent' | 'staff'

export interface Message {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  whatsapp_message_id: string | null
  message_type: string                     // text, image, audio, etc.
  metadata: Record<string, unknown>
  created_at: string
}

// --- RECORDATORIOS (tabla: reminders) ---
export type ReminderType = '24h' | '2h'
export type ReminderStatus = 'pending' | 'sent' | 'failed'
export type ReminderResponse = 'confirmed' | 'rescheduled' | 'cancelled' | 'no_response'

export interface Reminder {
  id: string
  appointment_id: string
  type: ReminderType
  scheduled_for: string
  sent_at: string | null
  status: ReminderStatus
  response: ReminderResponse | null
  created_at: string
}

// --- LISTA DE ESPERA (tabla: waitlist) ---
export type WaitlistStatus = 'waiting' | 'notified' | 'converted' | 'expired'
export type PreferredTime = 'morning' | 'afternoon' | 'any'

export type WaitlistPriority = 'normal' | 'urgente'

export type WaitlistSource = 'dashboard' | 'whatsapp'

export interface WaitlistEntry {
  id: string
  clinic_id: string
  patient_id: string
  doctor_id: string
  preferred_dates: string[]                // ["2026-02-15", "2026-02-16"]
  preferred_time: PreferredTime
  reason: string | null
  priority: WaitlistPriority               // normal | urgente (migración 00017)
  status: WaitlistStatus
  notified_at: string | null
  converted_appointment_id: string | null
  preferred_schedule_notes: string | null  // Notas de preferencia de horario (migración 00029)
  source: WaitlistSource                   // dashboard | whatsapp (migración 00029)
  consultation_type_name: string | null    // Tipo de consulta solicitado (migración 00029)
  created_at: string
}

// --- AUDITORÍA (tabla: audit_log) ---
export type ActorType = 'agent' | 'staff' | 'system' | 'patient'

export interface AuditLog {
  id: string
  clinic_id: string
  action: string
  actor_type: ActorType
  actor_id: string | null
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
}

// --- FACTURAS STANDALONE (tabla: invoices) ---
export interface Invoice {
  id: string
  clinic_id: string
  patient_id: string
  appointment_id: string | null
  invoice_number: string
  invoice_date: string              // YYYY-MM-DD
  invoice_amount: number            // COP sin decimales
  payment_type: string
  eps_name: string | null
  collection_status: CollectionStatus
  observations: string | null
  created_at: string
  updated_at: string
}

// --- CARTERA (tabla: cartera) ---
export type CarteraStatus = 'pendiente' | 'pagado' | 'castigado'

export interface CarteraEntry {
  id: string
  clinic_id: string
  patient_id: string
  appointment_id: string | null
  amount: number                           // COP sin decimales
  days_overdue: number
  treatment: string | null
  payment_type: PaymentType
  collection_attempts: number
  last_collection_at: string | null
  status: CarteraStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CarteraEntryWithDetails extends CarteraEntry {
  patient: Pick<Patient, 'name' | 'phone' | 'email' | 'no_show_count' | 'total_appointments'>
}

// --- ROLES DE CLÍNICA (tabla: clinic_roles) ---
import type { Permissions } from '@/types/permissions'

export interface ClinicRole {
  id: string
  clinic_id: string
  name: string
  description: string | null
  permissions: Permissions
  is_default: boolean
  created_at: string
}

// --- USUARIOS DE CLÍNICA (tabla: clinic_users) ---
export interface ClinicUser {
  id: string
  clinic_id: string
  auth_user_id: string
  full_name: string
  role_id: string | null
  is_active: boolean
  created_at: string
}

// --- Tipos auxiliares para consultas con JOINs ---
// Cuando consultamos una cita, a veces necesitamos el nombre del paciente y doctor
export interface AppointmentWithDetails extends Appointment {
  patient: Pick<Patient, 'name' | 'phone'>
  doctor: Pick<Doctor, 'name' | 'specialty'>
}
