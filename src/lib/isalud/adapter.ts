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

export interface ISaludProfesional {
  nombre: string  // UPPERCASE, trimmed
  puntos_atencion: string[]
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

  // Extract CSRF token from the login page
  const $login = cheerio.load(loginPageHtml)
  const csrfToken = $login('input[name="_token"]').attr('value') ?? ''

  // Step 2: POST login with email + password
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': initialCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: new URLSearchParams({
      _token: csrfToken,
      user: credentials.username,
      password: credentials.password,
    }).toString(),
  })

  const sessionCookies = mergeSetCookies(initialCookies, loginRes)

  // Verify login succeeded by checking redirect
  const location = loginRes.headers.get('location') ?? ''
  if (location.includes('/login') || loginRes.status === 422) {
    throw new Error('Login fallido — credenciales inválidas o formato de login inesperado')
  }

  // Follow redirect to get final session cookies
  const homeRes = await fetch(location.startsWith('http') ? location : `${baseUrl}${location}`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'Cookie': sessionCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })

  return { raw: mergeSetCookies(sessionCookies, homeRes) }
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

  // Extract professionals from the availability table
  const profMap = new Map<string, Set<string>>()

  // Try table rows — iSalud availability table has "Profesional" column
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length < 3) return

    // Try to find professional name and location columns
    // iSalud tables vary — try common patterns
    const profesional = $(cells[0]).text().trim().toUpperCase()
    const punto = cells.length > 1 ? $(cells[1]).text().trim() : ''

    if (profesional && profesional.length > 2) {
      if (!profMap.has(profesional)) profMap.set(profesional, new Set())
      if (punto) profMap.get(profesional)!.add(punto)
    }
  })

  // Also try select options — some iSalud pages have a professional dropdown
  $('select option').each((_, opt) => {
    const name = $(opt).text().trim().toUpperCase()
    if (name && name.length > 3 && name !== 'TODOS' && name !== 'SELECCIONE') {
      if (!profMap.has(name)) profMap.set(name, new Set())
    }
  })

  return Array.from(profMap.entries()).map(([nombre, puntos]) => ({
    nombre,
    puntos_atencion: Array.from(puntos),
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
