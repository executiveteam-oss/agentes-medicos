// ============================================================
// Contrato y Legal — Tab 5 (Configuración)
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildPrivacyNotice } from '@/lib/legal/privacy-notice'
import { PrivacyPolicyUrlForm } from '@/components/dashboard/privacy-policy-url-form'

export default async function LegalSettingsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  // Cargar la clínica para mostrar el aviso REAL (mismo que envía el agente) +
  // la URL de política configurada. Sin esto, la pantalla mostraba un texto
  // divergente del que el código realmente manda.
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('name, privacy_policy_url')
    .eq('id', session.clinicId)
    .single()
  const clinicName = clinic?.name ?? 'tu clínica'
  const realNotice = buildPrivacyNotice(clinicName)
  const canWriteSettings = session.permissions.settings?.write ?? false

  return (
    <div className="space-y-6">
      {/* Estado del contrato */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Contrato de servicio</h3>
        <p className="text-xs text-slate-400 mb-5">
          Términos y condiciones del uso de Omuwan en tu consultorio.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-lg">📋</span>
            <div>
              <p className="text-sm font-medium text-amber-900">Contrato pendiente</p>
              <p className="text-xs text-amber-700 mt-1">
                El contrato de prestación de servicios se enviará cuando tu plan esté activo.
                Incluye términos de uso, política de datos y acuerdo de procesamiento.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Cumplimiento legal */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Cumplimiento normativo</h3>
        <p className="text-xs text-slate-400 mb-5">
          Omuwan cumple con la normatividad colombiana del sector salud.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
            Ley 1581/2012 — Protección de datos personales
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
            Resolución 1995/1999 — Historia clínica electrónica
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
            Ley 23/1981 — Ética médica y secreto profesional
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
            Artículo 15 Constitución — Habeas data
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <Link
            href="/dashboard/legal"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Ver información legal completa →
          </Link>
        </div>
      </div>

      {/* Política de privacidad del agente */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Aviso de privacidad del agente</h3>
        <p className="text-xs text-slate-400 mb-5">
          El agente envía automáticamente un aviso de privacidad en el primer contacto con cada paciente nuevo,
          según lo exige la Ley 1581/2012.
        </p>

        <p className="text-xs text-slate-500 mb-2">Texto exacto que envía el agente hoy:</p>
        <div className="bg-slate-50 rounded-lg px-4 py-3 mb-5">
          <p className="text-xs text-slate-600 italic whitespace-pre-line">{realNotice}</p>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <PrivacyPolicyUrlForm initialUrl={clinic?.privacy_policy_url ?? null} canWrite={canWriteSettings} />
        </div>
      </div>
    </div>
  )
}
