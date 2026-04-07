'use server'

// ============================================================
// Server Actions — Integraciones externas
//
// HIS request/contact info → whatsapp_config.integrations.his
// HIS credentials/status   → clinics.integrations.his (JSONB)
// Sheets info             → whatsapp_config.integrations.sheets
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/client'
import { getConnector } from '@/lib/integrations'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { HisCredentials, HisIntegrationConfig } from '@/types/database'

// --- Tipos para la UI ---

export interface HisIntegrationUi {
  software: string
  custom_software_name: string
  contact_info: string
  notes: string
  request_status: 'none' | 'requested' | 'in_progress' | 'connected'
  requested_at: string | null
  // De la columna integrations (técnico)
  connector_status: 'pending' | 'active' | 'error' | null
  credentials: HisCredentials
  last_sync: string | null
  error_message: string | null
}

export interface SheetsIntegration {
  email: string
  connected: boolean
  sheet_id: string | null
}

export interface IntegrationsConfig {
  his: HisIntegrationUi
  sheets: SheetsIntegration
}

// --- Campos de credenciales dinámicos por software ---

export interface CredentialField {
  key: string
  label: string
  placeholder: string
  type: 'text' | 'password' | 'url'
}

async function getCredentialFields(software: string): Promise<CredentialField[]> {
  const s = software.toLowerCase()
  if (s === 'isalud') {
    return [
      { key: 'api_url', label: 'URL de la API', placeholder: 'https://api.isalud.com/v1', type: 'url' },
      { key: 'api_key', label: 'API Key', placeholder: 'sk-...', type: 'password' },
      { key: 'clinic_code', label: 'Código de clínica', placeholder: 'CLI-001', type: 'text' },
    ]
  }
  if (s.includes('asdrual')) {
    return [
      { key: 'api_url', label: 'URL del servidor', placeholder: 'https://servidor.asdrual.com', type: 'url' },
      { key: 'username', label: 'Usuario', placeholder: 'admin', type: 'text' },
      { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
    ]
  }
  if (s === 'medilink') {
    return [
      { key: 'subdomain', label: 'Subdominio', placeholder: 'miclinica.medilink.com', type: 'text' },
      { key: 'token', label: 'Token de acceso', placeholder: 'tok_...', type: 'password' },
    ]
  }
  if (s === 'axismed') {
    return [
      { key: 'api_url', label: 'URL de la API', placeholder: 'https://api.axismed.co', type: 'url' },
      { key: 'api_key', label: 'API Key', placeholder: 'ak_...', type: 'password' },
    ]
  }
  if (s === 'huli') {
    return [
      { key: 'api_url', label: 'URL de la API', placeholder: 'https://api.huli.io', type: 'url' },
      { key: 'api_key', label: 'API Key', placeholder: 'hk_...', type: 'password' },
    ]
  }
  // Genérico / Otro
  return [
    { key: 'api_url', label: 'URL de la API', placeholder: 'https://...', type: 'url' },
    { key: 'api_key', label: 'API Key / Token', placeholder: '...', type: 'password' },
  ]
}

// Re-export para que el cliente pueda obtenerlos
export async function getCredentialFieldsForSoftware(software: string): Promise<CredentialField[]> {
  return getCredentialFields(software)
}

// --- Defaults ---

async function getDefaults(): Promise<IntegrationsConfig> {
  return {
    his: {
      software: '',
      custom_software_name: '',
      contact_info: '',
      notes: '',
      request_status: 'none',
      requested_at: null,
      connector_status: null,
      credentials: {},
      last_sync: null,
      error_message: null,
    },
    sheets: {
      email: '',
      connected: false,
      sheet_id: null,
    },
  }
}

// --- Leer config ---

export async function getIntegrationsConfig(): Promise<IntegrationsConfig> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config, integrations, google_sheet_id, doctor_email')
      .eq('id', clinicId)
      .single()

    const defaults = await getDefaults()
    if (!data) return defaults

    // HIS request info (de whatsapp_config.integrations.his)
    const waConfig = data.whatsapp_config as Record<string, unknown> | null
    const waIntegrations = (waConfig?.integrations ?? {}) as Record<string, unknown>
    const hisRequest = (waIntegrations.his ?? {}) as Record<string, unknown>

    // HIS technical config (de clinics.integrations.his)
    const dbIntegrations = (data.integrations ?? {}) as Record<string, unknown>
    const hisDb = (dbIntegrations.his ?? {}) as Partial<HisIntegrationConfig>

    // Sheets info (de whatsapp_config.integrations.sheets)
    const sheetsWa = (waIntegrations.sheets ?? {}) as Record<string, unknown>

    // Ocultar credenciales sensibles — solo mostrar que existen
    const safeCredentials: HisCredentials = {}
    if (hisDb.credentials) {
      for (const [key, value] of Object.entries(hisDb.credentials)) {
        safeCredentials[key] = value ? '••••••••' : ''
      }
    }

    return {
      his: {
        software: (hisRequest.software as string) ?? defaults.his.software,
        custom_software_name: (hisRequest.custom_software_name as string) ?? '',
        contact_info: (hisRequest.contact_info as string) ?? '',
        notes: (hisRequest.notes as string) ?? '',
        request_status: (hisRequest.status as HisIntegrationUi['request_status']) ?? 'none',
        requested_at: (hisRequest.requested_at as string) ?? null,
        connector_status: hisDb.status ?? null,
        credentials: safeCredentials,
        last_sync: hisDb.last_sync ?? null,
        error_message: hisDb.error_message ?? null,
      },
      sheets: {
        email: (sheetsWa.email as string) || (data.doctor_email as string) || '',
        connected: !!data.google_sheet_id,
        sheet_id: (data.google_sheet_id as string) ?? null,
      },
    }
  } catch {
    return await getDefaults()
  }
}

// --- Solicitar integración (email al equipo) ---

export async function requestHisIntegration(input: {
  software: string
  custom_software_name: string
  contact_info: string
  notes: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    if (!input.software) return { ok: false, error: 'Selecciona un software' }
    if (!input.contact_info.trim()) return { ok: false, error: 'El contacto del ingeniero es obligatorio' }

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('name, whatsapp_config')
      .eq('id', clinicId)
      .single()

    if (!clinic) return { ok: false, error: 'Clínica no encontrada' }

    const softwareName = input.software === 'Otro' ? input.custom_software_name.trim() : input.software

    // Guardar en whatsapp_config.integrations.his
    const currentConfig = (clinic.whatsapp_config ?? {}) as Record<string, unknown>
    const currentIntegrations = (currentConfig.integrations ?? {}) as Record<string, unknown>

    const { error: updateError } = await supabaseAdmin
      .from('clinics')
      .update({
        whatsapp_config: {
          ...currentConfig,
          integrations: {
            ...currentIntegrations,
            his: {
              software: input.software,
              custom_software_name: input.custom_software_name.trim(),
              contact_info: input.contact_info.trim(),
              notes: input.notes.trim(),
              status: 'requested',
              requested_at: new Date().toISOString(),
            },
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (updateError) return { ok: false, error: 'Error guardando configuración' }

    // Email al equipo
    await sendEmail({
      to: 'executive.team@loncocapital.com',
      subject: `Nueva solicitud de integración HIS — ${clinic.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px;">
          <h2 style="color: #1e293b;">Solicitud de integración HIS</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Clínica</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${clinic.name}</td></tr>
            <tr><td style="padding: 8px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Clinic ID</td><td style="padding: 8px; font-family: monospace; border-bottom: 1px solid #e2e8f0;">${clinicId}</td></tr>
            <tr><td style="padding: 8px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Software</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${softwareName}</td></tr>
            <tr><td style="padding: 8px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Contacto ingeniero</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${input.contact_info.trim()}</td></tr>
            ${input.notes.trim() ? `<tr><td style="padding: 8px; color: #64748b;">Notas</td><td style="padding: 8px;">${input.notes.trim()}</td></tr>` : ''}
          </table>
        </div>
      `,
    })

    // Auditoría
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'integration_requested',
      actor_type: 'staff',
      details: { type: 'his', software: softwareName, contact: input.contact_info.trim() },
    })

    revalidatePath('/dashboard/settings/integrations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

// --- Guardar credenciales HIS (columna integrations) ---

export async function saveHisCredentials(
  credentials: HisCredentials
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('integrations, whatsapp_config')
      .eq('id', clinicId)
      .single()

    if (!clinic) return { ok: false, error: 'Clínica no encontrada' }

    // Obtener software name de whatsapp_config
    const waConfig = (clinic.whatsapp_config ?? {}) as Record<string, unknown>
    const waIntegrations = (waConfig.integrations ?? {}) as Record<string, unknown>
    const hisRequest = (waIntegrations.his ?? {}) as Record<string, unknown>
    const software = (hisRequest.software as string) ?? ''

    if (!software) return { ok: false, error: 'Primero selecciona un software de HC' }

    // Filtrar valores vacíos
    const cleanCredentials: HisCredentials = {}
    for (const [key, value] of Object.entries(credentials)) {
      if (value && value !== '••••••••') {
        cleanCredentials[key] = value
      }
    }

    // Merge con credenciales existentes (para no borrar las que no se cambiaron)
    const dbIntegrations = (clinic.integrations ?? {}) as Record<string, unknown>
    const existingHis = (dbIntegrations.his ?? {}) as Record<string, unknown>
    const existingCreds = (existingHis.credentials ?? {}) as HisCredentials

    const mergedCredentials: HisCredentials = { ...existingCreds }
    for (const [key, value] of Object.entries(cleanCredentials)) {
      if (value) mergedCredentials[key] = value
    }

    const hisConfig: HisIntegrationConfig = {
      software: software.toLowerCase(),
      status: 'pending',
      credentials: mergedCredentials,
      last_sync: (existingHis.last_sync as string) ?? null,
      error_message: null,
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        integrations: { ...dbIntegrations, his: hisConfig },
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando credenciales' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'integration_credentials_saved',
      actor_type: 'staff',
      details: { type: 'his', software },
    })

    revalidatePath('/dashboard/settings/integrations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

// --- Probar conexión HIS ---

export async function testHisConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('integrations')
      .eq('id', clinicId)
      .single()

    if (!clinic) return { ok: false, error: 'Clínica no encontrada' }

    const dbIntegrations = (clinic.integrations ?? {}) as Record<string, unknown>
    const hisConfig = dbIntegrations.his as HisIntegrationConfig | undefined

    if (!hisConfig?.credentials) {
      return { ok: false, error: 'Primero guarda las credenciales' }
    }

    const connector = getConnector({ ...hisConfig, status: 'active' }) // Force active to get connector
    if (!connector) {
      return { ok: false, error: 'Conector no disponible para este software' }
    }

    const success = await connector.testConnection(hisConfig.credentials)

    // Actualizar status según resultado
    const newStatus = success ? 'active' : 'error'
    await supabaseAdmin
      .from('clinics')
      .update({
        integrations: {
          ...dbIntegrations,
          his: {
            ...hisConfig,
            status: newStatus,
            error_message: success ? null : 'No se pudo conectar con el servidor',
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    // También actualizar request status en whatsapp_config
    if (success) {
      const { data: fullClinic } = await supabaseAdmin
        .from('clinics')
        .select('whatsapp_config')
        .eq('id', clinicId)
        .single()

      if (fullClinic) {
        const waConfig = (fullClinic.whatsapp_config ?? {}) as Record<string, unknown>
        const waIntegrations = (waConfig.integrations ?? {}) as Record<string, unknown>
        const hisReq = (waIntegrations.his ?? {}) as Record<string, unknown>

        await supabaseAdmin
          .from('clinics')
          .update({
            whatsapp_config: {
              ...waConfig,
              integrations: {
                ...waIntegrations,
                his: { ...hisReq, status: 'connected' },
              },
            },
          })
          .eq('id', clinicId)
      }
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'integration_test_connection',
      actor_type: 'staff',
      details: { type: 'his', success },
    })

    revalidatePath('/dashboard/settings/integrations')
    return success
      ? { ok: true }
      : { ok: false, error: 'No se pudo conectar. Verifica las credenciales.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error probando conexión'
    return { ok: false, error: msg }
  }
}

// --- Guardar email de Google Sheets ---

export async function saveSheetsEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    if (!clinic) return { ok: false, error: 'Clínica no encontrada' }

    const currentConfig = (clinic.whatsapp_config ?? {}) as Record<string, unknown>
    const currentIntegrations = (currentConfig.integrations ?? {}) as Record<string, unknown>
    const currentSheets = (currentIntegrations.sheets ?? {}) as Record<string, unknown>

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        doctor_email: email.trim() || null,
        whatsapp_config: {
          ...currentConfig,
          integrations: {
            ...currentIntegrations,
            sheets: { ...currentSheets, email: email.trim() },
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando email' }

    revalidatePath('/dashboard/settings/integrations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
