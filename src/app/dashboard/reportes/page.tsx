import Link from 'next/link'

export default function ReportesPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Reportes</h1>
      <p style={{ color: 'var(--v2-text-subtle)', marginTop: 8 }}>
        Reportes regulatorios y operativos de la clínica.
      </p>

      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        <Link href="/dashboard/reportes/resolucion-256"
          style={{ border: '1px solid var(--v2-border-soft)', borderRadius: 12, padding: 16, display: 'block' }}>
          <div style={{ fontWeight: 700 }}>Resolución 256 — Oportunidad de Citas</div>
          <div style={{ fontSize: 12, color: 'var(--v2-text-subtle)' }}>
            MinSalud · Reporte semestral PISIS · Ginecología, Obstetricia, Ecografía, Resonancia Magnética
          </div>
        </Link>
      </div>
    </div>
  )
}
