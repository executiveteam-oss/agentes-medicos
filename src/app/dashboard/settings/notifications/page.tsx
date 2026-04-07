// ============================================================
// Configuración de notificaciones — Tab 4
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getNotificationSettings } from '@/app/actions/clinic'
import { NotificationSettingsForm } from './notification-settings-form'
import type { NotificationSettings } from '@/types/database'

export default async function NotificationsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const data = await getNotificationSettings()

  const defaults: NotificationSettings = {
    reminder_72h: false,
    reminder_24h: true,
    reminder_2h: false,
    morning_report: true,
    morning_report_hour: '06:00',
    weekly_report: true,
    noshow_alert: false,
    noshow_alert_threshold: 30,
    overdue_billing_alert: false,
    overdue_billing_days: 30,
  }

  return <NotificationSettingsForm initialData={data ?? defaults} />
}
