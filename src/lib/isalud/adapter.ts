// ============================================================
// iSalud Adapter — Playwright headless (Vercel Pro)
// ============================================================

import { chromium as playwrightChromium, type Browser, type Page } from 'playwright-core'

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
  ubicacion: string; hora_inicial: string; fase: string; fecha: string
}

export interface ScrapeResult {
  profesionales: ISaludProfesional[]; admisiones: ISaludAdmision[]; errors: string[]
}

// --- Browser ---

async function launchBrowser(): Promise<Browser> {
  console.log(`[iSalud] Launching browser (NODE_ENV=${process.env.NODE_ENV})`)
  if (process.env.NODE_ENV === 'development') {
    return playwrightChromium.launch({ headless: true })
  }
  const chromiumPkg = await import('@sparticuz/chromium')
  const executablePath = await chromiumPkg.default.executablePath()
  console.log(`[iSalud] Chromium path: ${executablePath}`)
  return playwrightChromium.launch({ args: chromiumPkg.default.args, executablePath, headless: true })
}

// --- Login ---

async function loginPage(page: Page, credentials: ISaludCredentials): Promise<void> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  console.log(`[iSalud] Navigating to ${baseUrl}/login`)
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(`[iSalud] Login page loaded: ${page.url()}, title: "${await page.title()}"`)

  // Log all form inputs for debugging
  const inputs = await page.evaluate(() => {
    const result: string[] = []
    document.querySelectorAll('input').forEach((el) => {
      result.push(`${el.name || el.id || '(no-name)'}[${el.type}]`)
    })
    return result
  })
  console.log(`[iSalud] Login form inputs: ${inputs.join(', ')}`)

  // Try exact selectors first, fall back to alternatives
  const userField = await page.locator('input[name="login[Usuario]"]').count()
  const claveField = await page.locator('input[name="login[Clave]"]').count()
  console.log(`[iSalud] login[Usuario]: ${userField > 0 ? 'FOUND' : 'NOT FOUND'}, login[Clave]: ${claveField > 0 ? 'FOUND' : 'NOT FOUND'}`)

  if (userField > 0 && claveField > 0) {
    await page.fill('input[name="login[Usuario]"]', credentials.username)
    await page.fill('input[name="login[Clave]"]', credentials.password)
  } else {
    // Fallback: try common alternatives
    console.log('[iSalud] Trying fallback selectors...')
    const textInputs = page.locator('input[type="text"], input:not([type])')
    const passInputs = page.locator('input[type="password"]')
    console.log(`[iSalud] Text inputs: ${await textInputs.count()}, Password inputs: ${await passInputs.count()}`)

    if (await textInputs.count() > 0) await textInputs.first().fill(credentials.username)
    if (await passInputs.count() > 0) await passInputs.first().fill(credentials.password)
  }

  // Submit
  const submitBtn = page.locator('button[type="submit"], input[type="submit"]')
  console.log(`[iSalud] Submit buttons found: ${await submitBtn.count()}`)

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    submitBtn.first().click(),
  ])

  console.log(`[iSalud] Post-login URL: ${page.url()}, title: "${await page.title()}"`)

  if (page.url().includes('/login')) {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300))
    console.error(`[iSalud] Login FAILED. Page text: ${bodyText}`)
    throw new Error('Login fallido — credenciales inválidas')
  }

  // Handle "Cambiar Centro de atención"
  const cambiarBtn = page.locator('button:has-text("Cambiar"), a:has-text("Cambiar")')
  const cambiarCount = await cambiarBtn.count()
  console.log(`[iSalud] "Cambiar" buttons: ${cambiarCount}`)
  if (cambiarCount > 0) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      cambiarBtn.first().click(),
    ])
    console.log(`[iSalud] After Cambiar: ${page.url()}`)
  }
  console.log(`[iSalud] Login complete: ${page.url()}`)
}

// --- Scrape profesionales ---

export async function scrapeProfesionales(page: Page, credentials: ISaludCredentials): Promise<ISaludProfesional[]> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  console.log(`[iSalud] Navigating to /disponibilidad`)
  await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'networkidle', timeout: 30000 })
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

  console.log(`[iSalud] Navigating to /admision`)
  await page.goto(`${baseUrl}/admision`, { waitUntil: 'networkidle', timeout: 30000 })
  console.log(`[iSalud] Admision URL: ${page.url()}, title: "${await page.title()}"`)

  // Log initial page structure
  const admInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table')
    const rows = document.querySelectorAll('table tbody tr')
    const dateInputs = document.querySelectorAll('input[type="date"]')
    const allInputs: string[] = []
    document.querySelectorAll('input').forEach((el) => { allInputs.push(`${el.name || el.id || '(anon)'}[${el.type}]`) })
    return { tables: tables.length, rows: rows.length, dateInputs: dateInputs.length, allInputs }
  })
  console.log(`[iSalud] Admision page: ${admInfo.tables} tables, ${admInfo.rows} rows, ${admInfo.dateInputs} date inputs`)
  console.log(`[iSalud] Admision inputs: ${admInfo.allInputs.join(', ')}`)

  for (let d = 0; d < diasAdelante; d++) {
    const date = new Date(today); date.setDate(date.getDate() + d)
    const fechaStr = date.toISOString().split('T')[0]
    try {
      const dateInput = page.locator('input[type="date"], input[name*="fecha"], input[name*="Fecha"]')
      const dateCount = await dateInput.count()

      if (dateCount > 0) {
        await dateInput.first().fill(fechaStr)
        await page.waitForTimeout(1500)
      } else if (d === 0) {
        console.log(`[iSalud] No date input found — trying URL param`)
        await page.goto(`${baseUrl}/admision?fecha=${fechaStr}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(1500)
      }

      if (d === 0) {
        try { await page.selectOption('.dataTables_length select', '-1') } catch {
          try { await page.selectOption('.dataTables_length select', '100') } catch {}
        }
        await page.waitForTimeout(1000)

        // Log what we see for first day
        const firstDayInfo = await page.evaluate(() => {
          const rows = document.querySelectorAll('table tbody tr')
          const headers: string[] = []
          document.querySelectorAll('table thead th').forEach((th) => { headers.push(th.textContent?.trim() ?? '') })
          const sample: string[][] = []
          for (let i = 0; i < Math.min(2, rows.length); i++) {
            const cells: string[] = []
            rows[i].querySelectorAll('td').forEach((td) => { cells.push(td.textContent?.trim()?.slice(0, 25) ?? '') })
            sample.push(cells)
          }
          return { headers, rowCount: rows.length, sample }
        })
        console.log(`[iSalud] Admision ${fechaStr}: ${firstDayInfo.rowCount} rows`)
        console.log(`[iSalud] Admision headers: [${firstDayInfo.headers.join(' | ')}]`)
        firstDayInfo.sample.forEach((row, i) => console.log(`[iSalud] Admision row ${i}: [${row.join(' | ')}]`))
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

      if (d === 0 || d % 10 === 0) {
        console.log(`[iSalud] Admision day ${d} (${fechaStr}): ${dayData?.length ?? 0} citas, total: ${all.length}`)
      }
    } catch (err) {
      const errMsg = `${fechaStr}: ${err instanceof Error ? err.message : String(err)}`
      errors.push(errMsg)
      if (d < 3) console.error(`[iSalud] Error: ${errMsg}`)
    }
  }
  console.log(`[iSalud] Admision COMPLETE: ${all.length} citas in ${diasAdelante} days, ${errors.length} errors`)
  return { admisiones: all, errors }
}

// --- Main ---

export async function scrapeISalud(credentials: ISaludCredentials, options: { diasAdelante?: number } = {}): Promise<ScrapeResult> {
  const dias = options.diasAdelante ?? 60
  const errors: string[] = []
  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    console.log('[iSalud] Browser launched')
    const page = await browser.newPage()
    await loginPage(page, credentials)
    let profesionales: ISaludProfesional[] = []
    try { profesionales = await scrapeProfesionales(page, credentials) } catch (e) { errors.push(`Profesionales: ${e instanceof Error ? e.message : String(e)}`); console.error(`[iSalud] Profesionales error: ${e}`) }
    const admResult = await scrapeAdmisiones(page, credentials, dias)
    console.log(`[iSalud] FINAL: ${profesionales.length} profs, ${admResult.admisiones.length} admisiones, ${errors.length + admResult.errors.length} errors`)
    return { profesionales, admisiones: admResult.admisiones, errors: [...errors, ...admResult.errors] }
  } catch (err) {
    console.error(`[iSalud] FATAL: ${err}`)
    return { profesionales: [], admisiones: [], errors: [`Fatal: ${err instanceof Error ? err.message : String(err)}`] }
  } finally {
    if (browser) await browser.close().catch(() => {})
    console.log('[iSalud] Browser closed')
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
