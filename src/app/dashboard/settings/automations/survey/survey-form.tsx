'use client'

import { useState, useTransition } from 'react'
import { updateSurveyConfig } from '@/app/actions/survey-config'
import type { SurveyConfig } from '@/lib/rules/survey-config'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, CheckCircle2 } from 'lucide-react'

// Texto fijo del template — DEBE coincidir con lo que la clínica pega en Meta
// Business Manager. Si cambia acá pero no en Meta, el envío falla con code 132001.
// El snapshot test protege contra ediciones accidentales.
export const TEMPLATE_BODY_TEXT =
  'Buen día {{1}}. Sería tan amable de diligenciar la encuesta de satisfacción de {{2}}. Gracias por ayudarnos a mejorar nuestra atención.'
export const TEMPLATE_BUTTON_TEXT = 'Responder encuesta'
export const TEMPLATE_DEFAULT_NAME = 'encuesta_satisfaccion'

interface Props {
  initialConfig: SurveyConfig
  featureFlagEnabled: boolean
  clinicName: string
  canWrite: boolean
}

export function SurveyForm({ initialConfig, featureFlagEnabled, clinicName, canWrite }: Props) {
  const [config, setConfig] = useState<SurveyConfig>(initialConfig)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const canToggleActive = Boolean(config.form_url && config.template_name)
  const isFormUrlValid = !config.form_url || isValidHttpsUrl(config.form_url)
  const displayName = config.clinic_display_name?.trim() || clinicName || '[Nombre de tu clínica]'

  function save(patch: Partial<SurveyConfig>): void {
    startTransition(async () => {
      const r = await updateSurveyConfig(patch)
      if (r.ok) {
        setSaved(true)
        setError(null)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setError(r.error ?? 'Error guardando')
      }
    })
  }

  return (
    <>
      {/* Alerta si feature flag maestro está OFF */}
      {!featureFlagEnabled && (
        <div
          style={{
            padding: '12px 14px',
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: 'var(--v2-radius)',
            fontSize: '12px',
            color: '#78350f',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <strong>Este feature está en beta.</strong> Contactá a soporte en{' '}
            <a href="mailto:soporte@omuwan.co" style={{ color: '#78350f', textDecoration: 'underline' }}>
              soporte@omuwan.co
            </a>{' '}
            para habilitarlo en tu clínica. Podés dejar todo configurado desde ahora — el envío
            arranca cuando se active.
          </div>
        </div>
      )}

      {/* Toggle principal + estado */}
      <div
        style={{
          padding: '16px 18px',
          background: config.enabled ? '#ecfdf5' : 'var(--v2-bg-card)',
          border: `1px solid ${config.enabled ? '#a7f3d0' : 'var(--v2-border-soft)'}`,
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '2px' }}>
            {config.enabled ? '✅ Encuesta activa' : 'Encuesta desactivada'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
            {config.enabled
              ? 'Se enviará automáticamente después de cada consulta facturada.'
              : canToggleActive
                ? 'Todo listo para activar. Prendé el switch.'
                : 'Completá los campos de abajo primero.'}
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={!canWrite || !canToggleActive}
            onChange={(e) => {
              const enabled = e.target.checked
              setConfig({ ...config, enabled })
              save({ enabled })
            }}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              position: 'absolute',
              cursor: canWrite && canToggleActive ? 'pointer' : 'not-allowed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: config.enabled ? '#10b981' : '#cbd5e1',
              borderRadius: '24px',
              transition: '0.2s',
              opacity: !canWrite || !canToggleActive ? 0.5 : 1,
            }}
          >
            <span
              style={{
                position: 'absolute',
                content: '""',
                height: '18px',
                width: '18px',
                left: config.enabled ? '23px' : '3px',
                top: '3px',
                background: 'white',
                borderRadius: '50%',
                transition: '0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </span>
        </label>
      </div>

      {/* Sección: Configuración de la plantilla */}
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '2px' }}>
            Configuración de la plantilla
          </div>
          <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
            Los valores que la plantilla usa para personalizar cada mensaje.
          </div>
        </div>

        <FormField label="URL del formulario" hint="Google Forms, Typeform, o cualquier link HTTPS. Se abre con el botón del mensaje.">
          <input
            type="url"
            placeholder="https://forms.gle/tu-form"
            value={config.form_url ?? ''}
            disabled={!canWrite}
            onChange={(e) => setConfig({ ...config, form_url: e.target.value || null })}
            onBlur={() => save({ form_url: config.form_url })}
            className="input-v2"
            style={{ fontSize: '13px', width: '100%' }}
          />
          {config.form_url && !isFormUrlValid && (
            <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px' }}>
              La URL debe empezar con https://
            </div>
          )}
        </FormField>

        <FormField
          label="Nombre de la clínica en el mensaje"
          hint={`Cómo querés que aparezca tu clínica en el texto. Si lo dejás vacío usamos "${clinicName}".`}
        >
          <input
            type="text"
            placeholder={clinicName}
            value={config.clinic_display_name ?? ''}
            disabled={!canWrite}
            onChange={(e) => setConfig({ ...config, clinic_display_name: e.target.value || null })}
            onBlur={() => save({ clinic_display_name: config.clinic_display_name })}
            className="input-v2"
            style={{ fontSize: '13px', width: '100%' }}
          />
        </FormField>

        <FormField
          label="Nombre del template en Meta"
          hint="El nombre exacto con el que aprobaron la plantilla en Meta Business Manager. Solo cambialo si aprobaron con un nombre distinto."
        >
          <input
            type="text"
            value={config.template_name}
            disabled={!canWrite}
            onChange={(e) => setConfig({ ...config, template_name: e.target.value })}
            onBlur={() => save({ template_name: config.template_name })}
            className="input-v2"
            style={{ fontSize: '13px', width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
          />
        </FormField>
      </div>

      {/* Preview del mensaje */}
      <MessagePreview firstName="María" clinicName={displayName} formUrl={config.form_url} />

      {/* Onboarding accordion */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setShowOnboarding(!showOnboarding)}
          style={{
            width: '100%',
            padding: '14px 18px',
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>
              📋 Cómo aprobar la plantilla en Meta Business Manager
            </span>
          </div>
          {showOnboarding ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {showOnboarding && <OnboardingGuide />}
      </div>

      {/* Advanced (colapsable) */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            width: '100%',
            padding: '12px 18px',
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--v2-text-muted)',
            textAlign: 'left',
          }}
        >
          <span>Configuración avanzada</span>
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {showAdvanced && (
          <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <FormField
              label="Guardrail (horas)"
              hint="Solo enviar si la cita fue hace menos de N horas. Evita mandar encuestas extemporáneas si el cron cayó unos días."
            >
              <input
                type="number"
                min={1}
                max={168}
                value={config.guardrail_hours}
                disabled={!canWrite}
                onChange={(e) => setConfig({ ...config, guardrail_hours: Number(e.target.value) })}
                onBlur={() => save({ guardrail_hours: config.guardrail_hours })}
                className="input-v2"
                style={{ fontSize: '13px', width: '120px' }}
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Errors / saved */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: 'var(--v2-radius)',
            fontSize: '12px',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <div style={{ fontSize: '12px', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle2 size={14} /> Guardado
        </div>
      )}
      {isPending && !error && !saved && (
        <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Guardando…</div>
      )}
    </>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, marginBottom: '4px', color: 'var(--v2-text)' }}>
        {label}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '4px', lineHeight: 1.4 }}>{hint}</div>
      )}
    </div>
  )
}

function MessagePreview({
  firstName,
  clinicName,
  formUrl,
}: {
  firstName: string
  clinicName: string
  formUrl: string | null
}) {
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>Vista previa del mensaje</div>
      <div style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', marginBottom: '12px' }}>
        Así lo verá la paciente en su WhatsApp.
      </div>
      <div
        style={{
          padding: '14px',
          background: '#d1fae5',
          borderRadius: '10px 10px 10px 2px',
          maxWidth: '360px',
          border: '1px solid #a7f3d0',
        }}
      >
        <div style={{ fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
          Buen día <strong>{firstName}</strong>.
          <br /><br />
          Sería tan amable de diligenciar la encuesta de satisfacción de <strong>{clinicName}</strong>.
          <br /><br />
          Gracias por ayudarnos a mejorar nuestra atención.
        </div>
        <div
          style={{
            marginTop: '10px',
            padding: '10px',
            background: 'white',
            border: '1px solid #a7f3d0',
            borderRadius: '6px',
            textAlign: 'center',
            fontSize: '13px',
            fontWeight: 600,
            color: '#0369a1',
          }}
        >
          🔗 Responder encuesta
        </div>
      </div>
      {!formUrl && (
        <div style={{ fontSize: '11px', color: '#a16207', marginTop: '8px', fontStyle: 'italic' }}>
          ⚠ El botón no funcionará hasta que agregues el link del formulario.
        </div>
      )}
    </div>
  )
}

function OnboardingGuide() {
  const [copiedName, setCopiedName] = useState<string | null>(null)

  function copy(key: string, value: string): void {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedName(key)
      setTimeout(() => setCopiedName(null), 1500)
    })
  }

  return (
    <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', margin: 0, lineHeight: 1.5 }}>
        Cada clínica opera con su propio Meta Business Manager, por lo que la plantilla se aprueba
        una vez por clínica. Es un trámite de ~15 min + tiempo de aprobación de Meta (24-72h).
      </p>

      <Step number={1} title="Abrir Meta Business Manager">
        <p style={{ margin: 0 }}>
          Andá a{' '}
          <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--v2-primary)' }}>
            business.facebook.com
          </a>{' '}
          → tu cuenta de WhatsApp Business → <strong>Message Templates</strong> → click en
          <strong> Create Template</strong>.
        </p>
      </Step>

      <Step number={2} title="Datos de la plantilla">
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Category:</span>
          <code style={codeChip()}>UTILITY</code>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Name:</span>
          <CopyChip value={TEMPLATE_DEFAULT_NAME} copiedName={copiedName} onCopy={copy} />
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Language:</span>
          <code style={codeChip()}>Spanish (COL)</code>
        </div>
      </Step>

      <Step number={3} title="Body (cuerpo del mensaje)">
        <p style={{ margin: '0 0 6px 0' }}>Pegá este texto <strong>exactamente</strong> en el campo BODY:</p>
        <CopyBox
          keyName="body"
          value={TEMPLATE_BODY_TEXT}
          copiedName={copiedName}
          onCopy={copy}
        />
        <div style={{ marginTop: '8px', padding: '10px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '11.5px', color: '#78350f' }}>
          Meta te va a pedir <strong>sample values</strong> para las variables:
          <br />
          - <code>{'{{1}}'}</code> → <code>María</code>
          <br />
          - <code>{'{{2}}'}</code> → el nombre de tu clínica
        </div>
      </Step>

      <Step number={4} title="Botón CTA (Call-to-Action)">
        <p style={{ margin: '0 0 6px 0' }}>
          En la sección <strong>Buttons</strong> agregá un botón tipo <em>Call to Action</em>:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Type:</span>
          <code style={codeChip()}>Visit Website</code>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Text:</span>
          <CopyChip value={TEMPLATE_BUTTON_TEXT} copiedName={copiedName} onCopy={copy} />
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>URL Type:</span>
          <code style={codeChip()}>Dynamic</code>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>URL:</span>
          <CopyChip value="{{1}}" copiedName={copiedName} onCopy={copy} />
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>Sample URL:</span>
          <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>
            Poné una URL real de tu form (ej. tu link de Google Forms)
          </span>
        </div>
      </Step>

      <Step number={5} title="Submit">
        <p style={{ margin: 0 }}>
          Click en <strong>Submit</strong>. Meta responde en 24-72h. Cuando quede aprobada, volvé acá,
          completá la URL del formulario, y activá el toggle de arriba.
        </p>
      </Step>

      <div
        style={{
          padding: '10px 12px',
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: '6px',
          fontSize: '11.5px',
          color: '#78350f',
        }}
      >
        <strong>Si Meta rechaza la plantilla</strong> es probablemente por la categoría (asegurate de
        elegir <em>UTILITY</em>, NO <em>MARKETING</em>) o el sample de URL. Escribinos a{' '}
        <a href="mailto:soporte@omuwan.co" style={{ color: '#78350f', textDecoration: 'underline' }}>
          soporte@omuwan.co
        </a>{' '}
        si te trabás.
      </div>
    </div>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: 'var(--v2-primary)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {number}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--v2-text)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  )
}

function CopyChip({
  value,
  copiedName,
  onCopy,
}: {
  value: string
  copiedName: string | null
  onCopy: (k: string, v: string) => void
}) {
  const isCopied = copiedName === value
  return (
    <button
      onClick={() => onCopy(value, value)}
      style={{
        ...codeChip(),
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        justifyContent: 'space-between',
        width: 'fit-content',
        border: `1px solid ${isCopied ? '#10b981' : 'var(--v2-border-soft)'}`,
      }}
    >
      <span>{value}</span>
      {isCopied ? <CheckCircle2 size={12} color="#10b981" /> : <Copy size={12} />}
    </button>
  )
}

function CopyBox({
  keyName,
  value,
  copiedName,
  onCopy,
}: {
  keyName: string
  value: string
  copiedName: string | null
  onCopy: (k: string, v: string) => void
}) {
  const isCopied = copiedName === keyName
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        value={value}
        readOnly
        rows={3}
        style={{
          width: '100%',
          padding: '10px 40px 10px 12px',
          background: 'var(--v2-bg-soft)',
          border: `1px solid ${isCopied ? '#10b981' : 'var(--v2-border-soft)'}`,
          borderRadius: '6px',
          fontSize: '12px',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          resize: 'none',
        }}
      />
      <button
        onClick={() => onCopy(keyName, value)}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'white',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: '4px',
          padding: '4px 6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
        }}
      >
        {isCopied ? <CheckCircle2 size={12} color="#10b981" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function codeChip(): React.CSSProperties {
  return {
    padding: '3px 8px',
    background: 'var(--v2-bg-soft)',
    border: '1px solid var(--v2-border-soft)',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    color: 'var(--v2-text)',
    display: 'inline-block',
  }
}

function isValidHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}
