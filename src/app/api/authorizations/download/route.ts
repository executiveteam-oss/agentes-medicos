// ============================================================
// Descarga de autorizaciones como PDF (Bloque 4 — feature separado).
//
// GET /api/authorizations/download?ids=<mediaId>[,<mediaId>...]
//
// - Gate: permiso authorizations.review + flag clinics.feature_config
//   .document_download_enabled. Dashboard puro — NO toca agente ni webhook.
// - Acepta VARIOS ids desde el arranque (hoy la UI manda uno; la multi-selección
//   se agrega después sin reescribir la ruta): todos se ensamblan en un PDF.
// - Imágenes JPEG/PNG → PDF; PDF → tal cual; WEBP/HEIC único → original nombrado.
// - AUDIT media_downloaded: al descargar, una copia SALE del control de retención
//   de Omuwan (el cron de 2 años no borra lo que quedó en su computador). La
//   traza de acceso es exigible bajo Ley 1581 para datos sensibles.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { checkAuthorizationReviewPermission } from '@/lib/actions-helpers'
import { assembleAuthorizationPdf, type MediaFile } from '@/lib/authorizations/build-pdf'
import { buildAuthorizationFilename } from '@/lib/authorizations/download-filename'

export const dynamic = 'force-dynamic'

const MAX_IDS = 20

export async function GET(req: NextRequest): Promise<Response> {
  // Gate 1: permiso (mismo que revisar autorizaciones).
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch { return NextResponse.json({ error: 'Sin permiso para descargar' }, { status: 403 }) }

  const session = await getUserSession()
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Gate 2: flag por clínica.
  const { data: clinic } = await supabaseAdmin
    .from('clinics').select('feature_config').eq('id', clinicId).single()
  const enabled = (clinic as { feature_config?: Record<string, unknown> } | null)
    ?.feature_config?.document_download_enabled === true
  if (!enabled) return NextResponse.json({ error: 'Descarga no habilitada para esta clínica' }, { status: 403 })

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS)
  if (ids.length === 0) return NextResponse.json({ error: 'Falta el parámetro ids' }, { status: 400 })

  // Filas — SOLO de esta clínica (RLS-safe vía filtro explícito). Orden estable.
  const { data: rows } = await supabaseAdmin
    .from('conversation_media')
    .select('id, conversation_id, mime_type, storage_path, created_at')
    .in('id', ids)
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true })

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Archivo(s) no encontrado(s)' }, { status: 404 })
  }
  const mediaRows = rows as Array<{ id: string; conversation_id: string; mime_type: string; storage_path: string; created_at: string }>

  // Datos del paciente para el nombre (del primer archivo).
  const { data: convData } = await supabaseAdmin
    .from('conversations')
    .select('patients:patient_id ( name, document_type, document_number )')
    .eq('id', mediaRows[0].conversation_id)
    .single()
  const rawPatients = (convData as { patients?: unknown } | null)?.patients
  const patient = (Array.isArray(rawPatients) ? rawPatients[0] : rawPatients) as
    { name: string | null; document_type: string | null; document_number: string | null } | null

  // Bytes desde Storage.
  const files: MediaFile[] = []
  const paths: string[] = []
  for (const row of mediaRows) {
    const { data: blob, error } = await supabaseAdmin.storage.from('whatsapp-media').download(row.storage_path)
    if (error || !blob) continue
    files.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: row.mime_type })
    paths.push(row.storage_path)
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'No se pudo leer el/los archivo(s) de Storage' }, { status: 500 })
  }

  const assembled = await assembleAuthorizationPdf(files)
  const ext = assembled.kind === 'pdf' ? 'pdf' : assembled.ext
  const contentType = assembled.kind === 'pdf' ? 'application/pdf' : assembled.mimeType
  const filename = buildAuthorizationFilename({
    documentType: patient?.document_type ?? null,
    documentNumber: patient?.document_number ?? null,
    patientName: patient?.name ?? null,
    receivedAtIso: mediaRows[0].created_at,
    ext,
  })

  // AUDIT — la copia sale del control de retención de Omuwan (Ley 1581).
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'media_downloaded',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: mediaRows[0].id,
    details: {
      media_ids: mediaRows.map((r) => r.id),
      storage_paths: paths,
      filename,
      kind: assembled.kind,
      merged_count: files.length,
      patient_document: patient?.document_number ?? null,
    },
  })

  return new Response(assembled.bytes as BodyInit, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
