/**
 * Diagnóstico de UN SOLO intento de login + lectura HTTP a iSalud.
 *
 * - Lee credenciales del DB (no las imprime)
 * - Hace EXACTAMENTE el mismo flujo HTTP de adapter.ts loginAndInjectCookies
 *   (GET / + POST /autenticacion/login + follow redirect) — UN intento
 * - Si auth falla: PARA, no reintenta
 * - Si auth pasa: GET /disponibilidad y GET /admision con cookies
 *   (lectura pura, inspección de HTML estructural)
 *
 * NO usa Playwright/Chromium — solo fetch().
 * NO escribe en iSalud (excepto el POST de login obligatorio).
 * NO toca DB en este script.
 *
 * Run: TZ=America/Bogota npx tsx scripts/diagnose-isalud-login-once.ts
 */

import { createClient } from '@supabase/supabase-js'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

interface ParsedCookie { name: string; value: string }

function extractCookies(res: Response): ParsedCookie[] {
  const out: ParsedCookie[] = []
  const headers = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  const fallback = res.headers.get('set-cookie')
  const raw = headers.length > 0 ? headers : (fallback ? [fallback] : [])
  for (const cookieStr of raw) {
    const firstSemi = cookieStr.indexOf(';')
    const kv = firstSemi >= 0 ? cookieStr.slice(0, firstSemi) : cookieStr
    const eq = kv.indexOf('=')
    if (eq > 0) out.push({ name: kv.slice(0, eq).trim(), value: kv.slice(eq + 1).trim() })
  }
  return out
}

async function main() {
  console.log('=== iSalud Login Diagnostic — UN SOLO INTENTO ===')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`TZ: ${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`)

  // 1. Read creds from DB
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) { console.error('Missing Supabase env vars'); process.exit(1) }

  const admin = createClient(supaUrl, supaKey)
  const { data: integration, error } = await admin
    .from('sync_integrations')
    .select('credentials, sync_status')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('provider', 'isalud')
    .single()

  if (error || !integration) { console.error('No integration found:', error?.message); process.exit(1) }
  const creds = integration.credentials as { subdomain: string; username: string; password: string }
  console.log(`Integration sync_status: ${integration.sync_status} (esperado: disabled — script no usa cron)`)
  console.log(`Subdomain: ${creds.subdomain}`)
  console.log(`Username length: ${creds.username.length}, password length: ${creds.password.length}`)
  console.log('')

  const baseUrl = `https://${creds.subdomain}.isalud.co`
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

  // ============================================================
  // PASO 1: GET / (login page) — extraer CSRF + cookies
  // ============================================================
  console.log('--- PASO 1: GET / (login page) ---')
  const t1 = Date.now()
  let loginHtml: string
  let initialCookies: ParsedCookie[]
  let csrfToken: string
  let formAction: string
  try {
    const res = await fetch(`${baseUrl}/`, { headers: { 'User-Agent': UA } })
    loginHtml = await res.text()
    initialCookies = extractCookies(res)
    console.log(`  Status: ${res.status} ${res.statusText}`)
    console.log(`  Duration: ${Date.now() - t1}ms`)
    console.log(`  HTML length: ${loginHtml.length} chars`)
    console.log(`  Server header: ${res.headers.get('server')}`)
    console.log(`  Initial cookies: ${initialCookies.length} (${initialCookies.map((c) => c.name).join(', ')})`)

    const csrfMatch = loginHtml.match(/name="login\[_csrf_token\]"\s+value="([^"]+)"/)
    csrfToken = csrfMatch?.[1] ?? ''
    const actionMatch = loginHtml.match(/<form[^>]*action="([^"]*)"/)
    formAction = actionMatch?.[1] ?? '/'

    console.log(`  CSRF token: ${csrfToken ? csrfToken.slice(0, 8) + '...' + ` (len=${csrfToken.length})` : 'NOT FOUND'}`)
    console.log(`  Form action: ${formAction}`)
    console.log(`  Form has login[Usuario]: ${loginHtml.includes('login[Usuario]')}`)
    console.log(`  Form has login[Clave]: ${loginHtml.includes('login[Clave]')}`)

    if (!csrfToken || !loginHtml.includes('login[Usuario]')) {
      console.error('  ❌ Form structure changed or missing fields. STOP — auth would be impossible.')
      process.exit(1)
    }
  } catch (err) {
    console.error(`  ❌ GET / failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  console.log('')

  // ============================================================
  // PASO 2: POST /autenticacion/login — UN INTENTO ÚNICO
  // ============================================================
  console.log('--- PASO 2: POST /autenticacion/login (UN intento, sin retry) ---')
  const t2 = Date.now()
  const postUrl = formAction.startsWith('http') ? formAction : `${baseUrl}${formAction.startsWith('/') ? formAction : '/' + formAction}`
  console.log(`  URL: ${postUrl}`)

  const cookieHeader = initialCookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const formData = new URLSearchParams({
    'login[Usuario]': creds.username,
    'login[Clave]': creds.password,
    'login[_csrf_token]': csrfToken,
  })

  let postRes: Response
  let postHtml: string
  let postCookies: ParsedCookie[]
  let location: string
  try {
    postRes = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'User-Agent': UA,
        'Referer': `${baseUrl}/`,
      },
      body: formData.toString(),
      redirect: 'manual',
    })
    postHtml = await postRes.text()
    postCookies = extractCookies(postRes)
    location = postRes.headers.get('location') ?? ''
    console.log(`  Status: ${postRes.status} ${postRes.statusText}`)
    console.log(`  Duration: ${Date.now() - t2}ms`)
    console.log(`  Location header: "${location || '(none)'}"`)
    console.log(`  New cookies: ${postCookies.length} (${postCookies.map((c) => c.name).join(', ')})`)
    console.log(`  Response body length: ${postHtml.length} chars`)
  } catch (err) {
    console.error(`  ❌ POST failed: ${err instanceof Error ? err.message : err}`)
    console.error(`  Stack: ${err instanceof Error ? err.stack : ''}`)
    process.exit(1)
  }

  // Determinar si auth fue exitoso
  // Login success = 302/301 redirect a algo distinto de /
  // Login fail = 422, o 200 (vuelve al form), o redirect a /
  const authSuccess = (postRes.status === 302 || postRes.status === 301) && location !== '/' && location !== ''
  const isLoginFormReturned = postRes.status === 200 && (postHtml.includes('login[Usuario]') || postHtml.includes('login[Clave]'))
  const is422 = postRes.status === 422

  console.log('')
  console.log('--- DIAGNÓSTICO POST de login ---')
  if (authSuccess) {
    console.log(`  ✅ AUTH SUCCESS — status ${postRes.status}, redirect a "${location}" (≠ /)`)
  } else if (is422) {
    console.log(`  ❌ AUTH FAIL — status 422 (credenciales explícitamente rechazadas)`)
    console.log(`  Response preview: ${postHtml.slice(0, 300).replace(/\s+/g, ' ')}`)
    console.log(`  STOP. No retry. Reportando.`)
    process.exit(0)
  } else if (isLoginFormReturned) {
    console.log(`  ❌ AUTH FAIL — status 200 con form de login devuelto (vuelta al form)`)
    console.log(`  Response preview: ${postHtml.slice(0, 300).replace(/\s+/g, ' ')}`)
    console.log(`  STOP. No retry. Reportando.`)
    process.exit(0)
  } else {
    console.log(`  ⚠️  AUTH AMBIGUO — status ${postRes.status}, location "${location}". Comportamiento no esperado.`)
    console.log(`  Response preview: ${postHtml.slice(0, 300).replace(/\s+/g, ' ')}`)
    console.log(`  STOP por seguridad. Reportando.`)
    process.exit(0)
  }

  // ============================================================
  // PASO 3: Follow redirect — get final session cookies
  // ============================================================
  console.log('')
  console.log('--- PASO 3: GET redirect (consolidar cookies de sesión) ---')
  const t3 = Date.now()
  const allCookies = [...initialCookies]
  for (const nc of postCookies) {
    const idx = allCookies.findIndex((c) => c.name === nc.name)
    if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
  }

  const redirectUrl = location.startsWith('http') ? location : `${baseUrl}${location}`
  console.log(`  URL: ${redirectUrl}`)
  try {
    const redirectRes = await fetch(redirectUrl, {
      headers: {
        'Cookie': allCookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'User-Agent': UA,
      },
      redirect: 'manual',
    })
    const redirectCookies = extractCookies(redirectRes)
    for (const nc of redirectCookies) {
      const idx = allCookies.findIndex((c) => c.name === nc.name)
      if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
    }
    console.log(`  Status: ${redirectRes.status}, Duration: ${Date.now() - t3}ms`)
    console.log(`  +${redirectCookies.length} new cookies`)
    console.log(`  Total session cookies: ${allCookies.length} (${allCookies.map((c) => c.name).join(', ')})`)
  } catch (err) {
    console.error(`  ⚠️  Redirect failed: ${err instanceof Error ? err.message : err}`)
    // No paramos — el login en sí pasó. Solo loguear.
  }
  console.log('')

  // ============================================================
  // PASO 4: GET /disponibilidad con cookies — lectura HTML estructural
  // ============================================================
  console.log('--- PASO 4: GET /disponibilidad (lectura HTML estructural) ---')
  const t4 = Date.now()
  try {
    const res = await fetch(`${baseUrl}/disponibilidad`, {
      headers: {
        'Cookie': allCookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'User-Agent': UA,
      },
    })
    const html = await res.text()
    console.log(`  Status: ${res.status}, Duration: ${Date.now() - t4}ms, HTML: ${html.length} chars`)

    // Inspección estructural (lo que adapter.ts línea 240-260 espera)
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
    console.log(`  Page title: "${titleMatch?.[1] ?? '(none)'}"`)
    console.log(`  Has <table>: ${html.includes('<table')}`)
    console.log(`  Has <tbody>: ${html.includes('<tbody')}`)
    console.log(`  Has "Cargar todo": ${html.includes('Cargar todo')}`)
    console.log(`  Has DataTables: ${html.includes('dataTables') || html.includes('DataTables')}`)
    console.log(`  Has login[Usuario] (= sesión expiró): ${html.includes('login[Usuario]')}`)

    // Extraer headers de la tabla
    const headerMatches = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    if (headerMatches.length > 0) {
      console.log(`  Table headers (${headerMatches.length}): [${headerMatches.slice(0, 12).map((m) => m[1].trim()).join(' | ')}]`)
    }
  } catch (err) {
    console.error(`  ❌ GET /disponibilidad failed: ${err instanceof Error ? err.message : err}`)
  }
  console.log('')

  // ============================================================
  // PASO 5: GET /admision con cookies — lectura HTML estructural
  // ============================================================
  console.log('--- PASO 5: GET /admision (lectura HTML estructural) ---')
  const t5 = Date.now()
  try {
    const res = await fetch(`${baseUrl}/admision`, {
      headers: {
        'Cookie': allCookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'User-Agent': UA,
      },
    })
    const html = await res.text()
    console.log(`  Status: ${res.status}, Duration: ${Date.now() - t5}ms, HTML: ${html.length} chars`)

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
    console.log(`  Page title: "${titleMatch?.[1] ?? '(none)'}"`)
    console.log(`  Has <table>: ${html.includes('<table')}`)
    console.log(`  Has <tbody>: ${html.includes('<tbody')}`)
    console.log(`  Has #admision-date: ${html.includes('admision-date')}`)
    console.log(`  Has DataTables: ${html.includes('dataTables') || html.includes('DataTables')}`)
    console.log(`  Has datepicker: ${html.includes('datepicker')}`)
    console.log(`  Has login[Usuario] (= sesión expiró): ${html.includes('login[Usuario]')}`)

    const headerMatches = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    if (headerMatches.length > 0) {
      // Headers que el parser usa: c[0]=id, c[1]=identificacion, c[2]=nombre_paciente,
      //   c[3]=procedimiento, c[4]=aseguradora, c[5]=profesional, c[6]=ubicacion,
      //   c[7]=hora_inicial, c[8]=fase, c[14]=fecha, c[15]=hora_final
      console.log(`  Table headers (${headerMatches.length} total):`)
      headerMatches.slice(0, 18).forEach((m, i) => console.log(`    [${i}] ${m[1].trim()}`))
    }
  } catch (err) {
    console.error(`  ❌ GET /admision failed: ${err instanceof Error ? err.message : err}`)
  }

  console.log('')
  console.log('=== Diagnóstico completo ===')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
