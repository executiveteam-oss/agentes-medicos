'use client'

// ============================================================
// IntegrationsPanel — Panel de integraciones externas
// ============================================================

import { useState, useTransition, useEffect } from 'react'
import {
  requestHisIntegration,
  saveSheetsEmail,
  saveHisCredentials,
  testHisConnection,
  getCredentialFieldsForSoftware,
} from '@/app/actions/integrations'
import type { IntegrationsConfig, CredentialField } from '@/app/actions/integrations'

const HIS_OPTIONS = [
  'Asdrual Gutiérrez',
  'Medilink',
  'AxisMed',
  'Huli',
  'Isalud',
  'Otro',
  'No uso software de HC',
]

interface Props {
  config: IntegrationsConfig
}

export function IntegrationsPanel({ config }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="space-y-8">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      <HisSection config={config.his} onToast={showToast} />
      <SheetsSection config={config.sheets} onToast={showToast} />
      <ComingSoonCard
        icon="💳"
        title="Cobro en línea — Wompi / PayU"
        description="Genera links de pago y cobra consultas directamente por WhatsApp."
      />
      <ComingSoonCard
        icon="📧"
        title="Confirmaciones por correo"
        description="Envía confirmaciones y recordatorios de citas al correo del paciente."
      />
    </div>
  )
}

// ============================================================
// Sección 1 — Historia Clínica Electrónica
// ============================================================

function HisSection({ config, onToast }: {
  config: IntegrationsConfig['his']
  onToast: (msg: string) => void
}) {
  const [software, setSoftware] = useState(config.software || '')
  const [customName, setCustomName] = useState(config.custom_software_name || '')
  const [contact, setContact] = useState(config.contact_info || '')
  const [notes, setNotes] = useState(config.notes || '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [requestSent, setRequestSent] = useState(
    config.request_status === 'requested' || config.request_status === 'in_progress' || config.request_status === 'connected'
  )

  const showForm = software && software !== 'No uso software de HC'
  const showCredentials = requestSent && showForm

  function handleSubmit() {
    if (!software) { setError('Selecciona un software'); return }
    if (showForm && !contact.trim()) { setError('El contacto del ingeniero es obligatorio'); return }
    setError('')
    startTransition(async () => {
      const result = await requestHisIntegration({
        software, custom_software_name: customName, contact_info: contact, notes,
      })
      if (result.ok) {
        setRequestSent(true)
        onToast('Solicitud de integración enviada')
      } else {
        setError(result.error ?? 'Error')
      }
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏥</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Historia Clínica Electrónica</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Conecta Omuwan con tu software de historia clínica para sincronizar pacientes y citas automáticamente.
            </p>
          </div>
          <HisStatusBadge requestStatus={config.request_status} connectorStatus={config.connector_status} />
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Software selector */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-3 block">Software de HC</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {HIS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => { setSoftware(option); setRequestSent(false) }}
                disabled={requestSent}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                  software === option
                    ? 'border-blue-600 bg-blue-50 text-blue-800 font-medium ring-1 ring-blue-600'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                } ${requestSent ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {/* Custom name */}
        {software === 'Otro' && !requestSent && (
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre del software</label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Ej: MiSoftware HC"
              className="input-field text-sm w-full"
            />
          </div>
        )}

        {/* Request form (pre-credenciales) */}
        {showForm && !requestSent && (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Email o teléfono del ingeniero responsable de la integración
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Para coordinar la integración API"
                className="input-field text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Información adicional</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Versión del software, datos relevantes..."
                rows={2}
                className="input-field text-sm w-full resize-none"
              />
            </div>

            {error && <p className="text-red-600 text-xs">{error}</p>}

            <div className="flex items-center gap-3">
              <button onClick={handleSubmit} disabled={isPending} className="btn-primary text-sm disabled:opacity-50">
                {isPending ? 'Enviando...' : 'Solicitar integración'}
              </button>
              <span className="text-xs text-slate-400">Te contactaremos en 1-2 días hábiles</span>
            </div>
          </div>
        )}

        {/* Credential configuration (post-solicitud) */}
        {showCredentials && (
          <HisCredentialsForm
            software={software}
            connectorStatus={config.connector_status}
            lastSync={config.last_sync}
            errorMessage={config.error_message}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================
// Formulario de credenciales HIS
// ============================================================

function HisCredentialsForm({ software, connectorStatus, lastSync, errorMessage, onToast }: {
  software: string
  connectorStatus: string | null
  lastSync: string | null
  errorMessage: string | null
  onToast: (msg: string) => void
}) {
  const [fields, setFields] = useState<CredentialField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null)
  const [status, setStatus] = useState(connectorStatus)

  useEffect(() => {
    getCredentialFieldsForSoftware(software).then((f) => {
      setFields(f)
      const initial: Record<string, string> = {}
      f.forEach((field) => { initial[field.key] = '' })
      setValues(initial)
    })
  }, [software])

  function handleSave() {
    startTransition(async () => {
      const result = await saveHisCredentials(values)
      if (result.ok) {
        onToast('Credenciales guardadas')
        setStatus('pending')
      } else {
        onToast(result.error ?? 'Error')
      }
    })
  }

  function handleTest() {
    setTestResult(null)
    startTransition(async () => {
      const result = await testHisConnection()
      if (result.ok) {
        setTestResult('ok')
        setStatus('active')
        onToast('Conexión exitosa')
      } else {
        setTestResult('error')
        setStatus('error')
        onToast(result.error ?? 'Error de conexión')
      }
    })
  }

  return (
    <div className="pt-4 border-t border-slate-100 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Configurar integración</h3>
        {status === 'active' && <span className="badge badge-green">Conectado</span>}
        {status === 'error' && <span className="badge badge-red">Error</span>}
        {status === 'pending' && <span className="badge badge-amber">Pendiente</span>}
      </div>

      {errorMessage && status === 'error' && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMessage}</p>
      )}

      {/* Dynamic credential fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{field.label}</label>
            <input
              type={field.type === 'password' ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="input-field text-sm w-full"
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {isPending ? 'Guardando...' : 'Guardar credenciales'}
        </button>
        <button
          onClick={handleTest}
          disabled={isPending}
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Probando...' : 'Probar conexión'}
        </button>

        {testResult === 'ok' && (
          <span className="text-sm text-emerald-600 font-medium">Conexión exitosa</span>
        )}
        {testResult === 'error' && (
          <span className="text-sm text-red-600 font-medium">No se pudo conectar</span>
        )}
      </div>

      {/* Last sync */}
      {lastSync && (
        <p className="text-xs text-slate-400">
          Última sincronización: {new Date(lastSync).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
        </p>
      )}
    </div>
  )
}

// ============================================================
// Status badge para HIS
// ============================================================

function HisStatusBadge({ requestStatus, connectorStatus }: {
  requestStatus: string
  connectorStatus: string | null
}) {
  if (connectorStatus === 'active') return <span className="badge badge-green">Conectado</span>
  if (connectorStatus === 'error') return <span className="badge badge-red">Error</span>
  if (connectorStatus === 'pending') return <span className="badge badge-amber">Pendiente</span>
  if (requestStatus === 'requested') return <span className="badge badge-amber">Solicitud enviada</span>
  if (requestStatus === 'in_progress') return <span className="badge badge-blue">En proceso</span>
  if (requestStatus === 'connected') return <span className="badge badge-green">Conectado</span>
  return null
}

// ============================================================
// Sección 2 — Google Sheets
// ============================================================

function SheetsSection({ config, onToast }: {
  config: IntegrationsConfig['sheets']
  onToast: (msg: string) => void
}) {
  const [email, setEmail] = useState(config.email || '')
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleSaveEmail() {
    startTransition(async () => {
      const result = await saveSheetsEmail(email)
      if (result.ok) {
        setSaved(true)
        onToast('Email de Google Sheets guardado')
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Sincronización con Google Sheets</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Exporta tus citas automáticamente a una hoja de cálculo de Google.
            </p>
          </div>
          {config.connected ? (
            <span className="badge badge-green">Conectado</span>
          ) : (
            <span className="badge badge-slate">Sin conectar</span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Correo de Google para vincular</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setSaved(false) }}
              placeholder="tu@gmail.com"
              className="input-field text-sm flex-1"
            />
            <button
              onClick={handleSaveEmail}
              disabled={isPending || !email.trim()}
              className="btn-primary text-sm whitespace-nowrap disabled:opacity-50"
            >
              {isPending ? '...' : saved ? 'Guardado' : 'Guardar'}
            </button>
          </div>
        </div>

        {config.connected && config.sheet_id && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
            <a
              href={`https://docs.google.com/spreadsheets/d/${config.sheet_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              Abrir hoja de cálculo
            </a>
          </div>
        )}

        {!config.connected && (
          <p className="text-xs text-slate-400">
            Guarda tu correo y contacta soporte para configurar la sincronización automática.
          </p>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Card genérica "Próximamente"
// ============================================================

function ComingSoonCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="card overflow-hidden opacity-75">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          </div>
          <span className="badge badge-slate">Próximamente</span>
        </div>
      </div>
      <div className="px-5 py-4">
        <button disabled className="bg-slate-100 text-slate-400 text-sm font-medium py-2 px-4 rounded-lg cursor-not-allowed">
          Disponible pronto
        </button>
      </div>
    </div>
  )
}
