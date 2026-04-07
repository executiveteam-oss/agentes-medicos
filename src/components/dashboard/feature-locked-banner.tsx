'use client'

// ============================================================
// Banner inline para secciones bloqueadas dentro de una página
// (ej: sección de reactivación dentro de estadísticas)
// ============================================================

import Link from 'next/link'

const UPGRADE_PHONE = '573015525881'

interface FeatureLockedBannerProps {
  featureName: string
  whatsappMessage?: string
  clinicName?: string
}

export function FeatureLockedBanner({ featureName, whatsappMessage, clinicName }: FeatureLockedBannerProps) {
  const fullMessage = whatsappMessage
    ? clinicName
      ? `Hola, soy ${clinicName} y ${whatsappMessage} en mi plan de Omuwan.`
      : `Hola, ${whatsappMessage} en mi plan de Omuwan.`
    : null

  const waUrl = fullMessage
    ? `https://wa.me/${UPGRADE_PHONE}?text=${encodeURIComponent(fullMessage)}`
    : null

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-[#028090]/10 flex items-center justify-center mx-auto mb-3">
        <svg
          className="w-5 h-5 text-[#028090]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-900 mb-1">
        {featureName} no está activa
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Activa esta función para empezar a usarla.
      </p>
      <div className="flex items-center justify-center gap-3">
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-[#028090] hover:bg-[#026d7a] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Mejorar mi plan
          </a>
        ) : (
          <Link
            href="/dashboard/settings/plan"
            className="inline-flex items-center gap-1.5 bg-[#028090] hover:bg-[#026d7a] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Ir a Configuración
          </Link>
        )}
      </div>
    </div>
  )
}
