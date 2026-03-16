// ============================================================
// Layout de autenticación — sin sidebar, centrado
// Rutas: /login, /register
// ============================================================

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo y branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-700 mb-4">
            <span className="text-2xl font-bold text-white">O</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Omuwan</h1>
          <p className="text-slate-500 text-sm mt-1">Agente IA para consultorios</p>
        </div>
        {children}
      </div>
    </div>
  )
}
