// ============================================================
// WhatsApp — Estado del agente + Configuración
// Ruta: /dashboard/whatsapp
// ============================================================

export const dynamic = 'force-dynamic'

import { getWhatsAppPageData } from '@/app/actions/whatsapp'
import { formatPhone } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import { WhatsAppConfigForm } from '@/components/dashboard/whatsapp-config-form'

export default async function WhatsAppPage() {
  const { activeConversations, config, doctors } = await getWhatsAppPageData()

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">WhatsApp</h1>
        <p className="text-slate-500 text-sm">Estado del agente y configuración</p>
      </div>

      {/* ==================== SECCIÓN 1: ESTADO DEL AGENTE ==================== */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Conversaciones activas hoy
          </h2>
          <span className="badge badge-blue">{activeConversations.length}</span>
        </div>

        {activeConversations.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-slate-500 text-sm">No hay conversaciones activas hoy</p>
          </div>
        ) : (
          <div className="card overflow-hidden divide-y divide-slate-100">
            {activeConversations.map((conv) => (
              <div
                key={conv.id}
                className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-slate-900 truncate">{conv.patient_name}</p>
                    <span className="text-xs text-slate-400">{formatPhone(conv.patient_phone)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {conv.last_message.length > 60
                      ? conv.last_message.slice(0, 60) + '...'
                      : conv.last_message}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-slate-400">
                      {format(new Date(conv.last_message_at), 'h:mm a', { locale: es })}
                    </p>
                    <p className="text-xs text-slate-400">{conv.message_count} msgs</p>
                  </div>
                  <Link
                    href="/dashboard/conversations"
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    Ver
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ==================== SECCIÓN 2: CONFIGURACIÓN ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Configuración del agente
        </h2>
        <WhatsAppConfigForm initialConfig={config} doctors={doctors} />
      </section>
    </div>
  )
}
