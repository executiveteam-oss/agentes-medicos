/**
 * Tests del media-handler con MOCKS de Meta API.
 *
 * NO toca producción ni Meta real. Inyecta un `fetch` mock para simular
 * respuestas de Meta (metadata + bytes). Verifica los paths felices y
 * los errores conocidos (404, mime no soportado, tamaño excedido).
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-media-handler.ts
 */

import { downloadWhatsAppMedia } from '../src/lib/whatsapp/media-handler'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function makeMockFetcher(responses: Array<() => Response | Promise<Response>>): typeof fetch {
  let i = 0
  return (async () => {
    const fn = responses[i++]
    if (!fn) throw new Error('No more mock responses')
    return await fn()
  }) as unknown as typeof fetch
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bytesResp(bytes: Buffer | Uint8Array, status = 200): Response {
  // Pasar como Uint8Array para satisfacer BodyInit
  const u8 = bytes instanceof Buffer ? new Uint8Array(bytes) : bytes
  return new Response(u8 as unknown as BodyInit, { status, headers: { 'content-type': 'application/octet-stream' } })
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tests media-handler (mocks de Meta API)')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n=== Happy path: imagen JPG válida ===')
  {
    const imageBytes = Buffer.from('fake-jpg-bytes')
    const fetcher = makeMockFetcher([
      () => jsonResp({
        url: 'https://lookaside.fb/mock/url',
        mime_type: 'image/jpeg',
        file_size: imageBytes.length,
        sha256: 'abc',
      }),
      () => bytesResp(imageBytes),
    ])
    const r = await downloadWhatsAppMedia('media123', 'fake-token', fetcher)
    assert('ok=true', r.ok === true)
    if (r.ok) {
      assert('mimeType=image/jpeg', r.mimeType === 'image/jpeg')
      assert('sizeBytes correcto', r.sizeBytes === imageBytes.length)
      assert('bytes correctos', r.bytes.equals(imageBytes))
    }
  }

  console.log('\n=== Happy path: PDF válido ===')
  {
    const pdfBytes = Buffer.from('%PDF-fake-content')
    const fetcher = makeMockFetcher([
      () => jsonResp({ url: 'https://x.com/y', mime_type: 'application/pdf', file_size: pdfBytes.length }),
      () => bytesResp(pdfBytes),
    ])
    const r = await downloadWhatsAppMedia('media456', 'token', fetcher)
    assert('PDF ok=true', r.ok === true)
    if (r.ok) assert('PDF mime correcto', r.mimeType === 'application/pdf')
  }

  console.log('\n=== Happy path: HEIC (iPhone) válido ===')
  {
    const heicBytes = Buffer.from('fake-heic-bytes')
    const fetcher = makeMockFetcher([
      () => jsonResp({ url: 'https://x', mime_type: 'image/heic', file_size: heicBytes.length }),
      () => bytesResp(heicBytes),
    ])
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('HEIC ok=true', r.ok === true, JSON.stringify(r))
  }

  console.log('\n=== Error: Meta API 404 (media expirado) ===')
  {
    const fetcher = makeMockFetcher([
      () => new Response('Not Found', { status: 404 }),
    ])
    const r = await downloadWhatsAppMedia('expired', 'token', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) {
      assert('errorCode=media_expired', r.errorCode === 'media_expired', r.errorCode)
    }
  }

  console.log('\n=== Error: mime no soportado (audio/wav) ===')
  {
    const fetcher = makeMockFetcher([
      () => jsonResp({ url: 'https://x', mime_type: 'audio/wav', file_size: 1000 }),
    ])
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) assert('errorCode=mime_not_allowed', r.errorCode === 'mime_not_allowed')
  }

  console.log('\n=== Error: tamaño excede 25MB (metadata) ===')
  {
    const fetcher = makeMockFetcher([
      () => jsonResp({ url: 'https://x', mime_type: 'image/jpeg', file_size: 30 * 1024 * 1024 }),
    ])
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) assert('errorCode=size_exceeded', r.errorCode === 'size_exceeded')
  }

  console.log('\n=== Error: metadata sin url ===')
  {
    const fetcher = makeMockFetcher([
      () => jsonResp({ mime_type: 'image/jpeg' }),
    ])
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) assert('errorCode=fetch_metadata_failed', r.errorCode === 'fetch_metadata_failed')
  }

  console.log('\n=== Error: descarga de bytes falla (500 en segundo GET) ===')
  {
    const fetcher = makeMockFetcher([
      () => jsonResp({ url: 'https://x', mime_type: 'image/png', file_size: 100 }),
      () => new Response('Server Error', { status: 500 }),
    ])
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) assert('errorCode=fetch_bytes_failed', r.errorCode === 'fetch_bytes_failed')
  }

  console.log('\n=== Error: fetch throw (network) ===')
  {
    const fetcher = (() => { throw new Error('Network down') }) as unknown as typeof fetch
    const r = await downloadWhatsAppMedia('m', 't', fetcher)
    assert('ok=false', r.ok === false)
    if (!r.ok) assert('errorCode=fetch_metadata_failed', r.errorCode === 'fetch_metadata_failed')
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
