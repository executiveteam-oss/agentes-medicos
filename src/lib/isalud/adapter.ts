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

  // Extract professionals + schedule slots from the availability table
  // /disponibilidad table typically has: Profesional | Punto de atención | Fecha | Hora inicio | Hora fin | ...
  const profMap = new Map<string, { puntos: Set<string>; slots: ISaludDisponibilidadSlot[] }>()

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length < 3) return

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
