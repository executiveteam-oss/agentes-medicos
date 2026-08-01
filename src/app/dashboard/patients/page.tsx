// ============================================================
// Pacientes v2 — Directorio con búsqueda + paginación server-side
// Ruta: /dashboard/patients?q=&page=&eps=
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { redirect } from 'next/navigation'
import { getPatientsList } from '@/app/actions/patients'
import { PatientsListV2 } from '@/components/dashboard/patients-list-v2'

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; eps?: string }>
}) {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)
  const sp = await searchParams
  const search = (sp.q ?? '').trim()
  const epsFilter = sp.eps ?? 'todas'
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const { patients, total, totalPages } = await getPatientsList({ page, search, epsFilter, restrictDoctorId })

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontWeight: 800, fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
          >
            Tus{' '}
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              pacientes
            </span>
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', marginTop: '4px', fontFamily: 'var(--font-manrope), sans-serif' }}>
            {total.toLocaleString('es-CO')} registrados{restrictDoctorId ? ' (tus pacientes)' : ''}
            {search ? ` · ${total.toLocaleString('es-CO')} coinciden con "${search}"` : ''}
          </p>
        </div>
      </div>

      <PatientsListV2
        patients={patients}
        total={total}
        page={page}
        totalPages={totalPages}
        search={search}
      />
    </div>
  )
}
