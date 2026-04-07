// ============================================================
// Banner para doctores sin doctor_id vinculado
// Se muestra cuando un usuario con rol Doctor no tiene
// su cuenta vinculada a un registro de doctor en la clínica.
// ============================================================

export function DoctorUnlinkedBanner() {
  return (
    <div className="p-6 lg:p-8">
      <div className="card p-12 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">🔗</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Cuenta no vinculada
        </h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          Tu cuenta aún no está vinculada a un médico.
          Contacta al administrador del consultorio para completar tu configuración.
        </p>
        <div className="mt-6 bg-slate-50 rounded-lg px-4 py-3">
          <p className="text-xs text-slate-400">
            El administrador debe ir a Configuración → Usuarios y vincular tu cuenta con tu perfil de médico.
          </p>
        </div>
      </div>
    </div>
  )
}
