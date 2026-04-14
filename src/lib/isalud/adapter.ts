// ============================================================
// iSalud Adapter — Playwright headless (Vercel Pro)
// ============================================================

import { chromium as playwrightChromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

// --- Types ---

export interface ISaludCredentials {
  subdomain: string
  username: string
  password: string
}

export interface ISaludDisponibilidadSlot {
  dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string
}

export interface ISaludProfesional {
  nombre: string; puntos_atencion: string[]; slots: ISaludDisponibilidadSlot[]
}

export interface ISaludAdmision {
  id: string; identificacion: string; nombre_paciente: string
  procedimiento: string; aseguradora: string; profesional_nombre: string
  ubicacion: string; hora_inicial: string; hora_final: string; fase: string; fecha: string
}

export interface ScrapeResult {
  profesionales: ISaludProfesional[]; admisiones: ISaludAdmision[]; errors: string[]
}

// --- Browser ---

const CHROMIUM_REMOTE_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

async function launchBrowserAndContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  console.log(`[iSalud] Launching browser (NODE_ENV=${process.env.NODE_ENV})`)

  let browser: Browser
  if (process.env.NODE_ENV === 'development') {
    browser = await playwrightChromium.launch({ headless: true })
  } else {
    const chromiumPkg = await import('@sparticuz/chromium')
    chromiumPkg.default.setGraphicsMode = false

    let executablePath: string
    try {
      executablePath = await chromiumPkg.default.executablePath()
      console.log(`[iSalud] Chromium local path: ${executablePath}`)
    } catch {
      console.log('[iSalud] Local chromium not found — downloading from remote...')
      executablePath = await chromiumPkg.default.executablePath(CHROMIUM_REMOTE_URL)
      console.log(`[iSalud] Chromium downloaded to: ${executablePath}`)
    }

    browser = await playwrightChromium.launch({
      args: [
        ...chromiumPkg.default.args,
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      executablePath,
      headless: true,
    })
  }

  // Create context that looks like a real browser
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: { 'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8' },
  })

  // Hide webdriver detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CO', 'es'] })
    // @ts-ignore
    window.chrome = { runtime: {} }
  })

  console.log('[iSalud] Browser + context created with anti-detection')
  return { browser, context }
}

// --- Login via HTTP, then inject cookies into Playwright context ---

async function loginAndInjectCookies(context: BrowserContext, credentials: ISaludCredentials): Promise<Page> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  console.log(`[iSalud] VERSION 3 - ${new Date().toISOString()}`)
  console.log(`[iSalud] HTTP login to ${baseUrl}/`)

  // Step 1: GET login page to extract CSRF token + cookies
  const loginPageRes = await fetch(`${baseUrl}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
  })
  const loginHtml = await loginPageRes.text()
  const initialCookies = extractAllSetCookies(loginPageRes)
  console.log(`[iSalud] GET /login: status ${loginPageRes.status}, HTML ${loginHtml.length} chars, cookies: ${initialCookies.length}`)

  // Extract CSRF token (try multiple patterns)
  const csrfMatch = loginHtml.match(/name="login\[_csrf_token\]"\s+value="([^"]+)"/)
    ?? loginHtml.match(/name="_csrf_token"\s+value="([^"]+)"/)
    ?? loginHtml.match(/name="_token"\s+value="([^"]+)"/)
  const csrfToken = csrfMatch?.[1] ?? ''

  // Extract form action
  const actionMatch = loginHtml.match(/<form[^>]*action="([^"]*)"/)
  const formAction = actionMatch?.[1] ?? '/'
  console.log(`[iSalud] CSRF token: ${csrfToken ? csrfToken.slice(0, 10) + '...' : 'NOT FOUND'}`)
  console.log(`[iSalud] Form action: ${formAction}`)
  console.log(`[iSalud] Has login[Usuario]: ${loginHtml.includes('login[Usuario]')}`)
  console.log(`[iSalud] HTML preview: ${loginHtml.slice(0, 300)}`)

  // Step 2: POST login
  const cookieHeader = initialCookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const formData = new URLSearchParams({
    'login[Usuario]': credentials.username,
    'login[Clave]': credentials.password,
    'login[_csrf_token]': csrfToken,
  })

  const postUrl = formAction.startsWith('http') ? formAction : `${baseUrl}${formAction.startsWith('/') ? formAction : '/' + formAction}`
  console.log(`[iSalud] POST to: ${postUrl}`)
  const loginRes = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': `${baseUrl}/`,
    },
    body: formData.toString(),
    redirect: 'manual',
  })

  const postCookies = extractAllSetCookies(loginRes)
  const location = loginRes.headers.get('location') ?? ''
  console.log(`[iSalud] POST /login: status ${loginRes.status}, redirect: "${location}", new cookies: ${postCookies.length}`)

  // Login success = 302 redirect to somewhere other than root
  // Login fail = 422 or redirect back to / or no redirect at all
  if (loginRes.status === 422 || (loginRes.status !== 302 && loginRes.status !== 301)) {
    console.error(`[iSalud] Login FAILED — status ${loginRes.status}, no redirect`)
    throw new Error('Login fallido — credenciales inválidas')
  }

  // Merge all cookies
  const allCookies = [...initialCookies]
  for (const nc of postCookies) {
    const idx = allCookies.findIndex((c) => c.name === nc.name)
    if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
  }
  console.log(`[iSalud] Total cookies to inject: ${allCookies.length} (${allCookies.map((c) => c.name).join(', ')})`)

  // Step 3: Follow redirect (to get more cookies + confirm login)
  if (location) {
    const redirectUrl = location.startsWith('http') ? location : `${baseUrl}${location}`
    const redirectRes = await fetch(redirectUrl, {
      headers: {
        'Cookie': allCookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'manual',
    })
    const redirectCookies = extractAllSetCookies(redirectRes)
    for (const nc of redirectCookies) {
      const idx = allCookies.findIndex((c) => c.name === nc.name)
      if (idx >= 0) allCookies[idx] = nc; else allCookies.push(nc)
    }
    console.log(`[iSalud] Redirect ${redirectRes.status} → ${redirectRes.headers.get('location') ?? 'no further redirect'}, +${redirectCookies.length} cookies`)
  }

  // Step 4: Inject cookies into Playwright context
  const domain = `${credentials.subdomain}.isalud.co`
  await context.addCookies(allCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain,
    path: '/',
  })))
  console.log(`[iSalud] Cookies injected into Playwright context`)

  // Step 5: Navigate Playwright to a post-login page to verify
  const page = await context.newPage()
  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const finalUrl = page.url()
  console.log(`[iSalud] Playwright navigated to: ${finalUrl}, title: "${await page.title()}"`)

  // If we're back at root (login page) or the URL hasn't changed from baseUrl, cookies didn't work
  if (finalUrl === `${baseUrl}/` || finalUrl === baseUrl) {
    console.error(`[iSalud] Session cookies not working — still at root: ${finalUrl}`)
    throw new Error('Login HTTP exitoso pero las cookies no mantienen la sesión en Playwright')
  }

  console.log('[iSalud] Login complete via HTTP + cookie injection')
  return page
}

// --- Cookie parser for fetch responses ---

interface ParsedCookie { name: string; value: string }

function extractAllSetCookies(res: Response): ParsedCookie[] {
  const cookies: ParsedCookie[] = []
  // Headers.forEach iterates all headers including duplicates
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const nameValue = value.split(';')[0]
      const eqIdx = nameValue.indexOf('=')
      if (eqIdx > 0) {
        cookies.push({ name: nameValue.slice(0, eqIdx), value: nameValue.slice(eqIdx + 1) })
      }
    }
  })
  return cookies
}

// --- Scrape profesionales ---

export async function scrapeProfesionales(page: Page, credentials: ISaludCredentials): Promise<ISaludProfesional[]> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  console.log(`[iSalud] Navigating to /disponibilidad`)
  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  console.log(`[iSalud] Disponibilidad URL: ${page.url()}, title: "${await page.title()}"`)

  // Log page structure
  const pageInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table')
    const tbodyRows = document.querySelectorAll('table tbody tr')
    const headers: string[] = []
    document.querySelectorAll('table thead th').forEach((th) => { headers.push(th.textContent?.trim() ?? '') })

    // Sample first 3 rows
    const sampleRows: string[][] = []
    for (let i = 0; i < Math.min(3, tbodyRows.length); i++) {
      const cells: string[] = []
      tbodyRows[i].querySelectorAll('td').forEach((td) => { cells.push(td.textContent?.trim()?.slice(0, 30) ?? '') })
      sampleRows.push(cells)
    }

    return {
      tableCount: tables.length,
      tbodyRowCount: tbodyRows.length,
      headers,
      sampleRows,
      bodyTextPreview: document.body.innerText.slice(0, 500),
    }
  })
  console.log(`[iSalud] Disponibilidad: ${pageInfo.tableCount} tables, ${pageInfo.tbodyRowCount} tbody rows`)
  console.log(`[iSalud] Headers: [${pageInfo.headers.join(' | ')}]`)
  if (pageInfo.sampleRows.length > 0) {
    pageInfo.sampleRows.forEach((row, i) => console.log(`[iSalud] Row ${i}: [${row.join(' | ')}]`))
  } else {
    console.log(`[iSalud] No tbody rows found. Body preview: ${pageInfo.bodyTextPreview.slice(0, 200)}`)
  }

  // Toggle "Cargar todo"
  const toggle = page.locator('text=Cargar todo').locator('..').locator('input, button, a, label')
  const toggleCount = await toggle.count()
  console.log(`[iSalud] "Cargar todo" toggle elements: ${toggleCount}`)
  if (toggleCount > 0) {
    await toggle.first().click().catch((e) => console.log(`[iSalud] Toggle click failed: ${e}`))
    await page.waitForTimeout(3000)
    console.log(`[iSalud] After toggle, waiting for data...`)
  }

  // Wait more for AJAX
  await page.waitForTimeout(3000)

  // Max records
  const selectCount = await page.locator('.dataTables_length select').count()
  console.log(`[iSalud] DataTables length selects: ${selectCount}`)
  if (selectCount > 0) {
    try { await page.selectOption('.dataTables_length select', '-1'); console.log('[iSalud] Set dataTables to show all') } catch {
      try { await page.selectOption('.dataTables_length select', '100'); console.log('[iSalud] Set dataTables to 100') } catch (e) { console.log(`[iSalud] DataTables select failed: ${e}`) }
    }
    await page.waitForTimeout(2000)
  }

  // Re-check rows after waits
  const rowCountAfter = await page.evaluate(() => document.querySelectorAll('table tbody tr').length)
  console.log(`[iSalud] Rows after toggle+wait: ${rowCountAfter}`)

  // Extract data
  const profesionales = await page.evaluate(() => {
    const map: Record<string, { puntos: string[]; slots: Array<{ dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string }> }> = {}
    document.querySelectorAll('table tbody tr').forEach((row) => {
      const cells = row.querySelectorAll('td')
      if (cells.length < 6) return
      const profesional = (cells[5]?.textContent?.trim() ?? '').toUpperCase()
      const punto = cells[6]?.textContent?.trim() ?? ''
      const fechaRaw = cells[1]?.textContent?.trim() ?? ''
      const horaInicio = (cells[2]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')
      const horaFin = (cells[3]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')
      if (!profesional || profesional.length < 3) return
      if (!map[profesional]) map[profesional] = { puntos: [], slots: [] }
      if (punto && !map[profesional].puntos.includes(punto)) map[profesional].puntos.push(punto)
      let fecha = '', ds = -1
      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) { fecha = fechaRaw; ds = new Date(fechaRaw + 'T12:00:00').getDay() }
      else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw)) { const [d, m, y] = fechaRaw.split('/'); fecha = `${y}-${m}-${d}`; ds = new Date(fecha + 'T12:00:00').getDay() }
      if (ds >= 0 && horaInicio) map[profesional].slots.push({ dia_semana: ds, hora_inicio: horaInicio, hora_fin: horaFin || horaInicio, fecha })
    })
    return Object.entries(map).map(([nombre, d]) => ({ nombre, puntos_atencion: d.puntos, slots: d.slots }))
  })

  console.log(`[iSalud] RESULT: ${profesionales.length} profesionales, ${profesionales.reduce((s, p) => s + p.slots.length, 0)} total slots`)
  profesionales.forEach((p) => console.log(`[iSalud]   - ${p.nombre} (${p.slots.length} slots, ${p.puntos_atencion.join(', ')})`))
  return profesionales
}

// --- Scrape admisiones ---

export async function scrapeAdmisiones(page: Page, credentials: ISaludCredentials, diasAdelante: number = 60): Promise<{ admisiones: ISaludAdmision[]; errors: string[] }> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  const all: ISaludAdmision[] = []
  const errors: string[] = []
  const today = new Date()

  // Navigate to /admision ONCE
  console.log(`[iSalud] Navigating to /admision`)
  await page.goto(`${baseUrl}/admision`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)
  console.log(`[iSalud] Admision URL: ${page.url()}`)

  // Log ALL visible inputs/selects to identify the date field
  const visibleInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select'))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({
        tag: el.tagName, name: (el as HTMLInputElement).name, id: el.id,
        type: (el as HTMLInputElement).type, value: (el as HTMLInputElement).value,
        placeholder: (el as HTMLInputElement).placeholder ?? '',
        className: el.className.slice(0, 50),
      }))
  )
  console.log(`[iSalud] Visible inputs: ${JSON.stringify(visibleInputs)}`)

  // Log table headers
  const headers = await page.evaluate(() => {
    const h: string[] = []; document.querySelectorAll('table thead th').forEach((th) => { h.push(th.textContent?.trim() ?? '') }); return h
  })
  console.log(`[iSalud] Headers: [${headers.join(' | ')}]`)

  // Max DataTables records
  try { await page.selectOption('.dataTables_length select', '-1') } catch {
    try { await page.selectOption('.dataTables_length select', '100') } catch {}
  }
  await page.waitForTimeout(1000)

  // Identify the date input
  const dateInput = page.locator('#admision-date, [name="admision-date"]')
  const dateInputExists = await dateInput.count() > 0
  console.log(`[iSalud] Date input #admision-date: ${dateInputExists ? 'FOUND' : 'NOT FOUND'}`)

  // Extract rows for each day by filling the datepicker
  for (let d = 0; d < diasAdelante; d++) {
    const date = new Date(today); date.setDate(date.getDate() + d)
    const fechaStr = date.toISOString().split('T')[0]

    try {
      if (dateInputExists) {
        // Clear + type date + trigger jQuery datepicker
        await dateInput.click()
        await dateInput.fill('')
        await dateInput.type(fechaStr, { delay: 50 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1500)

        // Also try jQuery trigger as backup
        await page.evaluate((fecha) => {
          const el = document.querySelector('#admision-date') as HTMLInputElement | null
          if (!el) return
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jq = (window as any).$ ?? (window as any).jQuery
            if (jq) {
              jq(el).val(fecha).trigger('change').trigger('changeDate')
              try { jq(el).datepicker('update', fecha) } catch { /* */ }
            }
          } catch { /* jQuery not available */ }
        }, fechaStr)
        await page.waitForTimeout(1500)
      }

      if (d === 0) {
        const currentVal = dateInputExists ? await dateInput.inputValue().catch(() => 'N/A') : 'N/A'
        console.log(`[iSalud] Day 0: input value="${currentVal}", requested="${fechaStr}"`)
      }

      // Extract rows
      const dayData = await page.evaluate(() => {
        const r: Array<{ id: string; identificacion: string; nombre_paciente: string; procedimiento: string; aseguradora: string; profesional_nombre: string; ubicacion: string; hora_inicial: string; hora_final: string; fase: string; fecha: string }> = []
        document.querySelectorAll('table tbody tr').forEach((row) => {
          const c = row.querySelectorAll('td'); if (c.length < 15) return
          const id = c[0]?.textContent?.trim() ?? ''
          const prof = (c[5]?.textContent?.trim() ?? '').toUpperCase()
          const fase = c[8]?.textContent?.trim() ?? 'Programado'
          if (!id || !prof || (fase !== 'Programado' && fase !== 'Admitido')) return

          let fechaRaw = c[14]?.textContent?.trim() ?? ''
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw)) {
            const [dd, mm, yyyy] = fechaRaw.split('/')
            fechaRaw = `${yyyy}-${mm}-${dd}`
          }

          r.push({
            id, identificacion: c[1]?.textContent?.trim() ?? '',
            nombre_paciente: c[2]?.textContent?.trim() ?? '',
            procedimiento: c[3]?.textContent?.trim() ?? '',
            aseguradora: c[4]?.textContent?.trim() ?? '',
            profesional_nombre: prof,
            ubicacion: c[6]?.textContent?.trim() ?? '',
            hora_inicial: (c[7]?.textContent?.trim() ?? '').replace(/:\d{2}$/, ''),
            hora_final: (c[15]?.textContent?.trim() ?? '').replace(/:\d{2}$/, ''),
            fase, fecha: fechaRaw,
          })
        })
        return r
      })

      if (dayData) all.push(...dayData)

      if (d < 3 || d % 10 === 0) {
        const realDates = dayData ? [...new Set(dayData.map((a) => a.fecha))] : []
        console.log(`[iSalud] Day ${d} (${fechaStr}): ${dayData?.length ?? 0} rows, dates in data: [${realDates.join(', ')}]`)
      }
    } catch (err) {
      errors.push(`${fechaStr}: ${err instanceof Error ? err.message : String(err)}`)
      if (d < 3) console.error(`[iSalud] Error day ${d}: ${err}`)
    }
  }

  // Deduplicate by id+fecha
  const uniqueMap = new Map<string, ISaludAdmision>()
  for (const adm of all) uniqueMap.set(`${adm.id}-${adm.fecha}`, adm)
  const deduped = Array.from(uniqueMap.values())

  if (deduped.length < all.length) {
    console.log(`[iSalud] Dedup: ${all.length} → ${deduped.length}`)
  }

  const uniqueDates = new Set(deduped.map((a) => a.fecha))
  console.log(`[iSalud] Admision RESULT: ${deduped.length} citas, ${uniqueDates.size} unique dates, ${errors.length} errors`)
  return { admisiones: deduped, errors }
}

// --- Main ---

export async function scrapeISalud(credentials: ISaludCredentials, options: { diasAdelante?: number } = {}): Promise<ScrapeResult> {
  console.log('[iSalud] START scrapeISalud')
  console.log(`[iSalud] NODE_ENV: ${process.env.NODE_ENV}`)
  console.log(`[iSalud] subdomain: ${credentials.subdomain}, username: ${credentials.username}`)

  // Pre-check: verify chromium module is importable
  if (process.env.NODE_ENV !== 'development') {
    try {
      const chromiumPkg = await import('@sparticuz/chromium')
      console.log(`[iSalud] @sparticuz/chromium module loaded OK`)
      console.log(`[iSalud] chromium.args: ${chromiumPkg.default.args?.length ?? 0} args`)
    } catch (e) {
      console.error(`[iSalud] @sparticuz/chromium IMPORT FAILED:`, e)
      return { profesionales: [], admisiones: [], errors: [`Chromium import failed: ${e instanceof Error ? e.message : String(e)}`] }
    }
  }

  const dias = options.diasAdelante ?? 60
  const errors: string[] = []
  let browser: Browser | null = null
  try {
    const launched = await launchBrowserAndContext()
    browser = launched.browser
    console.log('[iSalud] Browser launched OK')
    const page = await loginAndInjectCookies(launched.context, credentials)
    let profesionales: ISaludProfesional[] = []
    try { profesionales = await scrapeProfesionales(page, credentials) } catch (e) { errors.push(`Profesionales: ${e instanceof Error ? e.message : String(e)}`); console.error(`[iSalud] Profesionales error: ${e}`) }
    const admResult = await scrapeAdmisiones(page, credentials, dias)
    console.log(`[iSalud] FINAL: ${profesionales.length} profs, ${admResult.admisiones.length} admisiones, ${errors.length + admResult.errors.length} errors`)
    return { profesionales, admisiones: admResult.admisiones, errors: [...errors, ...admResult.errors] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error(`[iSalud] FATAL ERROR: ${msg}`)
    console.error(`[iSalud] STACK: ${stack}`)
    return { profesionales: [], admisiones: [], errors: [`Fatal: ${msg}`] }
  } finally {
    if (browser) await browser.close().catch(() => {})
    console.log('[iSalud] Browser closed')
  }
}

export async function testISaludConnection(credentials: ISaludCredentials): Promise<{ ok: boolean; error?: string }> {
  let browser: Browser | null = null
  try {
    const launched = await launchBrowserAndContext()
    browser = launched.browser
    const page = await loginAndInjectCookies(launched.context, credentials)
    await page.close()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de conexión' }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
