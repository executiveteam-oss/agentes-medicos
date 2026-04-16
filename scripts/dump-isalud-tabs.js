#!/usr/bin/env node

// ============================================================
// DIAGNOSTIC — Dump de la estructura de tabs en /aseguradora/{id}/edit
//
// Usa Google Chrome del Mac + playwright-core. Login por HTTP +
// cookie injection (mismo flujo que adapter.ts). No modifica nada.
//
// Output:
//   - /tmp/isalud-debug.html (page.content() completo)
//   - Console: tab structure detallada
// ============================================================

const { chromium } = require('playwright-core')
const { createClient } = require('@supabase/supabase-js')
const { readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')

// --- Env ---
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i)] = t.slice(i + 1)
}

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TARGET_URL_PATH = '/aseguradora/67/edit' // el primer convenio de Algia (de los logs)

async function main() {
  console.log('=== DUMP iSalud Tabs ===\n')

  // 1) Leer creds de Supabase
  const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
  const { data: integ, error } = await supa.from('sync_integrations')
    .select('credentials').eq('clinic_id', ALGIA).eq('provider', 'isalud').maybeSingle()
  if (error || !integ) { console.error('No Algia creds:', error); process.exit(1) }
  const creds = integ.credentials
  console.log(`Algia creds OK: subdomain=${creds.subdomain}, user=${creds.username}\n`)

  const baseUrl = `https://${creds.subdomain}.isalud.co`

  // 2) Launch Chrome del sistema
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8' },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  console.log('Browser launched OK\n')

  // 3) Login HTTP
  const loginPageRes = await fetch(`${baseUrl}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0' },
  })
  const loginHtml = await loginPageRes.text()
  const initialCookies = extractCookies(loginPageRes)

  const csrfMatch = loginHtml.match(/name="login\[_csrf_token\]"\s+value="([^"]+)"/)
  const actionMatch = loginHtml.match(/<form[^>]*action="([^"]*)"/)
  const csrfToken = csrfMatch?.[1] ?? ''
  const formAction = actionMatch?.[1] ?? '/'
  const postUrl = formAction.startsWith('http') ? formAction : `${baseUrl}${formAction.startsWith('/') ? formAction : '/' + formAction}`
  console.log(`Login page: csrf=${csrfToken.slice(0, 10)}..., action=${postUrl}`)

  const cookieHeader = initialCookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const formData = new URLSearchParams({
    'login[Usuario]': creds.username,
    'login[Clave]': creds.password,
    'login[_csrf_token]': csrfToken,
  })
  const loginRes = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0',
      'Referer': `${baseUrl}/`,
    },
    body: formData.toString(),
    redirect: 'manual',
  })
  console.log(`Login POST: status=${loginRes.status}, location=${loginRes.headers.get('location')}`)
  if (loginRes.status !== 302) { console.error('Login failed'); await browser.close(); process.exit(1) }

  const postCookies = extractCookies(loginRes)
  const allCookies = [...initialCookies]
  for (const nc of postCookies) {
    const idx = allCookies.findIndex((c) => c.name === nc.name)
    if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
  }

  // Follow redirect
  const loc = loginRes.headers.get('location') ?? '/'
  const redirUrl = loc.startsWith('http') ? loc : `${baseUrl}${loc}`
  const redirRes = await fetch(redirUrl, {
    headers: { Cookie: allCookies.map((c) => `${c.name}=${c.value}`).join('; '), 'User-Agent': 'Mozilla/5.0 Chrome/122.0.0.0' },
    redirect: 'manual',
  })
  const redirCookies = extractCookies(redirRes)
  for (const nc of redirCookies) {
    const idx = allCookies.findIndex((c) => c.name === nc.name)
    if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
  }

  const domain = `${creds.subdomain}.isalud.co`
  await context.addCookies(allCookies.map((c) => ({ name: c.name, value: c.value, domain, path: '/' })))
  console.log(`Cookies injected: ${allCookies.map((c) => c.name).join(', ')}\n`)

  // 4) Navigate a /aseguradora/67/edit
  const page = await context.newPage()
  const targetUrl = `${baseUrl}${TARGET_URL_PATH}`
  console.log(`Navigating to: ${targetUrl}`)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)
  console.log(`Arrived at: ${page.url()}, title: "${await page.title()}"\n`)

  // 5) Dump page.content() a archivo
  const html = await page.content()
  const dumpPath = '/tmp/isalud-debug.html'
  writeFileSync(dumpPath, html, 'utf-8')
  console.log(`→ HTML completo guardado en ${dumpPath} (${html.length} chars)\n`)

  // 6) Dump .nav-tabs outerHTML
  const navDump = await page.evaluate(() => {
    const navTabs = document.querySelector('ul.nav-tabs')
    const navGeneric = document.querySelector('ul.nav')
    return {
      navTabsOuterHTML: navTabs ? navTabs.outerHTML : null,
      navGenericOuterHTML: !navTabs && navGeneric ? navGeneric.outerHTML : null,
    }
  })

  console.log('==========================================')
  console.log('  ul.nav-tabs OUTER HTML')
  console.log('==========================================')
  if (navDump.navTabsOuterHTML) {
    console.log(navDump.navTabsOuterHTML)
  } else if (navDump.navGenericOuterHTML) {
    console.log('(No ul.nav-tabs — usando ul.nav:)')
    console.log(navDump.navGenericOuterHTML)
  } else {
    console.log('(no encontrado)')
  }
  console.log()

  // 7) Detalle de cada <A> y <LI> dentro de los tabs
  const tabsDetail = await page.evaluate(() => {
    const container = document.querySelector('ul.nav-tabs, ul.nav')
    if (!container) return { note: 'no container found', items: [] }
    const items = Array.from(container.querySelectorAll('a, li')).map((el) => ({
      tag: el.tagName,
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      href: el.getAttribute('href') ?? '',
      dataToggle: el.getAttribute('data-toggle') ?? '',
      dataTarget: el.getAttribute('data-target') ?? '',
      id: el.getAttribute('id') ?? '',
      role: el.getAttribute('role') ?? '',
      class: el.getAttribute('class') ?? '',
      parentTag: el.parentElement?.tagName ?? '',
      innerHTML: el.innerHTML.slice(0, 200),
    }))
    return { note: null, items }
  })

  console.log('==========================================')
  console.log('  Elementos <A> y <LI> dentro de ul.nav*')
  console.log('==========================================')
  if (tabsDetail.note) {
    console.log(tabsDetail.note)
  } else {
    tabsDetail.items.forEach((t, i) => {
      console.log(`\n[${i}] <${t.tag}> parent=<${t.parentTag}>`)
      console.log(`    text: "${t.text}"`)
      console.log(`    href: "${t.href}"`)
      console.log(`    data-toggle: "${t.dataToggle}"`)
      console.log(`    data-target: "${t.dataTarget}"`)
      console.log(`    id: "${t.id}"  role: "${t.role}"  class: "${t.class}"`)
      console.log(`    innerHTML: ${t.innerHTML}`)
    })
  }
  console.log()

  // 8) Buscar específicamente cualquier cosa con texto "Detalle Tarifario"
  const hitsDT = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    return all
      .filter((el) => {
        const t = (el.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
        return t === 'detalle tarifario' && el.children.length === 0
      })
      .slice(0, 10)
      .map((el) => ({
        tag: el.tagName,
        parent: el.parentElement?.tagName ?? '',
        grandparent: el.parentElement?.parentElement?.tagName ?? '',
        parentClass: el.parentElement?.getAttribute('class') ?? '',
        parentHref: el.parentElement?.getAttribute('href') ?? '',
        parentDataToggle: el.parentElement?.getAttribute('data-toggle') ?? '',
        parentDataTarget: el.parentElement?.getAttribute('data-target') ?? '',
        parentOuterHTML: (el.parentElement?.outerHTML ?? '').slice(0, 400),
      }))
  })

  console.log('==========================================')
  console.log('  Hits textContent === "Detalle Tarifario" (leaf elements)')
  console.log('==========================================')
  if (hitsDT.length === 0) {
    console.log('(ninguno)')
  } else {
    hitsDT.forEach((h, i) => {
      console.log(`\n[${i}] <${h.tag}> parent=<${h.parent}> grandparent=<${h.grandparent}>`)
      console.log(`    parent class: "${h.parentClass}"`)
      console.log(`    parent href: "${h.parentHref}"`)
      console.log(`    parent data-toggle: "${h.parentDataToggle}"`)
      console.log(`    parent data-target: "${h.parentDataTarget}"`)
      console.log(`    parent outer: ${h.parentOuterHTML}`)
    })
  }
  console.log()

  await browser.close()
  console.log('✅ Done')
}

function extractCookies(res) {
  const cookies = []
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const nameValue = value.split(';')[0]
      const eqIdx = nameValue.indexOf('=')
      if (eqIdx > 0) cookies.push({ name: nameValue.slice(0, eqIdx), value: nameValue.slice(eqIdx + 1) })
    }
  })
  return cookies
}

main().catch((e) => { console.error(e); process.exit(1) })
