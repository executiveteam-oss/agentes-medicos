'use client'

// ============================================================
// Pantalla de bloqueo para features desactivadas
// Muestra precio Plus según rango de médicos + CTA WhatsApp
// ============================================================

import Link from 'next/link'

const UPGRADE_PHONE = '573015525881'

// Precios Plus por módulo y rango de médicos [1, 2-3, 4-6, 7-10]
const PLUS_PRICES: Record<string, number[]> = {
  'Reactivación de pacientes':     [75_000, 120_000, 165_000, 220_000],
  'Insights de rentabilidad':      [90_000, 145_000, 200_000, 265_000],
  'Dashboard financiero completo': [85_000, 130_000, 180_000, 240_000],
  'Consultas virtuales':           [65_000, 100_000, 140_000, 185_000],
  'Planificación de vacaciones':   [40_000,  65_000,  90_000, 120_000],
}

function getDoctorTierIndex(doctorCount: number | null | undefined): number {
  if (!doctorCount || doctorCount <= 1) return 0
  if (doctorCount <= 3) return 1
  if (doctorCount <= 6) return 2
  return 3
}

function formatCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO')
}

interface FeatureLockedProps {
  featureName: string
  featureDescription: string
  whatsappMessage: string
  clinicName?: string
  plusModuleName?: string   // Nombre que coincide con PLUS_PRICES
  doctorCount?: number | null
}

export function FeatureLocked({
  featureName,
  featureDescription,
  whatsappMessage,
  clinicName,
  plusModuleName,
  doctorCount,
}: FeatureLockedProps) {
  const fullMessage = clinicName
    ? `Hola, soy ${clinicName} y ${whatsappMessage} en mi plan de Omuwan.`
    : `Hola, ${whatsappMessage} en mi plan de Omuwan.`

  const waUrl = `https://wa.me/${UPGRADE_PHONE}?text=${encodeURIComponent(fullMessage)}`

  // Calcular precio Plus si aplica
  const prices = plusModuleName ? PLUS_PRICES[plusModuleName] : null
  const tierIndex = getDoctorTierIndex(doctorCount)
  const price = prices ? prices[tierIndex] : null

  return (
    <div className="p-6 lg:p-8 flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Lock icon */}
        <div className="mx-auto w-20 h-20 rounded-full bg-[#028090]/10 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-[#028090]"
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

        {/* Title */}
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">
            Esta función no está activa en tu plan
          </h2>
          <span className="inline-block bg-[#028090] text-white text-sm font-medium px-3 py-1 rounded-full">
            {featureName}
          </span>
          <p className="text-sm text-slate-500 leading-relaxed">
            {featureDescription}
          </p>
          {price && (
            <p className="text-lg font-bold text-[#028090]">
              {formatCOP(price)}/mes
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-[#028090] hover:bg-[#026d7a] text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Activar módulo Plus
          </a>
          <Link
            href="/dashboard"
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            Ver mis features activas
          </Link>
        </div>
      </div>
    </div>
  )
}
