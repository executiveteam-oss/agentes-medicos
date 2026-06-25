// ============================================================
// Redirect 308 — la sección se movió a /dashboard/doctors/[id]
// (top-level "Médicos, servicios y convenios" desde 2026-06-25)
// ============================================================

import { permanentRedirect } from 'next/navigation'

export default async function DoctorDetailSettingsRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  permanentRedirect(`/dashboard/doctors/${id}`)
}
