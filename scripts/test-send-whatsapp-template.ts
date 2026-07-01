/**
 * Tests unitarios para sendWhatsAppTemplate en src/lib/whatsapp/client.ts
 * Run: npx tsx scripts/test-send-whatsapp-template.ts
 *
 * Mockea global.fetch para no golpear Meta real.
 */

import { sendWhatsAppTemplate } from '../src/lib/whatsapp/client'

let pass = 0
let fail = 0

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => {
    console.log(`  ✅ ${name}`)
    pass++
  }).catch((err) => {
    console.log(`  ❌ ${name}`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    fail++
  })
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

let lastCall: FetchCall | null = null

function mockFetch(response: { ok: boolean; body: unknown; status?: number }): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (url: string, init: RequestInit) => {
    lastCall = {
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    }
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: async () => response.body,
    }
  }
}

const CREDS = { phoneNumberId: 'PHONE_123', accessToken: 'TOKEN_ABC' }

async function main(): Promise<void> {
  console.log('sendWhatsAppTemplate')

  await test('Envío exitoso con body + button URL construye payload correcto', async () => {
    mockFetch({ ok: true, body: { messages: [{ id: 'wamid.HBg1' }] } })

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'encuesta_satisfaccion',
      'es_CO',
      ['Maria', 'ALGIA UNIDAD DE LAPAROSCOPIA'],
      'https://forms.gle/abc123',
      CREDS,
    )

    assert(r.ok === true, `expected ok=true, got ${JSON.stringify(r)}`)
    assert(r.messageId === 'wamid.HBg1', 'messageId')

    // Payload correcto
    assert(lastCall?.url.includes('/PHONE_123/messages') ?? false, 'URL usa phoneNumberId de la clínica')
    assert(lastCall?.headers.Authorization === 'Bearer TOKEN_ABC', 'header Auth con token')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = lastCall?.body as any
    assert(body.messaging_product === 'whatsapp', 'messaging_product')
    assert(body.to === '573101234567', 'to number')
    assert(body.type === 'template', 'type template')
    assert(body.template.name === 'encuesta_satisfaccion', 'template name')
    assert(body.template.language.code === 'es_CO', 'lang code')

    const components = body.template.components as unknown[]
    assert(components.length === 2, 'body + button = 2 components')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyComp = components[0] as any
    assert(bodyComp.type === 'body', 'primer component body')
    assert(bodyComp.parameters.length === 2, '2 body params')
    assert(bodyComp.parameters[0].text === 'Maria', 'body param 1')
    assert(bodyComp.parameters[1].text === 'ALGIA UNIDAD DE LAPAROSCOPIA', 'body param 2')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const btnComp = components[1] as any
    assert(btnComp.type === 'button', 'segundo component button')
    assert(btnComp.sub_type === 'url', 'sub_type url')
    assert(btnComp.index === '0', 'index 0')
    assert(btnComp.parameters[0].text === 'https://forms.gle/abc123', 'button URL')
  })

  await test('Envío sin button (buttonUrlParam=null) NO incluye component button', async () => {
    mockFetch({ ok: true, body: { messages: [{ id: 'wamid.HBg2' }] } })

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'mi_template',
      'es_CO',
      ['SoloBody'],
      null,
      CREDS,
    )

    assert(r.ok === true, 'ok')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = lastCall?.body as any
    const components = body.template.components as unknown[]
    assert(components.length === 1, 'solo 1 component (body)')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert((components[0] as any).type === 'body', 'es body')
  })

  await test('Envío sin body params (raro pero válido) construye componentes vacíos', async () => {
    mockFetch({ ok: true, body: { messages: [{ id: 'wamid.HBg3' }] } })

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'tpl_estatico',
      'es_CO',
      [],
      null,
      CREDS,
    )

    assert(r.ok === true, 'ok')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = lastCall?.body as any
    const components = body.template.components as unknown[]
    assert(components.length === 0, 'sin variables → sin components')
  })

  await test('Error 132001 (template no existe) devuelve ok:false + errorCode', async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: { error: { code: 132001, message: 'Template name does not exist' } },
    })

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'no_existe',
      'es_CO',
      ['x'],
      null,
      CREDS,
    )

    assert(r.ok === false, 'ok=false')
    assert(r.errorCode === 132001, `errorCode ${r.errorCode}`)
    assert(r.error?.includes('does not exist') ?? false, 'error mensaje')
  })

  await test('Error 132000 (template no aprobado) también captura errorCode', async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: { error: { code: 132000, message: 'Template not approved' } },
    })

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'pendiente_aprobacion',
      'es_CO',
      ['x'],
      null,
      CREDS,
    )

    assert(r.errorCode === 132000, 'errorCode 132000')
  })

  await test('Error de red devuelve ok:false con mensaje "Network error"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async () => {
      throw new Error('ECONNREFUSED')
    }

    const r = await sendWhatsAppTemplate(
      '573101234567',
      'tpl',
      'es_CO',
      ['x'],
      null,
      CREDS,
    )

    assert(r.ok === false, 'ok=false')
    assert((r.error ?? '').includes('Network error'), `error incluye Network error, got: ${r.error}`)
    assert(r.errorCode === undefined, 'sin errorCode en fallo de red')
  })

  await test('Sin creds → throw (multi-tenant obliga token per-clínica)', async () => {
    let threw = false
    try {
      await sendWhatsAppTemplate('573101234567', 'tpl', 'es_CO', ['x'], null, null)
    } catch (err) {
      threw = true
      assert((err as Error).message.includes('clinicCreds'), 'error menciona clinicCreds')
    }
    assert(threw, 'debería tirar sin creds')
  })

  console.log(`\n${pass} pass · ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
