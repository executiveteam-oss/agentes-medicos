// ============================================================
// Prueba E2E del PROCEDIMIENTO DE BORRADO ARCO (Bloque 4).
//
// Corre contra PROD (Algia). Crea datos de PRUEBA marcados, sube un archivo
// REAL a Storage, y ejecuta el runbook de borrado de punta a punta:
//   setup → verificar que existe → BORRAR (Storage + filas) → verificar que
//   desapareció y que la cita quedó con authorization_media_id = NULL → limpiar.
//
// Ejercita las FUNCIONES REALES del media-handler (uploadMediaToStorage,
// removeMediaFromStorage, recordConversationMedia) + la FK SET NULL real.
//
// Uso: TZ=America/Bogota npx tsx scripts/test-arco-deletion-e2e.ts
// ============================================================

import { existsSync, readFileSync } from 'fs'
import type { SupabaseClient } from '@supabase/supabase-js'

function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TEST_PHONE = '+573990000042'   // marcador de prueba, improbable de colisionar
const TEST_NAME = 'ZZZ_TEST_ARCO_BORRADO'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

// PDF mínimo válido (header + trailer) — el bucket solo acepta image/* y pdf.
const DUMMY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf-8',
)

async function main(): Promise<void> {
  const { supabaseAdmin } = await import('../src/lib/supabase/admin')
  const { uploadMediaToStorage, removeMediaFromStorage, recordConversationMedia } =
    await import('../src/lib/whatsapp/media-handler')

  console.log('Prueba E2E — borrado ARCO (Storage + filas + FK SET NULL)\n')

  // Limpieza defensiva de una corrida previa abortada (mismo phone de prueba).
  await cleanup(supabaseAdmin)

  // ---------- SETUP ----------
  console.log('SETUP:')
  const { data: patient, error: pErr } = await supabaseAdmin
    .from('patients')
    .insert({ clinic_id: ALGIA, name: TEST_NAME, phone: TEST_PHONE })
    .select('id').single()
  if (pErr || !patient) { console.error('No pude crear paciente de prueba:', pErr?.message); process.exit(1) }
  const patientId = (patient as { id: string }).id

  const { data: conv, error: cErr } = await supabaseAdmin
    .from('conversations')
    .insert({ clinic_id: ALGIA, patient_id: patientId, whatsapp_phone: TEST_PHONE, status: 'active' })
    .select('id').single()
  if (cErr || !conv) { console.error('No pude crear conversación:', cErr?.message); process.exit(1) }
  const conversationId = (conv as { id: string }).id

  // Subir archivo REAL con la función productiva.
  const fakeMediaId = `TEST_MEDIA_${patientId.slice(0, 8)}`
  const up = await uploadMediaToStorage({
    clinicId: ALGIA, conversationId, mediaId: fakeMediaId,
    bytes: DUMMY_PDF, mimeType: 'application/pdf',
  })
  if (!up.ok) { console.error('Upload falló:', up.error); await cleanup(supabaseAdmin); process.exit(1) }
  const storagePath = up.storagePath
  console.log(`  → subido a Storage: ${storagePath}`)

  const rec = await recordConversationMedia({
    clinicId: ALGIA, conversationId, messageId: null, whatsappMediaId: fakeMediaId,
    mediaType: 'document', mimeType: 'application/pdf', filename: 'autorizacion_test.pdf',
    storagePath, sizeBytes: DUMMY_PDF.length, context: 'authorization',
  })
  if (!rec.ok) { console.error('recordConversationMedia falló:', rec.error); await cleanup(supabaseAdmin); process.exit(1) }
  const mediaRowId = rec.mediaRowId

  // Cita futura de prueba que APUNTA al archivo (para probar la FK SET NULL).
  const { data: apt, error: aErr } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: ALGIA, patient_id: patientId,
      starts_at: '2099-01-01T15:00:00-05:00', ends_at: '2099-01-01T15:30:00-05:00',
      status: 'confirmed', source: 'manual', authorization_media_id: mediaRowId,
    })
    .select('id').single()
  if (aErr || !apt) { console.error('No pude crear cita:', aErr?.message); await cleanup(supabaseAdmin); process.exit(1) }
  const appointmentId = (apt as { id: string }).id

  // ---------- VERIFICAR SETUP ----------
  console.log('\nVERIFICAR QUE EXISTE (antes de borrar):')
  const dl1 = await supabaseAdmin.storage.from('whatsapp-media').download(storagePath)
  assert('archivo presente en Storage', !dl1.error && dl1.data != null)
  const { data: row1 } = await supabaseAdmin.from('conversation_media').select('id').eq('id', mediaRowId).maybeSingle()
  assert('fila conversation_media presente', row1 != null)
  const { data: apt1 } = await supabaseAdmin.from('appointments').select('authorization_media_id').eq('id', appointmentId).single()
  assert('cita apunta al archivo', (apt1 as { authorization_media_id: string | null }).authorization_media_id === mediaRowId)

  // ---------- BORRADO (runbook) ----------
  console.log('\nBORRADO (procedimiento del runbook):')
  // Paso 1: enumerar conversaciones del paciente
  const { data: convs } = await supabaseAdmin.from('conversations').select('id').eq('clinic_id', ALGIA).eq('patient_id', patientId)
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id)
  // Paso 2: enumerar filas de media + storage_path (el path NO tiene patient_id → se enumera por conversación)
  const { data: mediaRows } = await supabaseAdmin.from('conversation_media').select('id, storage_path').in('conversation_id', convIds)
  const paths = (mediaRows ?? []).map((m) => (m as { storage_path: string }).storage_path)
  const ids = (mediaRows ?? []).map((m) => (m as { id: string }).id)
  console.log(`  → ${paths.length} objeto(s) de Storage, ${ids.length} fila(s) a borrar`)
  // Paso 3: borrar Storage PRIMERO (no cascadea)
  const rm = await removeMediaFromStorage(paths)
  assert('removeMediaFromStorage ok', rm.ok, rm.ok ? undefined : (rm as { error: string }).error)
  // Paso 4: borrar filas (la cita se auto-nullea por la FK SET NULL)
  const { error: delErr } = await supabaseAdmin.from('conversation_media').delete().in('id', ids)
  assert('DELETE filas conversation_media ok', !delErr, delErr?.message)

  // ---------- VERIFICAR BORRADO ----------
  console.log('\nVERIFICAR QUE DESAPARECIÓ:')
  const dl2 = await supabaseAdmin.storage.from('whatsapp-media').download(storagePath)
  assert('archivo YA NO está en Storage', dl2.error != null || dl2.data == null)
  const { data: row2 } = await supabaseAdmin.from('conversation_media').select('id').eq('id', mediaRowId).maybeSingle()
  assert('fila conversation_media borrada', row2 == null)
  const { data: apt2 } = await supabaseAdmin.from('appointments').select('id, authorization_media_id').eq('id', appointmentId).single()
  assert('cita SIGUE existiendo', apt2 != null)
  assert('cita.authorization_media_id quedó en NULL (FK SET NULL)', (apt2 as { authorization_media_id: string | null }).authorization_media_id === null)

  // ---------- LIMPIEZA ----------
  console.log('\nLIMPIEZA de datos de prueba:')
  await cleanup(supabaseAdmin)
  const { data: leftover } = await supabaseAdmin.from('patients').select('id').eq('clinic_id', ALGIA).eq('phone', TEST_PHONE).maybeSingle()
  assert('sin datos de prueba residuales', leftover == null)

  console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
  process.exit(fail === 0 ? 0 : 1)
}

// Borra TODO lo del paciente de prueba (idempotente). Storage por si quedó huérfano.
async function cleanup(supa: SupabaseClient): Promise<void> {
  const { data: p } = await supa.from('patients').select('id').eq('clinic_id', ALGIA).eq('phone', TEST_PHONE).maybeSingle()
  if (!p) return
  const patientId = (p as { id: string }).id
  const { data: convs } = await supa.from('conversations').select('id').eq('patient_id', patientId)
  const convIds = (convs ?? []).map((c: { id: string }) => c.id)
  if (convIds.length) {
    const { data: media } = await supa.from('conversation_media').select('storage_path').in('conversation_id', convIds)
    const paths = (media ?? []).map((m: { storage_path: string }) => m.storage_path)
    if (paths.length) await supa.storage.from('whatsapp-media').remove(paths)
  }
  await supa.from('appointments').delete().eq('patient_id', patientId)
  // conversations (y conversation_media por CASCADE) + patient
  if (convIds.length) await supa.from('conversations').delete().in('id', convIds)
  await supa.from('patients').delete().eq('id', patientId)
}

main().catch((e) => { console.error(e); process.exit(1) })
