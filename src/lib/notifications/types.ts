// ============================================================
// Staff notification types
// ============================================================

export type NotificationType = 'appointment_canceled' | 'appointment_rescheduled' | 'appointment_moved'

export interface StaffNotification {
  id: string
  clinic_id: string
  recipient_user_id: string
  type: NotificationType
  title: string
  body: string | null
  metadata: Record<string, unknown>
  navigate_to: string | null
  read_at: string | null
  created_at: string
}

export interface NotificationPayload {
  type: NotificationType
  title: string
  body?: string
  metadata: {
    appointment_id?: string
    old_appointment_id?: string
    new_appointment_id?: string
    patient_id: string
    patient_name: string
    doctor_id: string
    doctor_name: string
    conversation_id: string
    old_starts_at?: string
    new_starts_at?: string
  }
  navigateTo: string
}
