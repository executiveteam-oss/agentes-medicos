// ============================================================
// Cron: RETENCIÓN DE DOCUMENTOS CLÍNICOS (conversation_media + Storage)
//
// ⚠️⚠️ ESTE ES EL ÚNICO CRON QUE DESTRUYE DATOS. Antes de tocar nada, leé el
// POR QUÉ completo en src/lib/retention/document-retention.ts.
//
// No se puede validar por observación: con el Bloque 4 (recepción de archivos)
// apagado, el dry-run reporta 0 por AÑOS, y el primer borrado real ocurre 2 años
// después del primer documento. La red de seguridad son los tests + el guard de
// volumen, NO mirar producción. Por eso cada decisión está comentada con su POR QUÉ.
//
// Salvaguardas:
//  1. DRY-RUN por defecto — solo borra si env DOCUMENT_RETENTION_DELETE_ENABLED==='true'.
//  2. Guard de volumen: >100 elegibles → ABORTA + alerta (firma de un bug de fecha).
//  3. Storage ANTES de las filas (los objetos NO cascadean → anti-huérfanos).
//  4. Plazo POR-CLÍNICA (feature_config.document_retention_years, default 2).
//  5. Excepciones: cita futura activa (A) y autorización sin revisar (B) no se borran.
//  6. Un pending_review viejo (>30d) se ALERTA aunque no se borre (Exc B no es
//     "retener para siempre porque nadie miró").
//  7. audit_log NUNCA se borra (protección legal); sí se ESCRIBE el registro de corrida.
//  8. Loguea SIEMPRE, aunque sea 0, para auditar que corrió.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'
import { removeMediaFromStorage } from '@/lib/whatsapp/media-handler'
import { notifyStaffOfEscalation } from '@/lib/notifications/escalation-notify'
import {
  computeCutoff, resolveRetentionYears, isEligibleForDeletion, isStalePending,
  exceedsVolumeGuard, STALE_PENDING_ALERT_DAYS, VOLUME_GUARD_MAX, RETENTION_DEFAULT_YEARS,
} from '@/lib/retention/document-retention'

interface CmRow {
  id: string
  storage_path: string | null
  clinic_id: string
  conversation_id: string
  created_at: string
  context: string | null
  reviewed_at: string | null
}

async function writeRunAudit(details: Record<string, unknown>): Promise<void> {
  // Escribir el registro de corrida NO viola "audit_log no se toca" — esa regla
  // es sobre no BORRAR filas de audit_log. Registrar la destrucción es justo lo
  // que la protección legal quiere. clinic_id=null: la corrida es cross-clínica.
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: null, action: 'document_retention_run', actor_type: 'system', details,
    })
  } catch (err) {
    console.error('[Retention] no se pudo escribir el audit de corrida (no crítico):', err)
  }
}

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deleteEnabled = process.env.DOCUMENT_RETENTION_DELETE_ENABLED === 'true'
  const mode = deleteEnabled ? 'delete' : 'dry_run'
  const now = new Date()

  // 1. Traer TODAS las filas de conversation_media. Volúmenes chicos (0-cientos)
  //    → filtrar en JS con las funciones puras testeadas evita drift SQL↔lógica.
  //    (A escala de miles habría que paginar — años lejos; anotar si pasa.)
  const { data: rowsRaw, error: rowsErr } = await supabaseAdmin
    .from('conversation_media')
    .select('id, storage_path, clinic_id, conversation_id, created_at, context, reviewed_at')
  if (rowsErr) {
    console.error('[Retention] error leyendo conversation_media:', rowsErr.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  const rows = (rowsRaw ?? []) as CmRow[]

  // 2. Plazo por-clínica.
  const clinicIds = [...new Set(rows.map((r) => r.clinic_id))]
  const retentionByClinic = new Map<string, number>()
  if (clinicIds.length > 0) {
    const { data: clinics } = await supabaseAdmin
      .from('clinics').select('id, feature_config').in('id', clinicIds)
    for (const c of clinics ?? []) {
      retentionByClinic.set(c.id as string, resolveRetentionYears(c.feature_config as Record<string, unknown> | null))
    }
  }

  // 3. Excepción A: media con cita FUTURA activa. No se borra aunque cumpla plazo.
  const hasFutureAppt = new Set<string>()
  if (rows.length > 0) {
    const { data: futureAppts } = await supabaseAdmin
      .from('appointments')
      .select('authorization_media_id')
      .in('authorization_media_id', rows.map((r) => r.id))
      .gte('starts_at', now.toISOString())
      .in('status', ['confirmed', 'rescheduled'])
    for (const a of futureAppts ?? []) {
      if (a.authorization_media_id) hasFutureAppt.add(a.authorization_media_id as string)
    }
  }

  // 4. Filtrar con la lógica pura.
  const eligible = rows.filter((r) => {
    const years = retentionByClinic.get(r.clinic_id) ?? RETENTION_DEFAULT_YEARS
    const cutoff = computeCutoff(years, now)  // resolveRetentionYears garantiza >0 → no lanza
    return isEligibleForDeletion(
      { createdAt: r.created_at, context: r.context, reviewedAt: r.reviewed_at },
      cutoff, hasFutureAppt.has(r.id),
    )
  })
  const stale = rows.filter((r) =>
    isStalePending({ createdAt: r.created_at, context: r.context, reviewedAt: r.reviewed_at }, now, STALE_PENDING_ALERT_DAYS),
  )

  // 5. Alerta de pendientes estancados (SIEMPRE, aun en dry-run). Idempotente:
  //    notifyStaffOfEscalation no multiplica si ya hay una alerta viva.
  for (const r of stale) {
    await notifyStaffOfEscalation({
      clinicId: r.clinic_id, conversationId: r.conversation_id, patientName: null,
      reason: `Autorización sin revisar hace más de ${STALE_PENDING_ALERT_DAYS} días — revisar o resolver`,
    })
  }

  // 6. Log SIEMPRE (aunque sea 0) — para auditar que corrió.
  console.log(`[Retention] modo=${mode} elegibles=${eligible.length} pendientes_estancados=${stale.length}`)

  // 7. Guard de volumen — antes de cualquier borrado, incluso reportando en dry-run.
  if (exceedsVolumeGuard(eligible.length)) {
    console.error(`[Retention] ⚠️ GUARD DE VOLUMEN: ${eligible.length} elegibles > ${VOLUME_GUARD_MAX}. ABORTA sin borrar — probable bug en la condición de fecha (lección orphan-cleanup iSalud).`)
    await writeRunAudit({ mode, aborted: 'volume_guard', eligible: eligible.length, stale_pending: stale.length, deleted_rows: 0, deleted_objects: 0 })
    return NextResponse.json({ status: 'aborted_volume_guard', eligible: eligible.length })
  }

  // 8. DRY-RUN: loguear qué borraría, no borrar nada.
  if (!deleteEnabled) {
    const sample = eligible.slice(0, 20).map((r) => r.id)
    console.log(`[Retention] DRY-RUN — NO se borra. Borraría ${eligible.length} filas${eligible.length ? `: ${sample.join(', ')}${eligible.length > 20 ? ' …' : ''}` : ''}`)
    await writeRunAudit({ mode, eligible: eligible.length, stale_pending: stale.length, deleted_rows: 0, deleted_objects: 0 })
    return NextResponse.json({ status: 'dry_run', eligible: eligible.length, stalePending: stale.length })
  }

  // 9. BORRADO REAL. Storage PRIMERO (anti-huérfanos): solo borramos las filas
  //    si el borrado de Storage salió OK.
  const paths = eligible.map((r) => r.storage_path).filter((p): p is string => !!p)
  const storageResult = await removeMediaFromStorage(paths)
  if (!storageResult.ok) {
    console.error(`[Retention] Storage remove falló: ${storageResult.error} — NO se borran filas, reintenta próxima corrida.`)
    await writeRunAudit({ mode, error: `storage: ${storageResult.error}`, eligible: eligible.length, stale_pending: stale.length, deleted_rows: 0, deleted_objects: 0 })
    return NextResponse.json({ status: 'storage_failed', error: storageResult.error }, { status: 500 })
  }

  const { count: deletedRows, error: delErr } = await supabaseAdmin
    .from('conversation_media').delete({ count: 'exact' }).in('id', eligible.map((r) => r.id))
  if (delErr) {
    console.error(`[Retention] Storage borrado OK pero DELETE de filas falló: ${delErr.message}`)
    await writeRunAudit({ mode, error: `rows: ${delErr.message}`, eligible: eligible.length, deleted_rows: 0, deleted_objects: storageResult.removedCount })
    return NextResponse.json({ status: 'rows_delete_failed', error: delErr.message }, { status: 500 })
  }

  console.log(`[Retention] BORRADO: ${deletedRows ?? 0} filas, ${storageResult.removedCount} objetos de Storage.`)
  await writeRunAudit({ mode, eligible: eligible.length, stale_pending: stale.length, deleted_rows: deletedRows ?? 0, deleted_objects: storageResult.removedCount })
  return NextResponse.json({ status: 'deleted', rows: deletedRows ?? 0, objects: storageResult.removedCount })
}
