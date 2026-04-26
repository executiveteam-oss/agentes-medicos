// ============================================================
// Banner para doctores sin doctor_id vinculado (v2)
// ============================================================

import { AlertTriangle } from 'lucide-react'

export function DoctorUnlinkedBanner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-xl)',
          boxShadow: 'var(--v2-shadow)',
          padding: '48px 40px',
          textAlign: 'center',
          maxWidth: '440px',
          width: '100%',
          fontFamily: 'var(--font-manrope), sans-serif',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'var(--v2-amber-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <AlertTriangle size={24} style={{ color: '#b07d00' }} />
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>
          Cuenta no vinculada
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--v2-text-muted)', lineHeight: 1.5 }}>
          Tu cuenta aun no esta vinculada a un medico. Contacta al administrador del consultorio para completar tu configuracion.
        </p>
        <div
          style={{
            marginTop: '20px',
            background: 'var(--v2-bg-soft)',
            borderRadius: 'var(--v2-radius)',
            padding: '12px 16px',
          }}
        >
          <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>
            El administrador debe ir a Configuracion → Usuarios y vincular tu cuenta con tu perfil de medico.
          </p>
        </div>
      </div>
    </div>
  )
}
