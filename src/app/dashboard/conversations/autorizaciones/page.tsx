// ============================================================
// AUTORIZACIONES PENDIENTES — Bloque 4
// Ruta: /dashboard/conversations/autorizaciones
//
// Lista de archivos de autorización direccionada que pacientes
// enviaron por WhatsApp y están pendientes de revisión humana.
//
// Gate: authorizationsReview (no conversations.write).
// ============================================================

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { listPendingAuthorizations } from '@/app/actions/authorization-review'
import { AuthorizationReviewList } from '@/components/dashboard/authorization-review-list'

export const dynamic = 'force-dynamic'

export default async function AuthorizationsInboxPage(): Promise<React.JSX.Element> {
  const session = await getUserSession()
  if (!session) redirect('/login')

  if (!session.authorizationsReview) {
    return (
      <div style={{ padding: '32px' }}>
        <div className="card-v2" style={{ padding: '48px', textAlign: 'center', maxWidth: '500px', margin: '0 auto' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</p>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>
            No tienes permiso para revisar autorizaciones
          </p>
          <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>
            Aprobar/rechazar autorizaciones requiere un permiso especial. Pedile al
            administrador del consultorio que actualice tu rol.
          </p>
        </div>
      </div>
    )
  }

  const r = await listPendingAuthorizations()
  const items = r.ok ? (r.items ?? []) : []

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>
          🛡 Autorizaciones pendientes
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>
          Archivos de autorización direccionada que los pacientes enviaron por WhatsApp.
          Revisalos y decidí: aprobás (creás cita) o rechazás (notificás al paciente).
          {items.length > 0 && <span> Hay <strong>{items.length}</strong> pendientes.</span>}
        </p>
      </div>

      {!r.ok && (
        <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '13px' }}>
          {r.error ?? 'Error desconocido'}
        </div>
      )}

      {r.ok && items.length === 0 && (
        <div className="card-v2" style={{ padding: '32px', textAlign: 'center' }}>
          <p style={{ fontSize: '32px', marginBottom: '8px' }}>✓</p>
          <p style={{ fontSize: '14px', fontWeight: 600 }}>No hay autorizaciones pendientes</p>
          <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
            Cuando un paciente envíe una autorización por WhatsApp aparecerá acá.
          </p>
        </div>
      )}

      {r.ok && items.length > 0 && (
        <AuthorizationReviewList items={items} />
      )}
    </div>
  )
}
