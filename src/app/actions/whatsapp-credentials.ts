'use server'

// ============================================================
// Server Actions — Credenciales WhatsApp por clínica
// Gestiona phone_number_id, access_token, app_secret, verify_token
// NUNCA expone tokens completos — solo últimos 4 caracteres
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { randomBytes } from 'crypto'
import { sendWhatsAppOnboardingSequence } from '@/lib/whatsapp/onboarding-messages'

// --- Tipos ---

export interface WhatsAppCredentials {
  phoneNumberId: string | null
  accessTokenLast4: string | null
  appSecretLast4: string | null
  verifyToken: string | null
  connected: boolean
  displayName: string | null
  phoneDisplay: string | null
  connectedAt: string | null
}

export interface VerifyResult {
  success: boolean
  error?: string
  displayName?: string
  phoneNumber?: string
}

/**
 * Obtener credenciales (enmascaradas) de la clínica
 */
export async function getWhatsAppCredentials(): Promise<WhatsAppCredentials> {
  const clinicId = await checkReadPermission('settings')

  const { data } = await supabaseAdmin
    .from('clinics')
    .select(
      'whatsapp_phone_id, whatsapp_access_token, whatsapp_app_secret, whatsapp_verify_token, whatsapp_connected, whatsapp_display_name, whatsapp_phone_display, whatsapp_connected_at'
    )
    .eq('id', clinicId)
    .single()

  if (!data) {
    return {
      phoneNumberId: null,
      accessTokenLast4: null,
      appSecretLast4: null,
      verifyToken: null,
      connected: false,
      displayName: null,
      phoneDisplay: null,
      connectedAt: null,
    }
  }

  return {
    phoneNumberId: data.whatsapp_phone_id ?? null,
    accessTokenLast4: maskToken(data.whatsapp_access_token),
    appSecretLast4: maskToken(data.whatsapp_app_secret),
    verifyToken: data.whatsapp_verify_token ?? generateVerifyToken(),
    connected: data.whatsapp_connected ?? false,
    displayName: data.whatsapp_display_name ?? null,
    phoneDisplay: data.whatsapp_phone_display ?? null,
    connectedAt: data.whatsapp_connected_at ?? null,
  }
}

/**
 * Guardar credenciales y verificar conexión con Meta API
 */
export async function saveWhatsAppCredentials(formData: FormData): Promise<VerifyResult> {
  const clinicId = await checkWritePermission('settings')

  const phoneNumberId = formData.get('phone_number_id')?.toString().trim()
  const accessToken = formData.get('access_token')?.toString().trim()
  const appSecret = formData.get('app_secret')?.toString().trim()
  let verifyToken = formData.get('verify_token')?.toString().trim()

  if (!phoneNumberId || !accessToken || !appSecret) {
    return { success: false, error: 'Todos los campos son obligatorios' }
  }

  // Generar verify token si no existe
  if (!verifyToken) {
    verifyToken = generateVerifyToken()
  }

  // Verificar conexión con Meta API
  const verification = await testMetaConnection(phoneNumberId, accessToken)

  // Guardar en DB (siempre guardar, aunque falle la verificación)
  const updateData: Record<string, unknown> = {
    whatsapp_phone_id: phoneNumberId,
    whatsapp_access_token: accessToken,
    whatsapp_app_secret: appSecret,
    whatsapp_verify_token: verifyToken,
    whatsapp_connected: verification.success,
    whatsapp_display_name: verification.displayName ?? null,
    whatsapp_phone_display: verification.phoneNumber ?? null,
    whatsapp_connected_at: verification.success ? new Date().toISOString() : null,
  }

  const { error: dbError } = await supabaseAdmin
    .from('clinics')
    .update(updateData)
    .eq('id', clinicId)

  if (dbError) {
    console.error('[saveWhatsAppCredentials] DB error:', dbError)
    return { success: false, error: 'Error guardando credenciales' }
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'whatsapp_credentials_updated',
      actor_type: 'staff',
      details: {
        phone_number_id: phoneNumberId,
        verified: verification.success,
        display_name: verification.displayName ?? null,
      },
    })
  } catch { /* no crítico */ }

  if (!verification.success) {
    return { success: false, error: verification.error }
  }

  // Enviar secuencia de onboarding por WhatsApp al admin (solo la primera vez)
  sendWhatsAppOnboardingSequence(clinicId, {
    phoneNumberId,
    accessToken,
  }).catch(() => { /* no bloquea la respuesta */ })

  return {
    success: true,
    displayName: verification.displayName,
    phoneNumber: verification.phoneNumber,
  }
}

/**
 * Verificar si ya llegó un mensaje de prueba para esta clínica
 */
export async function checkFirstMessage(): Promise<{ received: boolean }> {
  const clinicId = await checkReadPermission('settings')

  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('clinic_id', clinicId)
    .limit(1)
    .single()

  return { received: !!data }
}

// --- Helpers privados ---

function maskToken(token: string | null | undefined): string | null {
  if (!token || token.length < 4) return null
  return '...' + token.slice(-4)
}

function generateVerifyToken(): string {
  return 'omuwan_' + randomBytes(16).toString('hex')
}

/**
 * Llama a la Meta Graph API para verificar las credenciales
 */
async function testMetaConnection(
  phoneNumberId: string,
  accessToken: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?access_token=${accessToken}`,
      { method: 'GET' }
    )

    const body = await res.json()

    if (!res.ok) {
      const code = body?.error?.code
      const msg = body?.error?.message ?? 'Error desconocido'

      if (code === 190) {
        return { success: false, error: 'Token expirado o inválido. Genera uno nuevo en Meta Business.' }
      }
      if (code === 100) {
        return { success: false, error: 'Phone Number ID no válido. Verifica el número en Meta → WhatsApp → Configuration.' }
      }
      return { success: false, error: `Error de Meta (${code}): ${msg}` }
    }

    return {
      success: true,
      displayName: body.verified_name ?? body.display_phone_number ?? 'WhatsApp Business',
      phoneNumber: body.display_phone_number ?? null,
    }
  } catch (err) {
    console.error('[testMetaConnection] Error de red:', err)
    return { success: false, error: 'No se pudo conectar con Meta. Verifica tu conexión.' }
  }
}
