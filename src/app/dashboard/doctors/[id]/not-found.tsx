import Link from 'next/link'
export default function DoctorNotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-xl)', boxShadow: 'var(--v2-shadow)', padding: '48px 40px', textAlign: 'center', maxWidth: '420px', width: '100%', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>Doctor no encontrado</h2>
        <Link href="/dashboard/doctors" className="btn-v2-primary" style={{ textDecoration: 'none', display: 'inline-block', marginTop: '16px' }}>← Volver a médicos</Link>
      </div>
    </div>
  )
}
