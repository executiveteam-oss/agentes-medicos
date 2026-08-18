/**
 * DIAGNÓSTICO DEL LOGIN DE iSALUD. Solo lectura — no escribe ni en iSalud ni en la base.
 *
 * `testISaludConnection` devuelve {ok, error} y colapsa todo en un string. Acá se
 * separan las dos etapas, que responden preguntas distintas:
 *
 *   ETAPA 1 · login      → si falla, la contraseña o el flujo cambiaron
 *   ETAPA 2 · agenda     → si el login pasa y esto falla, la contraseña está BIEN
 *                          y lo que cambió es otra cosa
 *
 * Además reporta el markup del formulario tal como está hoy (campos, captcha,
 * redirects), para poder decir si iSalud cambió el flujo y no solo "falló".
 *
 * Run: NODE_ENV=development TZ=America/Bogota npx tsx scripts/diag-isalud-login.ts
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { launchBrowserAndContext } from '../src/lib/isalud/adapter'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const INTEGRACION = '18b78a8a-1904-4ab2-99a1-2d32b64cf8e3'   // Algia productiva

const linea = (t = '─') => console.log(t.repeat(70))

async function main() {
  const { data } = await sb.from('sync_integrations')
    .select('credentials, sync_status, last_synced_at, sync_error').eq('id', INTEGRACION).single()
  const c = data!.credentials as { subdomain: string; username: string; password: string }

  console.log('\nESTADO GUARDADO EN LA BASE')
  linea()
  console.log(`  subdomain    : ${c.subdomain}`)
  console.log(`  username     : ${c.username}`)
  console.log(`  password     : ${c.password ? `(${c.password.length} caracteres)` : '❌ VACÍA'}`)
  console.log(`  sync_status  : ${data!.sync_status}`)
  console.log(`  last_synced  : ${data!.last_synced_at}`)
  console.log(`  sync_error   : ${data!.sync_error ?? '—'}`)

  const baseUrl = `https://${c.subdomain}.isalud.co`
  const { browser, context } = await launchBrowserAndContext()
  const page = await context.newPage()

  try {
    console.log('\nETAPA 1 · LOGIN')
    linea()
    const r = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`  GET ${baseUrl}/ → HTTP ${r?.status()}`)
    console.log(`  URL final : ${page.url()}`)
    console.log(`  <title>   : "${await page.title()}"`)

    // ¿El formulario es el que el código espera?
    const campos = await page.locator('input').evaluateAll(els =>
      els.map(e => ({ name: (e as HTMLInputElement).name, type: (e as HTMLInputElement).type }))
         .filter(x => x.name))
    console.log(`  inputs del form: ${JSON.stringify(campos)}`)

    const tieneUsuario = campos.some(x => x.name === 'login[Usuario]')
    const tieneClave = campos.some(x => x.name === 'login[Clave]')
    console.log(`  login[Usuario] presente: ${tieneUsuario ? 'sí' : '❌ NO'}`)
    console.log(`  login[Clave]   presente: ${tieneClave ? 'sí' : '❌ NO'}`)

    // ¿Apareció un captcha?
    const html = await page.content()
    const captcha = /recaptcha|hcaptcha|g-recaptcha|cf-turnstile|captcha/i.test(html)
    console.log(`  ¿captcha en la página?: ${captcha ? '🔴 SÍ' : 'no'}`)

    if (!tieneUsuario || !tieneClave) {
      console.log('\n  🔴 EL FORMULARIO CAMBIÓ. El código busca login[Usuario] / login[Clave].')
      console.log('     No es la contraseña: es el markup.')
      return
    }

    await page.locator('input[name="login[Usuario]"]').fill(c.username)
    await page.locator('input[name="login[Clave]"]').fill(c.password)
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 30000 }),
      page.locator('form#form-login button[type="submit"]').click(),
    ])
    await page.waitForTimeout(1500)

    const urlPost = page.url()
    const formSigue = (await page.locator('input[name="login[Usuario]"]').count()) > 0
    console.log(`\n  Tras el submit → ${urlPost}`)
    console.log(`  ¿el form de login sigue presente?: ${formSigue ? '🔴 SÍ (rechazo)' : 'no (pasó)'}`)

    if (formSigue) {
      // El texto CRUDO que devuelve iSalud, sin interpretar.
      const textos = await page.locator('.alert, .error, .flash-error, [class*="error"], [class*="alert"]')
        .evaluateAll(els => els.map(e => (e.textContent ?? '').trim()).filter(Boolean))
      console.log('\n  TEXTO CRUDO DE iSALUD:')
      if (textos.length === 0) console.log('    (no devolvió ningún mensaje visible)')
      for (const t of textos) console.log(`    « ${t.slice(0, 300)} »`)
      console.log('\n  🔴 LOGIN RECHAZADO — la contraseña guardada ya no sirve.')
      return
    }

    console.log('  ✅ LOGIN OK — la contraseña guardada es válida.')

    console.log('\nETAPA 2 · CONSULTA DE AGENDA')
    linea()
    const r2 = await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`  GET ${baseUrl}/disponibilidad → HTTP ${r2?.status()}`)
    console.log(`  URL final : ${page.url()}`)
    console.log(`  <title>   : "${await page.title()}"`)

    const volvioAlLogin = (await page.locator('input[name="login[Usuario]"]').count()) > 0
    if (volvioAlLogin) {
      console.log('  🔴 Rebotó al login → la sesión no se sostiene (cookie/redirect cambió).')
      console.log('     OJO: esto NO es contraseña equivocada, el login ya había pasado.')
      return
    }
    const filas = await page.locator('table tr').count()
    console.log(`  filas de tabla en la página: ${filas}`)
    console.log('  ✅ AGENDA ACCESIBLE — la sesión se sostiene y la consulta responde.')

  } catch (err) {
    console.log('\n  🔴 EXCEPCIÓN')
    console.log(`  ${err instanceof Error ? err.message : String(err)}`)
    console.log(`  URL al momento del fallo: ${page.url()}`)
  } finally {
    await browser.close().catch(() => {})
    console.log('')
    linea('═')
    console.log('Solo lectura. No se escribió nada.')
    linea('═')
  }
}

main().catch(e => { console.error('FALLÓ:', e instanceof Error ? e.stack : e); process.exit(1) })
