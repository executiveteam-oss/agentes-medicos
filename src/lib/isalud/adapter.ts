// ============================================================
// iSalud Adapter — Playwright headless
//
// Reemplaza cheerio porque iSalud usa DataTables con carga AJAX.
// El tbody está vacío en el HTML server-rendered.
//
// Selectores de login confirmados inspeccionando el DOM:
//   input[name="login[Usuario]"]
//   input[name="login[Clave]"]
//   input[name="login[_csrf_token]"]
//
// Diseñado como adapter reemplazable — si iSalud provee API oficial,
// solo se cambia este archivo sin tocar sync-agent ni UI.
// ============================================================

import { chromium as playwrightChromium, type Browser, type Page } from 'playwright-core'

// --- Types (exported — used by sync-agent) ---

export interface ISaludCredentials {
  subdomain: string
  username: string
  password: string
}

export interface ISaludDisponibilidadSlot {
  dia_semana: number  // 0=dom, 1=lun, ..., 6=sab
  hora_inicio: string // "HH:MM"
  hora_fin: string    // "HH:MM"
  fecha: string       // "YYYY-MM-DD"
}

export interface ISaludProfesional {
  nombre: string  // UPPERCASE, trimmed
  puntos_atencion: string[]
  slots: ISaludDisponibilidadSlot[]
}

export interface ISaludAdmision {
  id: string
  identificacion: string
  nombre_paciente: string
  procedimiento: string
  aseguradora: string
  profesional_nombre: string  // UPPERCASE, trimmed
  ubicacion: string
  hora_inicial: string        // "HH:MM"
  fase: string                // "Programado" | "Admitido"
  fecha: string               // "YYYY-MM-DD"
}

export interface ScrapeResult {
  profesionales: ISaludProfesional[]
  admisiones: ISaludAdmision[]
  errors: string[]
}

// --- Browser factory ---

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === 'development') {
    // Local dev: use system chromium via playwright
    return playwrightChromium.launch({ headless: true })
  }

  // Vercel serverless: use @sparticuz/chromium
  const chromiumPkg = await import('@sparticuz/chromium')
  const executablePath = await chromiumPkg.default.executablePath()

  return playwrightChromium.launch({
    args: chromiumPkg.default.args,
    executablePath,
    headless: true,
  })
}

// --- Login ---

async function loginPage(page: Page, credentials: ISaludCredentials): Promise<void> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`

  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(`[iSalud] Login page loaded: ${page.url()}`)

  // Fill credentials using exact iSalud selectors
  await page.fill('input[name="login[Usuario]"]', credentials.username)
  await page.fill('input[name="login[Clave]"]', credentials.password)

  // Submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ])

  console.log(`[iSalud] Post-login URL: ${page.url()}`)

  // Check if we're still on login (failed)
  if (page.url().includes('/login')) {
    throw new Error('Login fallido — credenciales inválidas')
  }

  // Handle "Cambiar Centro de atención" screen
  const cambiarBtn = page.locator('button:has-text("Cambiar"), a:has-text("Cambiar")')
  if (await cambiarBtn.count() > 0) {
    console.log(`[iSalud] Detected "Cambiar Centro" — clicking through`)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      cambiarBtn.first().click(),
    ])
  }

  console.log(`[iSalud] Login complete: ${page.url()}`)
}

// --- Scrape profesionales ---

export async function scrapeProfesionales(
  page: Page,
  credentials: ISaludCredentials
): Promise<ISaludProfesional[]> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`

  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(`[iSalud Disponibilidad] Page loaded: ${page.url()}`)

  // Activate "Cargar todo: Sí" toggle if present
  const cargarTodo = page.locator('text=Cargar todo').locator('..').locator('input, button, a, label')
  if (await cargarTodo.count() > 0) {
    await cargarTodo.first().click().catch(() => {})
    await page.waitForTimeout(2000)
    console.log(`[iSalud Disponibilidad] "Cargar todo" toggled`)
  }

  // Wait for DataTables to load
  await page.waitForTimeout(2000)

  // Maximize DataTables page length
  try {
    await page.selectOption('.dataTables_length select', '-1')
  } catch {
    try { await page.selectOption('.dataTables_length select', '100') } catch { /* ignore */ }
  }
  await page.waitForTimeout(1500)

  // Extract data from the loaded table
  const profesionales = await page.evaluate(() => {
    const profMap: Record<string, { puntos: Set<string>; slots: Array<{ dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string }> }> = {}

    const rows = document.querySelectorAll('table tbody tr')
    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      if (cells.length < 6) continue

      // Try to identify columns by header text or index
      // Common iSalud /disponibilidad columns:
      // ID | Fecha | Hora inicial | Hora final | Duración | Profesional | Punto de atención
      const profesional = (cells[5]?.textContent?.trim() ?? '').toUpperCase()
      const punto = cells[6]?.textContent?.trim() ?? ''
      const fechaRaw = cells[1]?.textContent?.trim() ?? ''
      const horaInicio = (cells[2]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')
      const horaFin = (cells[3]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')

      if (!profesional || profesional.length < 3) continue

      if (!profMap[profesional]) {
        profMap[profesional] = { puntos: new Set<string>(), slots: [] }
      }
      if (punto) profMap[profesional].puntos.add(punto)

      // Parse fecha
      let fecha = ''
      let diaSemana = -1
      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
        fecha = fechaRaw
        diaSemana = new Date(fechaRaw + 'T12:00:00').getDay()
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw)) {
        const [dd, mm, yyyy] = fechaRaw.split('/')
        fecha = `${yyyy}-${mm}-${dd}`
        diaSemana = new Date(fecha + 'T12:00:00').getDay()
      }

      if (diaSemana >= 0 && horaInicio) {
        profMap[profesional].slots.push({
          dia_semana: diaSemana,
          hora_inicio: horaInicio,
          hora_fin: horaFin || horaInicio,
          fecha,
        })
      }
    }

    // Convert to serializable format (Sets → arrays)
    return Object.entries(profMap).map(([nombre, data]) => ({
      nombre,
      puntos_atencion: Array.from(data.puntos),
      slots: data.slots,
    }))
  })

  console.log(`[iSalud Disponibilidad] Extracted ${profesionales.length} profesionales, ${profesionales.reduce((s, p) => s + p.slots.length, 0)} slots total`)

  return profesionales
}

// --- Scrape admisiones ---

export async function scrapeAdmisiones(
  page: Page,
  credentials: ISaludCredentials,
  diasAdelante: number = 60
): Promise<{ admisiones: ISaludAdmision[]; errors: string[] }> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  const allAdmisiones: ISaludAdmision[] = []
  const errors: string[] = []
  const today = new Date()

  await page.goto(`${baseUrl}/admision`, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(`[iSalud Admision] Page loaded: ${page.url()}`)

  for (let d = 0; d < diasAdelante; d++) {
    const date = new Date(today)
    date.setDate(date.getDate() + d)
    const fechaStr = date.toISOString().split('T')[0]

    try {
      // Set date in the date input
      const dateInput = page.locator('input[type="date"], input[name*="fecha"], input[name*="Fecha"]')
      if (await dateInput.count() > 0) {
        await dateInput.first().fill(fechaStr)
        await page.waitForTimeout(1500)
      } else if (d === 0) {
        console.warn(`[iSalud Admision] No date input found — trying URL param`)
        await page.goto(`${baseUrl}/admision?fecha=${fechaStr}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(1500)
      }

      // Maximize DataTables page length (first iteration only)
      if (d === 0) {
        try { await page.selectOption('.dataTables_length select', '-1') } catch {
          try { await page.selectOption('.dataTables_length select', '100') } catch { /* ignore */ }
        }
        await page.waitForTimeout(1000)
      }

      // Extract rows
      const dayAdmisiones = await page.evaluate((fecha) => {
        const results: Array<{
          id: string; identificacion: string; nombre_paciente: string
          procedimiento: string; aseguradora: string; profesional_nombre: string
          ubicacion: string; hora_inicial: string; fase: string; fecha: string
        }> = []

        const rows = document.querySelectorAll('table tbody tr')
        for (const row of rows) {
          const cells = row.querySelectorAll('td')
          if (cells.length < 8) continue

          const id = cells[0]?.textContent?.trim() ?? ''
          const identificacion = cells[1]?.textContent?.trim() ?? ''
          const nombre = cells[2]?.textContent?.trim() ?? ''
          const procedimiento = cells[3]?.textContent?.trim() ?? ''
          const aseguradora = cells[4]?.textContent?.trim() ?? ''
          const profesional = (cells[5]?.textContent?.trim() ?? '').toUpperCase()
          const ubicacion = cells[6]?.textContent?.trim() ?? ''
          const horaRaw = cells[7]?.textContent?.trim() ?? ''
          const fase = cells[8]?.textContent?.trim() ?? 'Programado'

          if (!id || !profesional) return

          // Only include active appointments
          if (fase !== 'Programado' && fase !== 'Admitido') return

          results.push({
            id,
            identificacion,
            nombre_paciente: nombre,
            procedimiento,
            aseguradora,
            profesional_nombre: profesional,
            ubicacion,
            hora_inicial: horaRaw.replace(/:\d{2}$/, ''),
            fase,
            fecha,
          })
        }
        return results
      }, fechaStr)

      if (dayAdmisiones) allAdmisiones.push(...dayAdmisiones)

      if (d === 0) {
        console.log(`[iSalud Admision] ${fechaStr}: ${dayAdmisiones?.length ?? 0} citas encontradas`)
      }
    } catch (err) {
      errors.push(`${fechaStr}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Brief pause between days
    if (d > 0 && d % 10 === 0) {
      await page.waitForTimeout(500)
      console.log(`[iSalud Admision] Progress: ${d}/${diasAdelante} días, ${allAdmisiones.length} citas total`)
    }
  }

  console.log(`[iSalud Admision] Complete: ${allAdmisiones.length} citas en ${diasAdelante} días`)
  return { admisiones: allAdmisiones, errors }
}

// --- Main entry point ---

export async function scrapeISalud(
  credentials: ISaludCredentials,
  options: { diasAdelante?: number } = {}
): Promise<ScrapeResult> {
  const diasAdelante = options.diasAdelante ?? 60
  const errors: string[] = []

  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()

    // 1. Login
    await loginPage(page, credentials)

    // 2. Scrape profesionales
    let profesionales: ISaludProfesional[] = []
    try {
      profesionales = await scrapeProfesionales(page, credentials)
    } catch (err) {
      errors.push(`Profesionales: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 3. Scrape admisiones
    const admisionResult = await scrapeAdmisiones(page, credentials, diasAdelante)

    return {
      profesionales,
      admisiones: admisionResult.admisiones,
      errors: [...errors, ...admisionResult.errors],
    }
  } catch (err) {
    return {
      profesionales: [],
      admisiones: [],
      errors: [`Fatal: ${err instanceof Error ? err.message : String(err)}`],
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// --- Test connection ---

export async function testISaludConnection(credentials: ISaludCredentials): Promise<{
  ok: boolean
  error?: string
}> {
  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await loginPage(page, credentials)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de conexión' }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// --- Diagnostic ---

export async function diagnoseISalud(credentials: ISaludCredentials): Promise<Record<string, unknown>> {
  const errors: string[] = []
  const diag: Record<string, unknown> = { errors }

  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()

    // 1. Login
    try {
      await loginPage(page, credentials)
      diag.login = { ok: true, url: page.url() }
    } catch (err) {
      diag.login = { ok: false, error: err instanceof Error ? err.message : String(err) }
      return diag
    }

    // 2. Disponibilidad
    try {
      const baseUrl = `https://${credentials.subdomain}.isalud.co`
      await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(2000)

      const dispInfo = await page.evaluate(() => {
        const tables = document.querySelectorAll('table')
        const rows = document.querySelectorAll('table tbody tr')
        const headers: string[] = []
        document.querySelectorAll('table thead th').forEach((th) => { headers.push(th.textContent?.trim() ?? '') })

        const firstRows: string[][] = []
        for (let i = 0; i < Math.min(3, rows.length); i++) {
          const cells: string[] = []
          rows[i].querySelectorAll('td').forEach((td) => { cells.push(td.textContent?.trim() ?? '') })
          firstRows.push(cells)
        }

        return {
          url: window.location.href,
          title: document.title,
          tables_count: tables.length,
          tbody_rows: rows.length,
          headers,
          first_rows: firstRows,
          body_text_preview: document.body.innerText.slice(0, 500),
        }
      })
      diag.disponibilidad = dispInfo

      // Try scraping
      try {
        const profs = await scrapeProfesionales(page, credentials)
        diag.profesionales_parsed = profs
      } catch (e) {
        errors.push(`Parsing profesionales: ${e instanceof Error ? e.message : String(e)}`)
      }
    } catch (err) {
      errors.push(`Disponibilidad: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 3. Admision today
    try {
      const admResult = await scrapeAdmisiones(page, credentials, 1)
      diag.admision_hoy = { count: admResult.admisiones.length, admisiones: admResult.admisiones, errors: admResult.errors }
    } catch (err) {
      errors.push(`Admision: ${err instanceof Error ? err.message : String(err)}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  return diag
}
