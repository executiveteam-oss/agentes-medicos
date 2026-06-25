// ============================================================
// WhatsApp Media Handler — Bloque 4
//
// Descarga archivos (imágenes/PDFs) que el paciente envía por WhatsApp,
// los sube a Supabase Storage en un bucket privado, y crea registros
// en conversation_media + messages.
//
// CRÍTICO: este módulo solo se ejecuta cuando la clínica tiene el
// feature_flag `media_reception_enabled=true`. El gate vive en el
// webhook, NO en este módulo. Acá asumimos que el caller ya verificó.
//
// API de Meta:
//   1. GET https://graph.facebook.com/v21.0/{media_id} con Bearer token
//      → returns { url, mime_type, sha256, file_size, ... }
//   2. GET {url} con Bearer token → bytes del archivo
//
// Almacenamiento:
//   - Bucket privado "whatsapp-media" (migración 00076)
//   - Path: {clinic_id}/{conversation_id}/{timestamp}_{media_id}.{ext}
//   - URLs firmadas con TTL corto cuando un staff las consulta
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

const META_GRAPH_API_VERSION = 'v21.0'
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const

export interface MediaDownloadResult {
  ok: true
  bytes: Buffer
  mimeType: string
  sizeBytes: number
  sha256?: string
}

export interface MediaDownloadError {
  ok: false
  error: string
  errorCode: 'fetch_metadata_failed' | 'fetch_bytes_failed' | 'size_exceeded' | 'mime_not_allowed' | 'media_expired' | 'unknown'
}

/**
 * Descarga un archivo de Meta dado su media_id.
 *
 * @param mediaId  ID del media en Meta (viene en el webhook payload)
 * @param accessToken  Token de WhatsApp Business de la clínica
 * @param fetcher  Inyectable para tests (default: global fetch)
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<MediaDownloadResult | MediaDownloadError> {
  // Step 1: obtener la URL temporal del media
  let metaResponse: Response
  try {
    metaResponse = await fetcher(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
  } catch (err) {
    return {
      ok: false,
      error: `Error consultando metadata del media: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: 'fetch_metadata_failed',
    }
  }

  if (!metaResponse.ok) {
    // Meta retiene media 30 días — después devuelve 404
    if (metaResponse.status === 404) {
      return { ok: false, error: 'El archivo ya no está disponible en WhatsApp (expira a los 30 días)', errorCode: 'media_expired' }
    }
    return {
      ok: false,
      error: `Meta API respondió ${metaResponse.status}: ${await safeReadText(metaResponse)}`,
      errorCode: 'fetch_metadata_failed',
    }
  }

  let metadata: { url?: string; mime_type?: string; file_size?: number; sha256?: string }
  try {
    metadata = await metaResponse.json() as typeof metadata
  } catch {
    return { ok: false, error: 'No pude parsear la respuesta de Meta', errorCode: 'fetch_metadata_failed' }
  }

  if (!metadata.url || !metadata.mime_type) {
    return { ok: false, error: 'Meta no devolvió url o mime_type', errorCode: 'fetch_metadata_failed' }
  }

  // Validaciones
  if (metadata.file_size && metadata.file_size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Archivo demasiado grande (${Math.round(metadata.file_size / 1024 / 1024)}MB, máximo 25MB)`,
      errorCode: 'size_exceeded',
    }
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(metadata.mime_type)) {
    return {
      ok: false,
      error: `Tipo de archivo no soportado: ${metadata.mime_type}. Solo aceptamos JPG, PNG, WEBP, HEIC, HEIF, PDF.`,
      errorCode: 'mime_not_allowed',
    }
  }

  // Step 2: descargar los bytes
  let bytesResponse: Response
  try {
    bytesResponse = await fetcher(metadata.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    return {
      ok: false,
      error: `Error descargando bytes: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: 'fetch_bytes_failed',
    }
  }

  if (!bytesResponse.ok) {
    return {
      ok: false,
      error: `Descarga de bytes falló ${bytesResponse.status}`,
      errorCode: 'fetch_bytes_failed',
    }
  }

  const arrayBuffer = await bytesResponse.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Validación post-descarga (tamaño real puede diferir del metadata)
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Archivo descargado excede 25MB (${Math.round(buffer.length / 1024 / 1024)}MB)`,
      errorCode: 'size_exceeded',
    }
  }

  return {
    ok: true,
    bytes: buffer,
    mimeType: metadata.mime_type,
    sizeBytes: buffer.length,
    sha256: metadata.sha256,
  }
}

async function safeReadText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 200) }
  catch { return '(no body)' }
}

/**
 * Sube los bytes descargados al bucket privado en Supabase Storage.
 * Path estructurado para fácil cleanup por clínica (derecho ARCO).
 */
export async function uploadMediaToStorage(params: {
  clinicId: string
  conversationId: string
  mediaId: string
  bytes: Buffer
  mimeType: string
}): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const { clinicId, conversationId, mediaId, bytes, mimeType } = params

  const ext = mimeTypeToExtension(mimeType)
  const timestamp = Date.now()
  const path = `${clinicId}/${conversationId}/${timestamp}_${mediaId}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from('whatsapp-media')
    .upload(path, bytes, {
      contentType: mimeType,
      upsert: false,
    })

  if (error) {
    return { ok: false, error: `Error subiendo a Storage: ${error.message}` }
  }
  return { ok: true, storagePath: path }
}

function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf',
  }
  return map[mimeType] ?? 'bin'
}

/**
 * Crea el registro en conversation_media tras subir el archivo.
 * Detecta el contexto (autorización vs documento genérico) en base
 * al estado de la conversación.
 */
export async function recordConversationMedia(params: {
  clinicId: string
  conversationId: string
  messageId: string | null
  whatsappMediaId: string
  mediaType: 'image' | 'document'
  mimeType: string
  filename: string | null
  storagePath: string
  sizeBytes: number
  context?: 'authorization' | 'document_general' | 'other' | null
}): Promise<{ ok: true; mediaRowId: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from('conversation_media')
    .insert({
      clinic_id: params.clinicId,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      whatsapp_media_id: params.whatsappMediaId,
      media_type: params.mediaType,
      mime_type: params.mimeType,
      filename: params.filename,
      storage_path: params.storagePath,
      size_bytes: params.sizeBytes,
      context: params.context ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, error: `Error insertando conversation_media: ${error?.message}` }
  }
  return { ok: true, mediaRowId: (data as { id: string }).id }
}

/**
 * Genera una URL firmada con TTL corto (default 10 min) para que un
 * staff autenticado pueda visualizar el archivo desde el dashboard.
 *
 * Registra el acceso en audit_log SIEMPRE (cada acceso, no resumido).
 * Esto es protección legal para documentos clínicos.
 */
export async function generateSignedMediaUrl(params: {
  mediaRowId: string
  clinicId: string
  accessedByUserId: string
  ttlSeconds?: number
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ttl = params.ttlSeconds ?? 600 // 10 min default

  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('storage_path, clinic_id, mime_type')
    .eq('id', params.mediaRowId)
    .eq('clinic_id', params.clinicId)
    .single()

  if (!media) {
    return { ok: false, error: 'Media no encontrado o no pertenece a esta clínica' }
  }

  const m = media as { storage_path: string; clinic_id: string; mime_type: string }
  const { data: signed, error } = await supabaseAdmin.storage
    .from('whatsapp-media')
    .createSignedUrl(m.storage_path, ttl)

  if (error || !signed) {
    return { ok: false, error: `Error generando URL firmada: ${error?.message}` }
  }

  // Audit log de CADA acceso (no resumido por día — protección legal)
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: params.clinicId,
    action: 'media_accessed',
    actor_type: 'staff',
    actor_id: params.accessedByUserId,
    target_type: 'conversation_media',
    target_id: params.mediaRowId,
    details: {
      storage_path: m.storage_path,
      mime_type: m.mime_type,
      ttl_seconds: ttl,
    },
  })

  return { ok: true, url: signed.signedUrl }
}
