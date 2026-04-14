// ============================================================
// iSalud Adapter — Playwright headless (Vercel Pro, 250MB limit)
//
// Selectores de login (iSalud 24.02):
//   input[name="login[Usuario]"]
//   input[name="login[Clave]"]
//   Formulario de un solo paso
// ============================================================

import { chromium as playwrightChromium, type Browser, type Page } from 'playwright-core'

// --- Types ---

export interface ISaludCredentials {
  subdomain: string
  username: string
  password: string
}

export interface ISaludDisponibilidadSlot {
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  fecha: string
}

export interface ISaludProfesional {
  nombre: string
  puntos_atencion: string[]
  slots: ISaludDisponibilidadSlot[]
}

export interface ISaludAdmision {
  id: string
  identificacion: string
  nombre_paciente: string
  procedimiento: string
  aseguradora: string
  profesional_nombre: string
  ubicacion: string
  hora_inicial: string
  fase: string
  fecha: string
}

export interface ScrapeResult {
  profesionales: ISaludProfesional[]
  admisiones: ISaludAdmision[]
  errors: string[]
}

// --- Browser ---

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === 'development') {
    return playwrightChromium.launch({ headless: true })
  }
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
  console.log(`[iSalud] Login page: ${page.url()}`)

  await page.fill('input[name="login[Usuario]"]', credentials.username)
  await page.fill('input[name="login[Clave]"]', credentials.password)

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ])

  if (page.url().includes('/login')) {
    throw new Error('Login fallido — credenciales inválidas')
  }

  // Handle "Cambiar Centro de atención"
  const cambiarBtn = page.locator('button:has-text("Cambiar"), a:has-text("Cambiar")')
  if (await cambiarBtn.count() > 0) {
    console.log('[iSalud] Clicking "Cambiar Centro"')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      cambiarBtn.first().click(),
    ])
  }
  console.log(`[iSalud] Login OK: ${page.url()}`)
}

// --- Scrape profesionales ---

export async function scrapeProfesionales(page: Page, credentials: ISaludCredentials): Promise<ISaludProfesional[]> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'networkidle', timeout: 30000 })

  // Toggle "Cargar todo"
  const toggle = page.locator('text=Cargar todo').locator('..').locator('input, button, a, label')
  if (await toggle.count() > 0) {
    await toggle.first().click().catch(() => {})
    await page.waitForTimeout(2000)
  }
  await page.waitForTimeout(2000)

  // Max records
  try { await page.selectOption('.dataTables_length select', '-1') } catch {
    try { await page.selectOption('.dataTables_length select', '100') } catch {}
  }
  await page.waitForTimeout(1500)

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

  console.log(`[iSalud] ${profesionales.length} profesionales, ${profesionales.reduce((s, p) => s + p.slots.length, 0)} slots`)
  return profesionales
}

// --- Scrape admisiones ---

export async function scrapeAdmisiones(page: Page, credentials: ISaludCredentials, diasAdelante: number = 60): Promise<{ admisiones: ISaludAdmision[]; errors: string[] }> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  const all: ISaludAdmision[] = []
  const errors: string[] = []
  const today = new Date()

  await page.goto(`${baseUrl}/admision`, { waitUntil: 'networkidle', timeout: 30000 })

  for (let d = 0; d < diasAdelante; d++) {
    const date = new Date(today); date.setDate(date.getDate() + d)
    const fechaStr = date.toISOString().split('T')[0]
    try {
      const dateInput = page.locator('input[type="date"], input[name*="fecha"], input[name*="Fecha"]')
      if (await dateInput.count() > 0) { await dateInput.first().fill(fechaStr); await page.waitForTimeout(1500) }
      else if (d === 0) { await page.goto(`${baseUrl}/admision?fecha=${fechaStr}`, { waitUntil: 'networkidle', timeout: 15000 }); await page.waitForTimeout(1500) }

      if (d === 0) {
        try { await page.selectOption('.dataTables_length select', '-1') } catch { try { await page.selectOption('.dataTables_length select', '100') } catch {} }
        await page.waitForTimeout(1000)
      }

      const dayData = await page.evaluate((fecha) => {
        const r: Array<{ id: string; identificacion: string; nombre_paciente: string; procedimiento: string; aseguradora: string; profesional_nombre: string; ubicacion: string; hora_inicial: string; fase: string; fecha: string }> = []
        document.querySelectorAll('table tbody tr').forEach((row) => {
          const c = row.querySelectorAll('td'); if (c.length < 8) return
          const id = c[0]?.textContent?.trim() ?? '', prof = (c[5]?.textContent?.trim() ?? '').toUpperCase(), fase = c[8]?.textContent?.trim() ?? 'Programado'
          if (!id || !prof || (fase !== 'Programado' && fase !== 'Admitido')) return
          r.push({ id, identificacion: c[1]?.textContent?.trim() ?? '', nombre_paciente: c[2]?.textContent?.trim() ?? '', procedimiento: c[3]?.textContent?.trim() ?? '', aseguradora: c[4]?.textContent?.trim() ?? '', profesional_nombre: prof, ubicacion: c[6]?.textContent?.trim() ?? '', hora_inicial: (c[7]?.textContent?.trim() ?? '').replace(/:\d{2}$/, ''), fase, fecha })
        })
        return r
      }, fechaStr)

      if (dayData) all.push(...dayData)
      if (d % 10 === 0) console.log(`[iSalud] Admision ${d}/${diasAdelante}: ${all.length} total`)
    } catch (err) { errors.push(`${fechaStr}: ${err instanceof Error ? err.message : String(err)}`) }
  }
  console.log(`[iSalud] Admision complete: ${all.length} citas`)
  return { admisiones: all, errors }
}

// --- Main ---

export async function scrapeISalud(credentials: ISaludCredentials, options: { diasAdelante?: number } = {}): Promise<ScrapeResult> {
  const dias = options.diasAdelante ?? 60
  const errors: string[] = []
  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await loginPage(page, credentials)

    let profesionales: ISaludProfesional[] = []
    try { profesionales = await scrapeProfesionales(page, credentials) } catch (e) { errors.push(`Profesionales: ${e instanceof Error ? e.message : String(e)}`) }

    const admResult = await scrapeAdmisiones(page, credentials, dias)
    return { profesionales, admisiones: admResult.admisiones, errors: [...errors, ...admResult.errors] }
  } catch (err) {
    return { profesionales: [], admisiones: [], errors: [`Fatal: ${err instanceof Error ? err.message : String(err)}`] }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

export async function testISaludConnection(credentials: ISaludCredentials): Promise<{ ok: boolean; error?: string }> {
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
