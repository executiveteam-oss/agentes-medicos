// ============================================================
// Configuración de notificaciones — Tab 4
// ============================================================

export const dynamic = 'force-dynamic'

import { getNotificationSettings } from '@/app/actions/clinic'
import { NotificationSettingsForm } from './notification-settings-form'
import type { NotificationSettings } from '@/types/database'

export default async function NotificationsPage() {
  const data = await getNotificationSettings()

  const defaults: NotificationSettings = {
    reminder_24h: true,
    reminder_2h: false,
    morning_report: true,
    morning_report_hour: '06:00',
    noshow_alert: false,
    noshow_alert_threshold: 30,
    overdue_billing_alert: false,
    overdue_billing_days: 30,
  }

  return <NotificationSettingsForm initialData={data ?? defaults} />
}
