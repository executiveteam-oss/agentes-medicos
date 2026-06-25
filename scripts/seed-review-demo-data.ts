/**
 * Crea data de prueba para mostrar la vista de revisión de autorizaciones.
 *
 * Inserta:
 *  - 2 conversaciones escaladas con motivo de autorización
 *  - 2 registros en conversation_media con context='authorization' pendientes
 *  - Una imagen de prueba (PNG generado en memoria) en Storage
 *  - Un PDF de prueba (bytes mock) en Storage
 *
 * Permite al staff abrir /dashboard/conversations/autorizaciones y ver el
 * inbox real con archivos preview-eables.
 *
 * Run: TZ=America/Bogota npx tsx scripts/seed-review-demo-data.ts
 * Cleanup: TZ=America/Bogota npx tsx scripts/seed-review-demo-data.ts --cleanup
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  const c = readFileSync(p, 'utf-8')
  for (const line of c.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')

import { createClient } from '@supabase/supabase-js'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DEMO_PHONES = ['+573009000001', '+573009000002']

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cleanup = process.argv.includes('--cleanup')

  if (cleanup) {
    console.log('Cleanup: removiendo datos de prueba...')
    for (const phone of DEMO_PHONES) {
      const { data: convs } = await supa.from('conversations').select('id').eq('clinic_id', ALGIA_CLINIC_ID).eq('whatsapp_phone', phone)
      for (const c of convs ?? []) {
        // Borrar media + storage
        const { data: medias } = await supa.from('conversation_media').select('id, storage_path').eq('conversation_id', c.id)
        for (const m of medias ?? []) {
          await supa.storage.from('whatsapp-media').remove([(m as { storage_path: string }).storage_path])
        }
        await supa.from('conversation_media').delete().eq('conversation_id', c.id)
        await supa.from('messages').delete().eq('conversation_id', c.id)
        await supa.from('conversations').delete().eq('id', c.id)
      }
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', phone)
    }
    console.log('Cleanup OK.')
    return
  }

  console.log('Seed: creando 2 conversaciones con autorizaciones pendientes...')

  // === Paciente 1: ANDREA MARTÍNEZ con autorización en imagen ===
  const { data: patient1, error: p1Err } = await supa.from('patients').insert({
    clinic_id: ALGIA_CLINIC_ID,
    name: 'ANDREA MARTÍNEZ DEMO',
    phone: DEMO_PHONES[0],
    document_type: 'CC',
    document_number: '1112223334',
    eps: 'SOS',
  }).select('id').single()
  if (p1Err || !patient1) { console.error('FATAL patient1:', p1Err); process.exit(1) }

  const { data: conv1, error: conv1Err } = await supa.from('conversations').insert({
    clinic_id: ALGIA_CLINIC_ID,
    patient_id: (patient1 as { id: string }).id,
    whatsapp_phone: DEMO_PHONES[0],
    status: 'escalated',
    escalated_at: new Date().toISOString(),
    context: { escalation_reason: 'Autorización pendiente de revisión: Colposcopia con SOS' },
  }).select('id').single()
  if (conv1Err || !conv1) { console.error('FATAL conv1:', conv1Err); process.exit(1) }

  // Mensajes de la conversación
  await supa.from('messages').insert([
    { conversation_id: (conv1 as { id: string }).id, role: 'patient', content: 'Hola, quiero agendar una colposcopia con la Dra.' },
    { conversation_id: (conv1 as { id: string }).id, role: 'agent', content: 'Claro, con gusto te ayudo. Para agendar necesito tus datos: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.' },
    { conversation_id: (conv1 as { id: string }).id, role: 'patient', content: 'Andrea Martínez, CC 1112223334, fecha de nacimiento 12/05/1988, andrea@correo.com, vivo en Pereira, tengo SOS EPS.' },
    { conversation_id: (conv1 as { id: string }).id, role: 'agent', content: 'Para la colposcopia con SOS necesito que me envíes la autorización direccionada a Algia. Mandala por aquí como foto o PDF y un asesor la revisa antes de agendarte.' },
    { conversation_id: (conv1 as { id: string }).id, role: 'patient', content: '📎 Autorización recibida', message_type: 'image' },
    { conversation_id: (conv1 as { id: string }).id, role: 'agent', content: 'Recibido, gracias. Voy a coordinar con el equipo y un asesor te contacta pronto para confirmar tu cita.' },
  ])

  // PNG en memoria (1x1 verde — bytes literales)
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,  // IHDR
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,  // IDAT
    0x54, 0x08, 0x99, 0x63, 0x6c, 0xfd, 0x0f, 0x00,
    0x01, 0x05, 0x01, 0x02, 0xe6, 0x9e, 0x29, 0x91,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,  // IEND
    0xae, 0x42, 0x60, 0x82,
  ])
  const mediaId1 = `seed-image-${Date.now()}`
  const path1 = `${ALGIA_CLINIC_ID}/${(conv1 as { id: string }).id}/${Date.now()}_${mediaId1}.png`
  const u1 = await supa.storage.from('whatsapp-media').upload(path1, new Uint8Array(pngBytes), {
    contentType: 'image/png',
  })
  if (u1.error) { console.error('FATAL upload1:', u1.error); process.exit(1) }

  await supa.from('conversation_media').insert({
    clinic_id: ALGIA_CLINIC_ID,
    conversation_id: (conv1 as { id: string }).id,
    whatsapp_media_id: mediaId1,
    media_type: 'image',
    mime_type: 'image/png',
    filename: null,
    storage_path: path1,
    size_bytes: pngBytes.length,
    context: 'authorization',
  })

  console.log(`  Paciente 1: ANDREA MARTÍNEZ (SOS) — conversation ${(conv1 as { id: string }).id}`)

  // === Paciente 2: LUCÍA RODRÍGUEZ con autorización en PDF ===
  const { data: patient2 } = await supa.from('patients').insert({
    clinic_id: ALGIA_CLINIC_ID,
    name: 'LUCÍA RODRÍGUEZ DEMO',
    phone: DEMO_PHONES[1],
    document_type: 'CC',
    document_number: '2223334445',
    eps: 'MEDPLUS',
  }).select('id').single()
  if (!patient2) { console.error('FATAL patient2'); process.exit(1) }

  const { data: conv2, error: conv2Err } = await supa.from('conversations').insert({
    clinic_id: ALGIA_CLINIC_ID,
    patient_id: (patient2 as { id: string }).id,
    whatsapp_phone: DEMO_PHONES[1],
    status: 'escalated',
    escalated_at: new Date(Date.now() - 600000).toISOString(),
    context: { escalation_reason: 'Autorización pendiente de revisión: Mapeo con MEDPLUS' },
  }).select('id').single()
  if (conv2Err || !conv2) { console.error('FATAL conv2:', conv2Err); process.exit(1) }

  await supa.from('messages').insert([
    { conversation_id: (conv2 as { id: string }).id, role: 'patient', content: 'Buenas, necesito mapeo cardiológico' },
    { conversation_id: (conv2 as { id: string }).id, role: 'agent', content: 'Para el mapeo con MEDPLUS necesito que me envíes la autorización direccionada a Algia como foto o PDF.' },
    { conversation_id: (conv2 as { id: string }).id, role: 'patient', content: '📎 Autorización recibida', message_type: 'document' },
    { conversation_id: (conv2 as { id: string }).id, role: 'agent', content: 'Recibido, gracias. Voy a coordinar con el equipo y un asesor te contacta pronto.' },
  ])

  // PDF mínimo válido (1 página vacía)
  const pdfBytes = Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000050 00000 n\n0000000100 00000 n\n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n',
    'utf-8',
  )
  const mediaId2 = `seed-doc-${Date.now()}`
  const path2 = `${ALGIA_CLINIC_ID}/${(conv2 as { id: string }).id}/${Date.now()}_${mediaId2}.pdf`
  const u2 = await supa.storage.from('whatsapp-media').upload(path2, new Uint8Array(pdfBytes), {
    contentType: 'application/pdf',
  })
  if (u2.error) { console.error('FATAL upload2:', u2.error); process.exit(1) }

  await supa.from('conversation_media').insert({
    clinic_id: ALGIA_CLINIC_ID,
    conversation_id: (conv2 as { id: string }).id,
    whatsapp_media_id: mediaId2,
    media_type: 'document',
    mime_type: 'application/pdf',
    filename: 'autorizacion-medplus.pdf',
    storage_path: path2,
    size_bytes: pdfBytes.length,
    context: 'authorization',
  })

  console.log(`  Paciente 2: LUCÍA RODRÍGUEZ (MEDPLUS) — conversation ${(conv2 as { id: string }).id}`)
  console.log('\nSeed OK. Abre /dashboard/conversations/autorizaciones')
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
