// ============================================================
// Página de configuración — redirige a /settings/clinic
// ============================================================

import { redirect } from 'next/navigation'

export default function SettingsPage() {
  redirect('/dashboard/settings/clinic')
}
