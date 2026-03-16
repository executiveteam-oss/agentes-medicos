// ============================================================
// Conversaciones del agente — Próximamente
// Ruta: /dashboard/conversations
// ============================================================

export default function ConversationsPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="card p-16 flex flex-col items-center justify-center min-h-96 text-center">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Conversaciones</h1>
        <p className="text-slate-500 text-sm mb-6">Historial de conversaciones del agente IA — próximamente</p>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          En desarrollo
        </div>
      </div>
    </div>
  )
}
