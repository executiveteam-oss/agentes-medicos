// ============================================================
// Página raíz — redirige según sesión
// Con sesión → /dashboard | Sin sesión → /login
// ============================================================

import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/session'

export default async function Home() {
  const session = await getUserSession()

  if (session) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
