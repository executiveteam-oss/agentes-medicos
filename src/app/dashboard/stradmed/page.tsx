// ============================================================
// STRADmed — Partnership page para gestión financiera
// Ruta: /dashboard/stradmed
// ============================================================

import Link from 'next/link'

const OMUWAN_FEATURES = [
  'Agendamiento inteligente 24/7',
  'Recordatorios anti no-shows',
  'Gestión de pacientes',
  'Documentos previos automáticos',
  'WhatsApp multi-médico',
]

const STRADMED_FEATURES = [
  'Dashboard financiero completo',
  'Control de cartera y glosas EPS',
  'Facturación e ingresos',
  'Insights de rentabilidad con IA',
  'Benchmarks del sector salud colombiano',
]

export default function STRADmedPage() {
  const waUrl = 'https://wa.me/573015525881?text=' + encodeURIComponent(
    'Hola, soy cliente de Omuwan y quiero conocer STRADmed'
  )

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
          Completa tu consultorio con STRADmed
        </h1>
        <p className="text-slate-500 mt-2 max-w-2xl">
          Omuwan gestiona tu operación. STRADmed gestiona tus finanzas.
        </p>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Omuwan */}
        <div className="card-v2 p-6">
          <div className="flex items-center gap-3 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/omuwan-logo.png" alt="Omuwan" className="w-8 h-8 rounded-md" />
            <h2 className="text-lg font-semibold text-slate-900">Omuwan hace</h2>
          </div>
          <ul className="space-y-3">
            {OMUWAN_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* STRADmed */}
        <div className="card-v2 p-6 border-[var(--v2-primary)]/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-md bg-[var(--v2-primary)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">STRADmed hace</h2>
          </div>
          <ul className="space-y-3">
            {STRADMED_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                <svg className="w-4 h-4 text-[var(--v2-primary)] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* CTA Card */}
      <div className="bg-[var(--v2-primary)] rounded-xl p-6 lg:p-8 text-white">
        <h3 className="text-lg font-semibold mb-2">Descuento exclusivo para clientes Omuwan</h3>
        <p className="text-white/80 text-sm mb-6">
          Menciona que eres cliente de Omuwan al contactar STRADmed y obtén condiciones especiales.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="https://stradmedsoft.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white text-[var(--v2-primary)] font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-white/90 transition-colors"
          >
            Conocer STRADmed &rarr;
          </Link>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            Hablar con el equipo &rarr;
          </a>
        </div>
      </div>
    </div>
  )
}
