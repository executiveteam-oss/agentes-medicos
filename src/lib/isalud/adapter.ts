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

export async function launchBrowserAndContext(): Promise<{ browser: Browser; context: BrowserContext }> {
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

// --- Login via Playwright (browser-native — fixes false-positive auth check from HTTP version) ---

export async function loginAndInjectCookies(context: BrowserContext, credentials: ISaludCredentials): Promise<Page> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  console.log(`[iSalud] VERSION 4 (Playwright-native login) - ${new Date().toISOString()}`)
  console.log(`[iSalud] Login to ${baseUrl}/ via Playwright`)

  const page = await context.newPage()

  // Step 1: Cargar la página de login (el browser maneja Origin, Accept, Sec-Fetch-*, cookies, CSRF nativos)
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  console.log(`[iSalud] Login page: ${page.url()}, title: "${await page.title()}"`)

  // Step 2: Verificar que el form está realmente presente (iSalud podría haber cambiado markup)
  const usuarioField = page.locator('input[name="login[Usuario]"]')
  const claveField = page.locator('input[name="login[Clave]"]')
  if ((await usuarioField.count()) === 0 || (await claveField.count()) === 0) {
    throw new Error(`Login form no encontrado en ${page.url()} — iSalud cambió el markup`)
  }

  // Step 3: Llenar credenciales
  await usuarioField.fill(credentials.username)
  await claveField.fill(credentials.password)
  console.log(`[iSalud] Form filled (user: ${credentials.username.slice(0, 2)}***)`)

  // Step 4: Click "Ingresar" y esperar navegación post-submit
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 30000 }),
    page.locator('form#form-login button[type="submit"]').click(),
  ])
  // Settle por si hay redirect adicional client-side
  await page.waitForTimeout(1500)

  // Step 5: Detección de rechazo canónico. La señal SÓLIDA es la presencia del form
  // (iSalud re-renderiza el login form cuando rechaza credenciales).
  // La URL en `/` NO es señal de fail: iSalud puede servir dashboard en `/` para sesiones
  // autenticadas. El veredicto real de sesión válida lo da Step 6 (navegar a /disponibilidad).
  const postUrl = page.url()
  const stillHasLoginForm = (await page.locator('input[name="login[Usuario]"]').count()) > 0
  const isRoot = postUrl === `${baseUrl}/` || postUrl === baseUrl

  console.log(`[iSalud] After submit: url=${postUrl}, stillHasLoginForm=${stillHasLoginForm}, isRoot=${isRoot} (info)`)

  if (stillHasLoginForm) {
    // form aún visible = rechazo canónico de iSalud
    const errorMsg = await page
      .locator('.alert, .error, .flash-error, [class*="error"]')
      .first()
      .textContent({ timeout: 1000 })
      .catch(() => null)
    console.error(
      `[iSalud] Login FAILED — url=${postUrl}, formStillPresent=${stillHasLoginForm}, errorMsg="${(errorMsg ?? '').trim() || '(no message)'}"`,
    )
    throw new Error('Login fallido — iSalud rechazó las credenciales (form sigue presente)')
  }

  console.log(`[iSalud] Login parece OK — landed at ${postUrl}. Confirmando sesión con /disponibilidad...`)

  // Step 6: Confirmar que la sesión persiste navegando a una página interna conocida
  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const finalUrl = page.url()
  const bouncedBack =
    finalUrl === `${baseUrl}/` ||
    finalUrl === baseUrl ||
    (await page.locator('input[name="login[Usuario]"]').count()) > 0

  if (bouncedBack) {
    throw new Error(`Login pareció exitoso pero la sesión no se mantuvo (rebotó a ${finalUrl})`)
  }

  console.log(`[iSalud] Login complete via Playwright — session active on ${finalUrl}`)
  return page
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
        // Input is READONLY — can't use fill() or type()
        // Set value via JS + trigger jQuery datepicker events
        const setResult = await page.evaluate((fecha) => {
          const el = document.querySelector('#admision-date') as HTMLInputElement | null
          if (!el) return { ok: false, reason: 'element not found' }

          // Set value directly (bypasses readonly)
          el.value = fecha

          // Try jQuery triggers (datepicker reloads table via AJAX)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const jq = (window as any).$ ?? (window as any).jQuery
          if (jq) {
            try { jq(el).datepicker('setDate', fecha) } catch { /* */ }
            try { jq(el).datepicker('update', fecha) } catch { /* */ }
            jq(el).trigger('change').trigger('changeDate').trigger('dp.change')
          }

          // Also try native events
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('input', { bubbles: true }))

          return { ok: true, value: el.value, hasJquery: !!jq }
        }, fechaStr)

        if (d < 3) {
          console.log(`[iSalud] Day ${d}: setDate result=${JSON.stringify(setResult)}`)
        }

        await page.waitForTimeout(2000)
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

      if (d < 3 || (dayData && dayData.length > 0) || d % 10 === 0) {
        console.log(`[iSalud] Day ${d} (${fechaStr}): ${dayData?.length ?? 0} rows`)
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
