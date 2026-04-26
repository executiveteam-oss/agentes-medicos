import Link from 'next/link'

export default function PatientNotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-xl)', boxShadow: 'var(--v2-shadow)', padding: '48px 40px', textAlign: 'center', maxWidth: '420px', width: '100%', fontFamily: 'var(--font-manrope), sans-serif' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>Paciente no encontrado</h2>
        <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)', lineHeight: 1.5, marginBottom: '24px' }}>Este paciente no existe o fue eliminado.</p>
        <Link href="/dashboard/patients" className="btn-v2-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>← Volver a pacientes</Link>
      </div>
    </div>
  )
}
