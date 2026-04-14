// ============================================================
// iSalud Adapter — HTTP + cheerio scraping
//
// Diseñado para ser reemplazable: si iSalud provee API oficial
// o si se necesita Playwright, solo se cambia este archivo.
// Todo el resto del sistema (sync-agent, API route, UI) permanece igual.
//
// iSalud 24.02 es una app PHP clásica con server-rendered HTML.
// Login es 2 pasos: email → "Siguiente" → password → submit.
// ============================================================

import * as cheerio from 'cheerio'

// --- Types ---

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
  slots: ISaludDisponibilidadSlot[]  // Raw schedule slots from /disponibilidad
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
  fase: string                // "Programado" | "Admitido" etc.
  fecha: string               // "YYYY-MM-DD"
}

export interface ScrapeResult {
  profesionales: ISaludProfesional[]
  admisiones: ISaludAdmision[]
  errors: string[]
}

// --- Session management ---

interface SessionCookies {
  raw: string  // Cookie header value
}

async function login(credentials: ISaludCredentials): Promise<SessionCookies> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`

  // Step 1: GET login page to get CSRF token / initial cookies
  const loginPageRes = await fetch(`${baseUrl}/login`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })

  const initialCookies = extractSetCookies(loginPageRes)
  const loginPageHtml = await loginPageRes.text()
  console.log(`[iSalud Login] GET /login → status ${loginPageRes.status}, HTML ${loginPageHtml.length} chars, cookies: ${initialCookies.slice(0, 80)}...`)

  // Extract CSRF token from the login page
  const $login = cheerio.load(loginPageHtml)
  const csrfToken = $login('input[name="_token"]').attr('value') ?? ''

  // Detect the correct field name for the username input
  const userFieldName = $login('input[type="text"][name]').attr('name')
    ?? $login('input[name="user"]').length > 0 ? 'user'
    : $login('input[name="usuario"]').length > 0 ? 'usuario'
    : $login('input[name="login"]').length > 0 ? 'login'
    : $login('input[name="email"]').length > 0 ? 'email'
    : 'user'

  console.log(`[iSalud Login] CSRF token: ${csrfToken ? csrfToken.slice(0, 10) + '...' : 'NOT FOUND'}, user field: "${userFieldName}"`)

  // Log all input fields found on the login page for debugging
  const inputFields: string[] = []
  $login('input').each((_, el) => {
    const name = $login(el).attr('name') ?? ''
    const type = $login(el).attr('type') ?? ''
    if (name) { inputFields.push(`${name}(${type})`) }
  })
  console.log(`[iSalud Login] Form fields found: ${inputFields.join(', ')}`)

  // Step 2: POST login
  const postBody: Record<string, string> = {
    _token: csrfToken,
    password: credentials.password,
  }
  postBody[userFieldName] = credentials.username

  const loginRes = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': initialCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: new URLSearchParams(postBody).toString(),
  })

  const sessionCookies = mergeSetCookies(initialCookies, loginRes)
  const location = loginRes.headers.get('location') ?? ''
  console.log(`[iSalud Login] POST /login → status ${loginRes.status}, redirect: "${location}", new cookies: ${extractSetCookies(loginRes).slice(0, 80)}`)

  // Verify login succeeded by checking redirect
  if (location.includes('/login') || loginRes.status === 422) {
    const errorBody = await loginRes.text().catch(() => '')
    console.error(`[iSalud Login] FAILED — status ${loginRes.status}, body preview: ${errorBody.slice(0, 300)}`)
    throw new Error(`Login fallido — status ${loginRes.status}, redirect: ${location}`)
  }

  // Follow redirect (may be home page or "cambiar centro de atención")
  const redirectUrl = location.startsWith('http') ? location : `${baseUrl}${location}`
  console.log(`[iSalud Login] Following redirect to: ${redirectUrl}`)

  const homeRes = await fetch(redirectUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'Cookie': sessionCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })

  const finalCookies = mergeSetCookies(sessionCookies, homeRes)
  const homeHtml = await homeRes.text()
  console.log(`[iSalud Login] Home page → status ${homeRes.status}, HTML ${homeHtml.length} chars`)

  // Check if we landed on "Cambiar Centro de atención" page
  if (homeHtml.includes('Cambiar') && homeHtml.includes('Centro')) {
    console.log(`[iSalud Login] Detected "Cambiar Centro" page — navigating past it`)
    // Try to follow the redirect or click through — usually just navigating to /disponibilidad works
    const homeRedirect = homeRes.headers.get('location')
    if (homeRedirect) {
      const r2 = await fetch(homeRedirect.startsWith('http') ? homeRedirect : `${baseUrl}${homeRedirect}`, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'Cookie': finalCookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      return { raw: mergeSetCookies(finalCookies, r2) }
    }
  }

  console.log(`[iSalud Login] Login complete. Cookie count: ${finalCookies.split(';').length}`)
  return { raw: finalCookies }
}

// --- Scraping functions ---

export async function scrapeProfesionales(
  credentials: ISaludCredentials,
  session: SessionCookies
): Promise<ISaludProfesional[]> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`

  const res = await fetch(`${baseUrl}/disponibilidad`, {
    headers: {
      'Cookie': session.raw,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })

  const html = await res.text()
  const $ = cheerio.load(html)

  console.log(`[iSalud Disponibilidad] HTML length: ${html.length}, tables: ${$('table').length}, tbody rows: ${$('table tbody tr').length}`)

  // Log table headers to understand column structure
  const headers: string[] = []
  $('table thead th, table thead td').each((_, el) => { headers.push($(el).text().trim()) })
  console.log(`[iSalud Disponibilidad] Table headers: ${headers.join(' | ') || 'NONE FOUND'}`)

  // Check if page is a redirect or "Cambiar Centro" blocker
  if (html.includes('/login') && html.length < 1000) {
    console.error(`[iSalud Disponibilidad] Appears to be a login redirect — session may have expired`)
  }

  // Extract professionals + schedule slots from the availability table
  const profMap = new Map<string, { puntos: Set<string>; slots: ISaludDisponibilidadSlot[] }>()

  $('table tbody tr').each((i, row) => {
    const cells = $(row).find('td')
    if (cells.length < 3) return

    // Log first 3 rows for debugging
    if (i < 3) {
      const cellTexts = Array.from({ length: Math.min(cells.length, 8) }, (_, j) => $(cells[j]).text().trim())
      console.log(`[iSalud Disponibilidad] Row ${i}: [${cellTexts.join(' | ')}] (${cells.length} cols)`)
    }

    // Extract data from row — adapt column indices based on iSalud structure
    const profesional = $(cells[0]).text().trim().toUpperCase()
    const punto = cells.length > 1 ? $(cells[1]).text().trim() : ''
    const fechaRaw = cells.length > 2 ? $(cells[2]).text().trim() : ''
    const horaInicio = cells.length > 3 ? $(cells[3]).text().trim().replace(/:\d{2}$/, '') : ''
    const horaFin = cells.length > 4 ? $(cells[4]).text().trim().replace(/:\d{2}$/, '') : ''

    if (!profesional || profesional.length < 3) return

    if (!profMap.has(profesional)) {
      profMap.set(profesional, { puntos: new Set(), slots: [] })
    }
    const entry = profMap.get(profesional)!
    if (punto) entry.puntos.add(punto)

    // Parse fecha to get day of week
    if (fechaRaw && horaInicio) {
      // Try YYYY-MM-DD or DD/MM/YYYY
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

      if (diaSemana >= 0) {
        entry.slots.push({
          dia_semana: diaSemana,
          hora_inicio: horaInicio,
          hora_fin: horaFin || addMinutesToTime(horaInicio, 30),
          fecha,
        })
      }
    }
  })

  // Also try select options as fallback for professional names
  $('select option').each((_, opt) => {
    const name = $(opt).text().trim().toUpperCase()
    if (name && name.length > 3 && name !== 'TODOS' && name !== 'SELECCIONE') {
      if (!profMap.has(name)) {
        profMap.set(name, { puntos: new Set(), slots: [] })
      }
    }
  })

  return Array.from(profMap.entries()).map(([nombre, data]) => ({
    nombre,
    puntos_atencion: Array.from(data.puntos),
    slots: data.slots,
  }))
}

export async function scrapeAdmisiones(
  credentials: ISaludCredentials,
  session: SessionCookies,
  diasAdelante: number = 60
): Promise<{ admisiones: ISaludAdmision[]; errors: string[] }> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  const allAdmisiones: ISaludAdmision[] = []
  const errors: string[] = []
  const today = new Date()

  for (let d = 0; d < diasAdelante; d++) {
    const date = new Date(today)
    date.setDate(date.getDate() + d)
    const fechaStr = date.toISOString().split('T')[0] // YYYY-MM-DD

    try {
      // Try query param approach first
      const res = await fetch(`${baseUrl}/admision?fecha=${fechaStr}`, {
        headers: {
          'Cookie': session.raw,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })

      const html = await res.text()
      const $ = cheerio.load(html)

      if (d === 0) {
        // Log details for first day only
        console.log(`[iSalud Admision] ${fechaStr}: HTML ${html.length} chars, tables: ${$('table').length}, tbody rows: ${$('table tbody tr').length}`)
        const headers: string[] = []
        $('table thead th, table thead td').each((_, el) => { headers.push($(el).text().trim()) })
        console.log(`[iSalud Admision] Headers: ${headers.join(' | ') || 'NONE'}`)
        if ($('table tbody tr').length > 0) {
          const firstCells: string[] = []
          $('table tbody tr').first().find('td').each((_, el) => { firstCells.push($(el).text().trim()) })
          console.log(`[iSalud Admision] First row: [${firstCells.join(' | ')}]`)
        }
      }

      // Parse DataTables table
      $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td')
        if (cells.length < 8) return

        const id = $(cells[0]).text().trim()
        const identificacion = $(cells[1]).text().trim()
        const nombre = $(cells[2]).text().trim()
        const procedimiento = $(cells[3]).text().trim()
        const aseguradora = $(cells[4]).text().trim()
        const profesional = $(cells[5]).text().trim().toUpperCase()
        const ubicacion = $(cells[6]).text().trim()
        const horaRaw = $(cells[7]).text().trim()
        const fase = cells.length > 8 ? $(cells[8]).text().trim() : 'Programado'

        if (!id || !profesional) return

        // Normalize hora: "13:00:00" → "13:00"
        const hora = horaRaw.replace(/:\d{2}$/, '')

        allAdmisiones.push({
          id,
          identificacion,
          nombre_paciente: nombre,
          procedimiento,
          aseguradora,
          profesional_nombre: profesional,
          ubicacion,
          hora_inicial: hora,
          fase,
          fecha: fechaStr,
        })
      })
    } catch (err) {
      errors.push(`Error scraping ${fechaStr}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Rate limiting — don't hammer iSalud
    if (d > 0 && d % 10 === 0) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  return { admisiones: allAdmisiones, errors }
}

// --- Main entry point ---

export async function scrapeISalud(
  credentials: ISaludCredentials,
  options: { diasAdelante?: number } = {}
): Promise<ScrapeResult> {
  const diasAdelante = options.diasAdelante ?? 60
  const errors: string[] = []

  // 1. Login
  let session: SessionCookies
  try {
    session = await login(credentials)
  } catch (err) {
    return {
      profesionales: [],
      admisiones: [],
      errors: [`Login failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  // 2. Scrape profesionales
  let profesionales: ISaludProfesional[] = []
  try {
    profesionales = await scrapeProfesionales(credentials, session)
  } catch (err) {
    errors.push(`Error scraping profesionales: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Scrape admisiones
  const admisionResult = await scrapeAdmisiones(credentials, session, diasAdelante)

  return {
    profesionales,
    admisiones: admisionResult.admisiones,
    errors: [...errors, ...admisionResult.errors],
  }
}

// --- Test connection ---

export async function testISaludConnection(credentials: ISaludCredentials): Promise<{
  ok: boolean
  error?: string
}> {
  try {
    await login(credentials)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de conexión' }
  }
}

// --- Diagnostic function ---

export async function diagnoseISalud(credentials: ISaludCredentials): Promise<{
  login: { ok: boolean; error?: string; cookies_count: number; redirect_location: string }
  disponibilidad: { html_length: number; html_preview: string; has_table: boolean; tbody_rows: number; profesionales: ISaludProfesional[] }
  admision_hoy: { html_length: number; html_preview: string; has_table: boolean; tbody_rows: number; admisiones: ISaludAdmision[] }
  errors: string[]
}> {
  const baseUrl = `https://${credentials.subdomain}.isalud.co`
  const errors: string[] = []
  const result = {
    login: { ok: false, cookies_count: 0, redirect_location: '', error: undefined as string | undefined },
    disponibilidad: { html_length: 0, html_preview: '', has_table: false, tbody_rows: 0, profesionales: [] as ISaludProfesional[] },
    admision_hoy: { html_length: 0, html_preview: '', has_table: false, tbody_rows: 0, admisiones: [] as ISaludAdmision[] },
    errors,
  }

  // 1. Login
  let session: SessionCookies
  try {
    session = await login(credentials)
    result.login.ok = true
    result.login.cookies_count = session.raw.split(';').length
  } catch (err) {
    result.login.error = err instanceof Error ? err.message : String(err)
    errors.push(`Login: ${result.login.error}`)
    return result
  }

  // 2. Disponibilidad
  try {
    const res = await fetch(`${baseUrl}/disponibilidad`, {
      headers: { 'Cookie': session.raw, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    const html = await res.text()
    result.disponibilidad.html_length = html.length
    result.disponibilidad.html_preview = html.slice(0, 2000)
    const $ = cheerio.load(html)
    result.disponibilidad.has_table = $('table').length > 0
    result.disponibilidad.tbody_rows = $('table tbody tr').length

    // Try parsing
    try {
      result.disponibilidad.profesionales = await scrapeProfesionales(credentials, session)
    } catch (e) {
      errors.push(`Parsing profesionales: ${e instanceof Error ? e.message : String(e)}`)
    }
  } catch (err) {
    errors.push(`GET /disponibilidad: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Admisión hoy
  try {
    const hoy = new Date().toISOString().split('T')[0]
    const res = await fetch(`${baseUrl}/admision?fecha=${hoy}`, {
      headers: { 'Cookie': session.raw, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    const html = await res.text()
    result.admision_hoy.html_length = html.length
    result.admision_hoy.html_preview = html.slice(0, 2000)
    const $ = cheerio.load(html)
    result.admision_hoy.has_table = $('table').length > 0
    result.admision_hoy.tbody_rows = $('table tbody tr').length

    // Try parsing
    try {
      const admResult = await scrapeAdmisiones(credentials, session, 1)
      result.admision_hoy.admisiones = admResult.admisiones
    } catch (e) {
      errors.push(`Parsing admisiones: ${e instanceof Error ? e.message : String(e)}`)
    }
  } catch (err) {
    errors.push(`GET /admision: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

// --- Time helpers ---

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// --- Cookie helpers ---

function extractSetCookies(res: Response): string {
  const cookies: string[] = []
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const name = value.split(';')[0]
      if (name) cookies.push(name)
    }
  })
  return cookies.join('; ')
}

function mergeSetCookies(existing: string, res: Response): string {
  const newCookies = extractSetCookies(res)
  if (!newCookies) return existing
  if (!existing) return newCookies

  const map = new Map<string, string>()
  for (const pair of existing.split('; ')) {
    const [key] = pair.split('=')
    if (key) map.set(key, pair)
  }
  for (const pair of newCookies.split('; ')) {
    const [key] = pair.split('=')
    if (key) map.set(key, pair)
  }
  return Array.from(map.values()).join('; ')
}
