// ============================================================
// Layout de autenticación — Omuwan branded, sin sidebar
// Rutas: /login, /register
// ============================================================

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo y branding — Omuwan */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/omuwan-logo.png"
            alt="Omuwan"
            className="mx-auto mb-4"
            style={{ height: '64px', width: 'auto', borderRadius: '8px' }}
          />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Omuwan</h1>
          <p className="text-slate-500 text-sm mt-1">Agente IA para consultorios médicos</p>
        </div>
        {children}
      </div>
    </div>
  )
}
