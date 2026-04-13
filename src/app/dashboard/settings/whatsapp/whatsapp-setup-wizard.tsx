'use client'

// ============================================================
// Wizard guiado de configuración de WhatsApp Business API
// 5 pasos + bonus paso 6 (webhook):
// 1. Crear cuenta Meta Business
// 2. Crear App en Meta Developers
// 3. Conectar número de WhatsApp
// 4. Generar token permanente
// 5. Ingresar credenciales en Omuwan
// 6. (Bonus) Configurar Webhook
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { saveWhatsAppCredentials, checkFirstMessage } from '@/app/actions/whatsapp-credentials'
import type { WhatsAppCredentials, VerifyResult } from '@/app/actions/whatsapp-credentials'

interface Props {
  initialCredentials: WhatsAppCredentials
}

const TOTAL_STEPS = 5
const WEBHOOK_URL = 'https://agentes-medicos-ten.vercel.app/api/webhooks/whatsapp'

// ============================================================
// Iconos SVG por paso (sin emoji)
// ============================================================
function IconBuilding() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  )
}
function IconCode() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  )
}
function IconPhone() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
    </svg>
  )
}
function IconKey() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  )
}
function IconPlug() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}
function IconWebhook() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  )
}

// ============================================================
// Componente principal
// ============================================================

export function WhatsAppSetupWizard({ initialCredentials }: Props) {
  // Si ya conectado, ir al paso 6 (webhook). Si tiene phoneNumberId, paso 5.
  const initialStep = initialCredentials.connected ? 6 : initialCredentials.phoneNumberId ? 5 : 1
  const [step, setStep] = useState(initialStep)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(
    initialCredentials.connected
      ? { success: true, displayName: initialCredentials.displayName ?? undefined, phoneNumber: initialCredentials.phoneDisplay ?? undefined }
      : null
  )
  const [credentials, setCredentials] = useState(initialCredentials)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [showAppSecret, setShowAppSecret] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [webhookStatus, setWebhookStatus] = useState<'waiting' | 'connected'>(
    initialCredentials.connected ? 'connected' : 'waiting'
  )

  // Polling para verificar mensaje de prueba (paso 6)
  const pollForMessage = useCallback(async () => {
    if (webhookStatus === 'connected') return
    try {
      const result = await checkFirstMessage()
      if (result.received) setWebhookStatus('connected')
    } catch { /* silenciar */ }
  }, [webhookStatus])

  useEffect(() => {
    if (step !== 6 || webhookStatus === 'connected') return
    const interval = setInterval(pollForMessage, 15000)
    return () => clearInterval(interval)
  }, [step, webhookStatus, pollForMessage])

  async function handleSaveCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await saveWhatsAppCredentials(formData)

    setLoading(false)
    setVerifyResult(result)

    if (result.success) {
      setCredentials((prev) => ({
        ...prev,
        phoneNumberId: formData.get('phone_number_id')?.toString() ?? prev.phoneNumberId,
        accessTokenLast4: '...' + (formData.get('access_token')?.toString().slice(-4) ?? ''),
        appSecretLast4: '...' + (formData.get('app_secret')?.toString().slice(-4) ?? ''),
        connected: true,
        displayName: result.displayName ?? null,
        phoneDisplay: result.phoneNumber ?? null,
      }))
      setStep(6)
    } else {
      setError(result.error ?? 'Error desconocido')
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function goNext() { setStep((s) => Math.min(s + 1, 6)) }
  function goBack() { setStep((s) => Math.max(s - 1, 1)) }

  // Paso visual actual (para la barra de progreso, pasos 1-5, el 6 se muestra como completado)
  const displayStep = Math.min(step, TOTAL_STEPS)

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Configurar WhatsApp</h1>
        <p className="text-slate-500 text-sm mt-1">
          Conecta tu numero de WhatsApp Business con Omuwan paso a paso
        </p>
      </div>

      {/* Barra de progreso */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500">
            Paso {displayStep} de {TOTAL_STEPS}
          </span>
          <span className="text-xs text-slate-400">
            {Math.round((Math.min(step, TOTAL_STEPS) / TOTAL_STEPS) * 100)}% completado
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0f2a6e] rounded-full transition-all duration-500"
            style={{ width: `${(displayStep / TOTAL_STEPS) * 100}%` }}
          />
        </div>
        {/* Step dots */}
        <div className="flex justify-between mt-3">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => { if (num <= step) setStep(num) }}
              className={`flex flex-col items-center gap-1 ${num <= step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step > num
                  ? 'bg-emerald-500 text-white'
                  : step === num
                    ? 'bg-[#0f2a6e] text-white ring-4 ring-blue-100'
                    : 'bg-slate-100 text-slate-400'
              }`}>
                {step > num ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : num}
              </div>
              <span className={`text-[10px] font-medium hidden sm:block ${
                step >= num ? 'text-slate-700' : 'text-slate-400'
              }`}>
                {['Meta Business', 'App Meta', 'Numero', 'Token', 'Conectar'][num - 1]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ==================== PASO 1 ==================== */}
      {step === 1 && (
        <StepCard num={1} title="Crea tu cuenta de Meta Business" icon={<IconBuilding />}>
          <p className="text-sm text-slate-600 leading-relaxed">
            Para conectar WhatsApp necesitas una cuenta de Meta Business.
            Si ya la tienes, puedes saltarte este paso.
          </p>

          <div className="space-y-3 mt-5">
            <Instruction num={1}>
              Ve a <ExternalLink href="https://business.facebook.com">business.facebook.com</ExternalLink>
            </Instruction>
            <Instruction num={2}>
              Haz clic en <strong>&quot;Crear cuenta&quot;</strong>
            </Instruction>
            <Instruction num={3}>
              Ingresa el nombre de tu consultorio
            </Instruction>
            <Instruction num={4}>
              Verifica tu identidad con tu documento
            </Instruction>
            <Instruction num={5}>
              Espera la aprobacion (1-3 dias habiles)
            </Instruction>
          </div>

          <InfoBanner color="amber">
            Meta puede tardar hasta 3 dias en verificar tu negocio.
            Mientras tanto puedes configurar el resto de Omuwan.
          </InfoBanner>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <a
              href="https://business.facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-center flex items-center justify-center gap-2 flex-1"
            >
              Ir a business.facebook.com
              <ExternalIcon />
            </a>
            <button onClick={goNext} className="btn-navy flex-1">
              Ya tengo cuenta — Siguiente
            </button>
          </div>
          <SkipButton onClick={goNext} />
        </StepCard>
      )}

      {/* ==================== PASO 2 ==================== */}
      {step === 2 && (
        <StepCard num={2} title="Crea tu App en Meta Developers" icon={<IconCode />}>
          <div className="space-y-3">
            <Instruction num={1}>
              Ve a <ExternalLink href="https://developers.facebook.com">developers.facebook.com</ExternalLink>
            </Instruction>
            <Instruction num={2}>
              Haz clic en <strong>&quot;Mis apps&quot;</strong> y luego en <strong>&quot;Crear app&quot;</strong>
            </Instruction>
            <Instruction num={3}>
              Selecciona el tipo: <strong>&quot;Business&quot;</strong>
            </Instruction>
            <Instruction num={4}>
              Como nombre, usa algo como: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">[Tu consultorio] WhatsApp</code>
            </Instruction>
            <Instruction num={5}>
              Vincula tu Meta Business Account
            </Instruction>
            <Instruction num={6}>
              En el panel de tu app, busca <strong>&quot;Agregar productos&quot;</strong>
            </Instruction>
            <Instruction num={7}>
              Encuentra <strong>&quot;WhatsApp&quot;</strong> y haz clic en <strong>&quot;Configurar&quot;</strong>
            </Instruction>
          </div>

          <InfoBanner color="blue">
            Esta app es la que conecta tu numero de WhatsApp con Omuwan.
            Solo necesitas crearla una vez.
          </InfoBanner>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <a
              href="https://developers.facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-center flex items-center justify-center gap-2 flex-1"
            >
              Ir a developers.facebook.com
              <ExternalIcon />
            </a>
            <button onClick={goNext} className="btn-navy flex-1">
              Ya cree mi app — Siguiente
            </button>
          </div>
          <div className="flex justify-between mt-3">
            <button onClick={goBack} className="text-sm text-slate-500 hover:text-slate-700 font-medium">
              ← Atras
            </button>
            <SkipButton onClick={goNext} />
          </div>
        </StepCard>
      )}

      {/* ==================== PASO 3 ==================== */}
      {step === 3 && (
        <StepCard num={3} title="Conecta tu numero de WhatsApp" icon={<IconPhone />}>
          <div className="space-y-3">
            <Instruction num={1}>
              Dentro de tu app, ve a <strong>WhatsApp → Configuracion</strong>
            </Instruction>
            <Instruction num={2}>
              En <strong>&quot;Numeros de telefono&quot;</strong>, haz clic en <strong>&quot;Agregar numero de telefono&quot;</strong>
            </Instruction>
            <Instruction num={3}>
              Ingresa el numero que usara tu consultorio
            </Instruction>
            <Instruction num={4}>
              Verifica el numero con el codigo SMS
            </Instruction>
            <Instruction num={5}>
              Una vez verificado, veras tu <strong>Phone Number ID</strong> — copialo, lo necesitaras en el paso 5
            </Instruction>
          </div>

          {/* Highlight box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Tu Phone Number ID se ve asi:</p>
            <p className="font-mono text-lg text-slate-900 font-semibold">123456789012345</p>
            <p className="text-xs text-slate-400 mt-1">Solo numeros, aproximadamente 15 digitos</p>
          </div>

          <InfoBanner color="red">
            Usa un numero que NO este registrado en WhatsApp personal.
            Si ya esta registrado, primero debes eliminarlo de la app de WhatsApp.
          </InfoBanner>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button onClick={goBack} className="btn-secondary flex-1">← Atras</button>
            <button onClick={goNext} className="btn-navy flex-1">Siguiente</button>
          </div>
        </StepCard>
      )}

      {/* ==================== PASO 4 ==================== */}
      {step === 4 && (
        <StepCard num={4} title="Genera tu token permanente" icon={<IconKey />}>
          <InfoBanner color="amber">
            No uses el token temporal que aparece por defecto — ese expira en 24 horas.
            Sigue estos pasos para generar un token permanente:
          </InfoBanner>

          <div className="space-y-3 mt-4">
            <Instruction num={1}>
              En Meta Business Manager ve a <strong>Configuracion → Usuarios del sistema</strong>
            </Instruction>
            <Instruction num={2}>
              Haz clic en <strong>&quot;Agregar&quot;</strong> y crea un usuario:
              <br />
              <span className="text-slate-500">Nombre: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">Omuwan Bot</code> — Rol: <strong>Empleado</strong></span>
            </Instruction>
            <Instruction num={3}>
              Haz clic en <strong>&quot;Generar token de acceso&quot;</strong>
            </Instruction>
            <Instruction num={4}>
              Selecciona tu app
            </Instruction>
            <Instruction num={5}>
              Activa estos permisos:
              <div className="mt-2 space-y-1 ml-1">
                <PermissionCheck>whatsapp_business_messaging</PermissionCheck>
                <PermissionCheck>whatsapp_business_management</PermissionCheck>
              </div>
            </Instruction>
            <Instruction num={6}>
              Haz clic en <strong>&quot;Generar token&quot;</strong>
            </Instruction>
            <Instruction num={7}>
              <strong>IMPORTANTE:</strong> Copia y guarda el token ahora — no se muestra de nuevo
            </Instruction>
          </div>

          {/* App Secret */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-5">
            <p className="text-sm font-semibold text-slate-700 mb-1">Tambien necesitaras tu App Secret</p>
            <p className="text-sm text-slate-500">
              Encuentralo en: Tu app → <strong>Configuracion → Basica → App Secret</strong>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button onClick={goBack} className="btn-secondary flex-1">← Atras</button>
            <button onClick={goNext} className="btn-navy flex-1">Tengo mi token — Siguiente</button>
          </div>
        </StepCard>
      )}

      {/* ==================== PASO 5 ==================== */}
      {step === 5 && (
        <StepCard num={5} title="Conecta con Omuwan" icon={<IconPlug />}>
          <p className="text-sm text-slate-600 leading-relaxed">
            Ingresa las credenciales que obtuviste en los pasos anteriores.
            Los datos se almacenan de forma segura y encriptada.
          </p>

          <form onSubmit={handleSaveCredentials} className="space-y-5 mt-5">
            {/* Phone Number ID */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5" htmlFor="phone_number_id">
                Phone Number ID
              </label>
              <input
                id="phone_number_id"
                name="phone_number_id"
                type="text"
                required
                defaultValue={credentials.phoneNumberId ?? ''}
                className="input-field font-mono"
                placeholder="123456789012345"
              />
              <p className="text-xs text-slate-400 mt-1">
                Lo copiaste en el paso 3
              </p>
            </div>

            {/* Access Token */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5" htmlFor="access_token">
                Access Token
              </label>
              <div className="relative">
                <input
                  id="access_token"
                  name="access_token"
                  type={showAccessToken ? 'text' : 'password'}
                  required
                  placeholder={credentials.accessTokenLast4 ? `Token actual: ${credentials.accessTokenLast4}` : 'Token permanente de System User'}
                  className="input-field font-mono pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowAccessToken(!showAccessToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white px-2 py-1 rounded"
                >
                  {showAccessToken ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Token permanente del System User, no el temporal
              </p>
            </div>

            {/* App Secret */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5" htmlFor="app_secret">
                App Secret
              </label>
              <div className="relative">
                <input
                  id="app_secret"
                  name="app_secret"
                  type={showAppSecret ? 'text' : 'password'}
                  required
                  placeholder={credentials.appSecretLast4 ? `Secret actual: ${credentials.appSecretLast4}` : 'App Secret de tu app de Meta'}
                  className="input-field font-mono pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowAppSecret(!showAppSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white px-2 py-1 rounded"
                >
                  {showAppSecret ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            {/* Verify Token (auto-generated, read-only) */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                Verify Token
              </label>
              <div className="flex gap-2">
                <input
                  name="verify_token"
                  type="text"
                  readOnly
                  value={credentials.verifyToken ?? ''}
                  className="input-field font-mono bg-slate-50 flex-1 text-sm"
                />
                <CopyButton
                  text={credentials.verifyToken ?? ''}
                  label="verify"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Auto-generado. Copialo — lo usaras al configurar el Webhook en Meta.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
                <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Success inline (si vuelve a este paso ya conectado) */}
            {verifyResult?.success && credentials.connected && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-sm font-medium text-emerald-800">Conexion exitosa</p>
                {verifyResult.displayName && (
                  <p className="text-xs text-emerald-700 mt-0.5">Nombre: {verifyResult.displayName}</p>
                )}
                {verifyResult.phoneNumber && (
                  <p className="text-xs text-emerald-700">Telefono: {verifyResult.phoneNumber}</p>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button type="button" onClick={goBack} className="btn-secondary flex-1">
                ← Atras
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-navy flex-1 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Verificando conexion...
                  </>
                ) : (
                  'Guardar y verificar conexion'
                )}
              </button>
            </div>
          </form>
        </StepCard>
      )}

      {/* ==================== PASO 6 (BONUS): WEBHOOK ==================== */}
      {step === 6 && (
        <StepCard num={6} title="Configura el Webhook en Meta" icon={<IconWebhook />} bonus>
          {/* Conexion verificada */}
          {credentials.connected && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800">Conexion verificada con Meta</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  {credentials.displayName}
                  {credentials.phoneDisplay && ` — ${credentials.phoneDisplay}`}
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-slate-600 leading-relaxed mt-4">
            Último paso: configura el webhook para que los mensajes de tus pacientes lleguen a Omuwan.
          </p>

          {/* Mandatory warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 flex items-start gap-2.5">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-700">
              <strong>Este paso es obligatorio.</strong> Sin él, el agente no puede recibir mensajes de pacientes.
            </p>
          </div>

          <div className="space-y-3 mt-4">
            <Instruction num={1}>
              En Meta Developers, ve a tu app → <strong>WhatsApp → Configuración</strong>
            </Instruction>
            <Instruction num={2}>
              En la sección <strong>&quot;Webhooks&quot;</strong>, haz clic en <strong>&quot;Editar&quot;</strong>
            </Instruction>
            <Instruction num={3}>
              <span>Copia esta URL y pégala en &quot;URL de devolución de llamada&quot;:</span>
              <CopyableField
                value={WEBHOOK_URL}
                label="webhook"
                copied={copied}
                onCopy={copyToClipboard}
              />
            </Instruction>
            <Instruction num={4}>
              <span>Copia este token y pégalo en &quot;Token de verificación&quot;:</span>
              <CopyableField
                value={credentials.verifyToken ?? ''}
                label="verify2"
                copied={copied}
                onCopy={copyToClipboard}
              />
            </Instruction>
            <Instruction num={5}>
              Haz clic en <strong>&quot;Verificar y guardar&quot;</strong>
            </Instruction>
            <Instruction num={6}>
              En la sección &quot;Webhook fields&quot;, haz clic en <strong>&quot;Administrar&quot;</strong> y activa el campo <strong>&quot;messages&quot;</strong>
            </Instruction>
            <Instruction num={7}>
              Envíate un mensaje de prueba desde tu WhatsApp personal al número del consultorio para verificar que funciona
            </Instruction>
          </div>

          {/* Status indicator */}
          <div className={`rounded-xl p-5 border mt-5 transition-all ${
            webhookStatus === 'connected'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-slate-50 border-slate-200'
          }`}>
            {webhookStatus === 'connected' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-800">
                      ¡Tu agente está activo y listo para recibir pacientes!
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Los mensajes de pacientes serán respondidos automáticamente por el agente IA.
                    </p>
                  </div>
                </div>
                {/* Warning: need doctor + consultation type */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-amber-800">
                    <strong>Antes de compartir el número con pacientes:</strong> asegúrate de tener al menos 1 médico activo con horario y 1 tipo de consulta configurado en{' '}
                    <a href="/dashboard/whatsapp#doctores" className="underline font-medium">Configuración del agente →</a>
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6 text-slate-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Esperando primer mensaje de prueba...
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Envía un mensaje desde tu WhatsApp personal al número del consultorio.
                    Esta página se actualiza automáticamente cada 15 segundos.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button onClick={() => setStep(5)} className="btn-secondary flex-1">
              ← Editar credenciales
            </button>
            {webhookStatus === 'connected' && (
              <a
                href="/dashboard/whatsapp"
                className="btn-navy flex-1 text-center"
              >
                Ir a configurar mi agente →
              </a>
            )}
          </div>
        </StepCard>
      )}
    </div>
  )
}

// ============================================================
// Componentes auxiliares
// ============================================================

function StepCard({
  num, title, icon, bonus, children,
}: {
  num: number; title: string; icon: React.ReactNode; bonus?: boolean; children: React.ReactNode
}) {
  return (
    <div className="card p-6 sm:p-8">
      {/* Step header */}
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
          bonus ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-[#0f2a6e]'
        }`}>
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-0.5">
            {bonus ? 'Ultimo paso' : `Paso ${num} de ${TOTAL_STEPS}`}
          </p>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        </div>
      </div>
      {children}
    </div>
  )
}

function Instruction({ num, children }: { num: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold mt-0.5">
        {num}
      </span>
      <div className="text-sm text-slate-700 leading-relaxed pt-0.5">{children}</div>
    </div>
  )
}

function InfoBanner({ color, children }: { color: 'amber' | 'blue' | 'red'; children: React.ReactNode }) {
  const styles = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    red: 'bg-red-50 border-red-200 text-red-800',
  }
  const icons = {
    amber: (
      <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    blue: (
      <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
    red: (
      <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  }
  return (
    <div className={`flex gap-3 border rounded-xl p-4 mt-4 ${styles[color]}`}>
      {icons[color]}
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  )
}

function PermissionCheck({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
      <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">{children}</code>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline font-semibold">
      {children}
    </a>
  )
}

function ExternalIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  )
}

function SkipButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="text-center mt-2">
      <button onClick={onClick} className="text-xs text-slate-400 hover:text-slate-600 font-medium">
        Saltar este paso
      </button>
    </div>
  )
}

function CopyButton({
  text, label, copied, onCopy,
}: {
  text: string; label: string; copied: string | null; onCopy: (text: string, label: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, label)}
      className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
    >
      {copied === label ? (
        <span className="text-emerald-600">Copiado</span>
      ) : 'Copiar'}
    </button>
  )
}

function CopyableField({
  value, label, copied, onCopy,
}: {
  value: string; label: string; copied: string | null; onCopy: (text: string, label: string) => void
}) {
  return (
    <div className="flex gap-2 mt-2">
      <input
        type="text"
        readOnly
        value={value}
        className="input-field font-mono text-xs bg-slate-50 flex-1"
      />
      <CopyButton text={value} label={label} copied={copied} onCopy={onCopy} />
    </div>
  )
}
