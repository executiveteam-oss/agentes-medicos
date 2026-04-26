// ============================================================
// Pagina raiz — Landing publica o redirect a /dashboard
// ============================================================

import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/session'
import { LandingPage } from '@/components/landing/landing-page'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Omuwan — El agente WhatsApp que agenda tus citas y reduce no-shows hasta 34%',
  description:
    'Tus pacientes agendan, confirman y reagendan solos por WhatsApp. Tu equipo deja de copiar citas a mano. Y tus no-shows bajan hasta 34%. Para consultorios de 1 a 10 medicos en Colombia.',
}

export default async function Home() {
  const session = await getUserSession()
  if (session) redirect('/dashboard')

  return <LandingPage />
}
