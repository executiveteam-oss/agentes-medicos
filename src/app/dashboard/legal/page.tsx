// ============================================================
// Página Legal — Cumplimiento normativo colombiano
// Ruta: /dashboard/legal
// Informativa: explica cómo Omuwan cumple la ley colombiana
// ============================================================

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// --- Tipos ---

interface LegalSection {
  badge: string
  badgeColor: 'green' | 'amber'
  title: string
  requires: string[]
  complies: string[]
  note?: string
}

const LEGAL_SECTIONS: LegalSection[] = [
  {
    badge: 'Ley 1581/2012',
    badgeColor: 'green',
    title: 'Protección de Datos Personales',
    requires: [
      'Autorización expresa del titular antes de recopilar datos personales',
      'Los datos de salud son "datos sensibles" — protección reforzada',
      'Derecho del paciente a conocer, actualizar y eliminar sus datos (Derechos ARCO)',
    ],
    complies: [
      'El agente de WhatsApp envía aviso de privacidad y solicita autorización antes de recopilar cualquier dato en la primera interacción',
      'Los datos se almacenan cifrados en servidores seguros (Supabase/AWS)',
      'Endpoints ARCO implementados: exportación y anonimización de datos por paciente',
      'Nunca se comparten datos con terceros sin autorización',
    ],
  },
  {
    badge: 'Res. 1995/1999',
    badgeColor: 'green',
    title: 'Historia Clínica',
    requires: [
      'La historia clínica es confidencial y reservada',
      'Solo personal autorizado puede acceder a ella',
      'Debe conservarse mínimo 20 años',
    ],
    complies: [
      'El sistema de roles y permisos controla quién puede ver qué información de cada paciente',
      'Audit log completo de cada acción sobre datos de pacientes',
      'Omuwan registra el historial de citas y contactos, no la historia clínica — esta sigue siendo responsabilidad del médico',
    ],
    note: 'La historia clínica como tal debe gestionarse en el software médico del consultorio',
  },
  {
    badge: 'Ley 23/1981',
    badgeColor: 'green',
    title: 'Ética Médica y Confidencialidad',
    requires: [
      'El médico debe guardar secreto profesional',
      'Información del paciente no puede divulgarse sin su consentimiento',
    ],
    complies: [
      'Las conversaciones de WhatsApp son privadas y accesibles solo al personal autorizado del consultorio',
      'El agente nunca revela información de un paciente a otro',
      'Multi-tenant estricto: cada clínica ve únicamente sus propios datos',
    ],
  },
  {
    badge: 'Dec. 4747/2007',
    badgeColor: 'green',
    title: 'Facturación y Glosas',
    requires: [
      'Las facturas deben radicarse con soportes completos',
      'Las EPS tienen 20 días hábiles para formular glosas',
      'Las IPS tienen 15 días hábiles para responder glosas',
    ],
    complies: [
      'El módulo de Facturación rastrea fechas de radicación',
      'Alertas automáticas cuando una factura EPS lleva más de 15 días sin respuesta',
      'Estado de glosas visible en el dashboard con días transcurridos',
    ],
  },
  {
    badge: 'Ley 2015/2020',
    badgeColor: 'amber',
    title: 'Historia Clínica Electrónica e Interoperabilidad',
    requires: [
      'Las IPS deben avanzar hacia la Historia Clínica Electrónica interoperable con el sistema nacional',
      'Implementación progresiva por fases definidas por el MinSalud',
    ],
    complies: [
      'Omuwan gestiona datos de agendamiento y contacto de pacientes, no historia clínica',
      'La interoperabilidad de HC es responsabilidad del software médico del consultorio',
    ],
    note: 'Esta ley aplica a su software de historia clínica, no a Omuwan. Verifique con su proveedor médico.',
  },
  {
    badge: 'Art. 15 Const.',
    badgeColor: 'green',
    title: 'Habeas Data — Derechos ARCO del Paciente',
    requires: [
      'Acceso: el paciente puede pedir sus datos',
      'Rectificación: puede corregir datos incorrectos',
      'Cancelación: puede pedir que se eliminen sus datos',
      'Oposición: puede oponerse al tratamiento',
    ],
    complies: [
      'Exportación de datos por paciente en formato JSON desde el dashboard',
      'Anonimización completa de datos del paciente bajo solicitud',
      'Respuesta garantizada en máximo 10 días hábiles (según Ley 1581)',
      'Audit log de todas las solicitudes ARCO',
    ],
  },
]

const CLINIC_RESPONSIBILITIES = [
  'Registrar la Política de Tratamiento de Datos ante la SIC (Superintendencia de Industria y Comercio)',
  'Designar un responsable interno del tratamiento de datos',
  'Gestionar la historia clínica en software habilitado por el MinSalud',
  'Firmar contrato de encargo de tratamiento de datos con Omuwan (disponible en Configuración)',
]

export default async function LegalPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cumplimiento legal</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cómo Omuwan cumple con la normatividad colombiana para el sector salud
        </p>
      </div>

      {/* Legal sections */}
      <div className="space-y-5">
        {LEGAL_SECTIONS.map((section) => (
          <LegalCard key={section.badge} section={section} />
        ))}
      </div>

      {/* Clinic responsibilities */}
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-amber-900">Responsabilidades del consultorio</h2>
            <p className="text-amber-800 text-sm mt-1">
              Estas obligaciones son responsabilidad directa del consultorio, no de Omuwan:
            </p>
          </div>
        </div>
        <ul className="space-y-2.5 ml-11">
          {CLINIC_RESPONSIBILITIES.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-amber-900 text-sm">{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <p className="text-slate-400 text-xs text-center">
        Esta información es orientativa y no constituye asesoría jurídica.
        Consulte con su abogado para asegurar el cumplimiento normativo completo.
      </p>
    </div>
  )
}

// ============================================================
// LegalCard — Una tarjeta por ley/resolución
// ============================================================

function LegalCard({ section }: { section: LegalSection }) {
  const badgeStyles = section.badgeColor === 'green'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : 'bg-amber-100 text-amber-800 border-amber-200'

  const borderStyle = section.badgeColor === 'green'
    ? 'border-slate-200'
    : 'border-amber-200'

  return (
    <div className={`card border ${borderStyle} overflow-hidden`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badgeStyles}`}>
          {section.badge}
        </span>
        <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Qué exige */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Qué exige</p>
          <ul className="space-y-2">
            {section.requires.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="text-slate-400 mt-0.5 flex-shrink-0">&bull;</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Cómo cumple Omuwan */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-3">Cómo cumple Omuwan</p>
          <ul className="space-y-2">
            {section.complies.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <svg className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Nota (si aplica) */}
      {section.note && (
        <div className="mx-5 mb-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-amber-800 text-sm">
            <span className="font-semibold">Nota:</span> {section.note}
          </p>
        </div>
      )}
    </div>
  )
}
