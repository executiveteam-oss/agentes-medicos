import { Res256DownloadForm } from '@/components/dashboard/reports/res256-download-form'

export default function Res256Page() {
  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Resolución 256 — Oportunidad de Citas</h1>
      <p style={{ color: 'var(--v2-text-subtle)', marginTop: 8, fontSize: 14 }}>
        Reporte semestral del MinSalud (Resolución 256 de 2016, Registro Tipo 2).
        Genera un Excel con 12 columnas PISIS-compatible.
      </p>

      <div style={{ marginTop: 24 }}>
        <Res256DownloadForm />
      </div>

      <details style={{ marginTop: 32, fontSize: 13, color: 'var(--v2-text-subtle)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Reglas del reporte</summary>
        <ul style={{ marginTop: 12, lineHeight: 1.7 }}>
          <li>Especialidades incluidas: Ginecología, Obstetricia, Ecografía, Resonancia Magnética</li>
          <li>Ginecología y Obstetricia: solo la primera cita del año por paciente</li>
          <li>Ecografía y Resonancia Magnética: todas las citas</li>
          <li>Pacientes excluidos: pagos por Póliza o SOAT</li>
          <li>El xlsx tiene 2 hojas: &quot;Listas para PISIS&quot; e &quot;Incompletas&quot; (con campos faltantes resaltados en rojo)</li>
        </ul>
      </details>
    </div>
  )
}
