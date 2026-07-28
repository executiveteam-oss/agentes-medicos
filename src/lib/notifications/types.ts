// ============================================================
// Staff notification types
// ============================================================

export type NotificationType = 'appointment_canceled' | 'appointment_rescheduled' | 'appointment_moved' | 'conversation_escalated' | 'crisis_detected' | 'data_rights_request'

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
  refreshed_at: string | null
}

export interface NotificationPayload {
  type: NotificationType
  title: string
  body?: string
  metadata: Record<string, unknown>
  navigateTo: string
}
