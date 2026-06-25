// ============================================================
// Redirect 308 — la sección se movió a /dashboard/doctors
// (top-level "Médicos, servicios y convenios" desde 2026-06-25)
//
// Preservamos esta ruta para que bookmarks/links viejos sigan
// funcionando. La página real vive en /dashboard/doctors.
// ============================================================

import { permanentRedirect } from 'next/navigation'

export default function DoctorsSettingsRedirect(): never {
  permanentRedirect('/dashboard/doctors')
}
