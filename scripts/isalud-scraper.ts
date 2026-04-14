// ============================================================
// iSalud Scraper — Standalone script for GitHub Actions
//
// Runs with full Playwright (not playwright-core) — no size limits.
// Scrapes /disponibilidad and /admision, then POSTs results to
// Omuwan's /api/sync/isalud/ingest endpoint.
//
// Environment variables:
//   ISALUD_SUBDOMAIN, ISALUD_USERNAME, ISALUD_PASSWORD
//   OMUWAN_API_URL, SYNC_SECRET, CLINIC_ID
// ============================================================

import { chromium } from 'playwright'

const SUBDOMAIN = process.env.ISALUD_SUBDOMAIN!
const USERNAME = process.env.ISALUD_USERNAME!
const PASSWORD = process.env.ISALUD_PASSWORD!
const API_URL = process.env.OMUWAN_API_URL!
const SECRET = process.env.SYNC_SECRET!
const CLINIC_ID = process.env.CLINIC_ID!
const DIAS_ADELANTE = 60

if (!SUBDOMAIN || !USERNAME || !PASSWORD || !API_URL || !SECRET || !CLINIC_ID) {
  console.error('Missing required environment variables')
  process.exit(1)
}

interface Profesional {
  nombre: string
  puntos_atencion: string[]
  slots: Array<{ dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string }>
}

interface Admision {
  id: string; identificacion: string; nombre_paciente: string
  procedimiento: string; aseguradora: string; profesional_nombre: string
  ubicacion: string; hora_inicial: string; fase: string; fecha: string
}

async function main() {
  console.log(`[iSalud] Starting scrape for ${SUBDOMAIN}.isalud.co`)
  const baseUrl = `https://${SUBDOMAIN}.isalud.co`

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    // --- LOGIN ---
    console.log('[iSalud] Logging in...')
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 })

    await page.fill('input[name="login[Usuario]"]', USERNAME)
    await page.fill('input[name="login[Clave]"]', PASSWORD)

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click('button[type="submit"], input[type="submit"]'),
    ])

    if (page.url().includes('/login')) {
      throw new Error('Login failed — invalid credentials')
    }

    // Handle "Cambiar Centro" screen
    const cambiarBtn = page.locator('button:has-text("Cambiar"), a:has-text("Cambiar")')
    if (await cambiarBtn.count() > 0) {
      console.log('[iSalud] Navigating past "Cambiar Centro" screen')
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        cambiarBtn.first().click(),
      ])
    }

    console.log(`[iSalud] Login OK: ${page.url()}`)

    // --- DISPONIBILIDAD ---
    console.log('[iSalud] Scraping /disponibilidad...')
    await page.goto(`${baseUrl}/disponibilidad`, { waitUntil: 'networkidle', timeout: 30000 })

    // Toggle "Cargar todo"
    const cargarTodo = page.locator('text=Cargar todo').locator('..').locator('input, button, a, label')
    if (await cargarTodo.count() > 0) {
      await cargarTodo.first().click().catch(() => {})
      await page.waitForTimeout(2000)
    }

    await page.waitForTimeout(2000)

    // Max records
    try { await page.selectOption('.dataTables_length select', '-1') } catch {
      try { await page.selectOption('.dataTables_length select', '100') } catch {}
    }
    await page.waitForTimeout(1500)

    const profesionales: Profesional[] = await page.evaluate(() => {
      const profMap: Record<string, { puntos: Set<string>; slots: Array<{ dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string }> }> = {}
      const rows = document.querySelectorAll('table tbody tr')

      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length < 6) continue

        const profesional = (cells[5]?.textContent?.trim() ?? '').toUpperCase()
        const punto = cells[6]?.textContent?.trim() ?? ''
        const fechaRaw = cells[1]?.textContent?.trim() ?? ''
        const horaInicio = (cells[2]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')
        const horaFin = (cells[3]?.textContent?.trim() ?? '').replace(/:\d{2}$/, '')

        if (!profesional || profesional.length < 3) continue

        if (!profMap[profesional]) profMap[profesional] = { puntos: new Set<string>(), slots: [] }
        if (punto) profMap[profesional].puntos.add(punto)

        let fecha = '', diaSemana = -1
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
          fecha = fechaRaw; diaSemana = new Date(fechaRaw + 'T12:00:00').getDay()
        } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw)) {
          const [dd, mm, yyyy] = fechaRaw.split('/')
          fecha = `${yyyy}-${mm}-${dd}`; diaSemana = new Date(fecha + 'T12:00:00').getDay()
        }

        if (diaSemana >= 0 && horaInicio) {
          profMap[profesional].slots.push({ dia_semana: diaSemana, hora_inicio: horaInicio, hora_fin: horaFin || horaInicio, fecha })
        }
      }

      return Object.entries(profMap).map(([nombre, d]) => ({
        nombre, puntos_atencion: Array.from(d.puntos), slots: d.slots,
      }))
    })

    console.log(`[iSalud] Found ${profesionales.length} profesionales`)

    // --- ADMISION ---
    console.log('[iSalud] Scraping /admision...')
    await page.goto(`${baseUrl}/admision`, { waitUntil: 'networkidle', timeout: 30000 })

    const allAdmisiones: Admision[] = []
    const today = new Date()

    for (let d = 0; d < DIAS_ADELANTE; d++) {
      const date = new Date(today)
      date.setDate(date.getDate() + d)
      const fechaStr = date.toISOString().split('T')[0]

      try {
        const dateInput = page.locator('input[type="date"], input[name*="fecha"], input[name*="Fecha"]')
        if (await dateInput.count() > 0) {
          await dateInput.first().fill(fechaStr)
          await page.waitForTimeout(1500)
        } else if (d === 0) {
          await page.goto(`${baseUrl}/admision?fecha=${fechaStr}`, { waitUntil: 'networkidle', timeout: 15000 })
          await page.waitForTimeout(1500)
        }

        if (d === 0) {
          try { await page.selectOption('.dataTables_length select', '-1') } catch {
            try { await page.selectOption('.dataTables_length select', '100') } catch {}
          }
          await page.waitForTimeout(1000)
        }

        const dayAdmisiones = await page.evaluate((fecha) => {
          const results: Admision[] = []
          const rows = document.querySelectorAll('table tbody tr')
          for (const row of rows) {
            const cells = row.querySelectorAll('td')
            if (cells.length < 8) continue
            const id = cells[0]?.textContent?.trim() ?? ''
            const profesional = (cells[5]?.textContent?.trim() ?? '').toUpperCase()
            const fase = cells[8]?.textContent?.trim() ?? 'Programado'
            if (!id || !profesional) continue
            if (fase !== 'Programado' && fase !== 'Admitido') continue
            results.push({
              id, identificacion: cells[1]?.textContent?.trim() ?? '',
              nombre_paciente: cells[2]?.textContent?.trim() ?? '',
              procedimiento: cells[3]?.textContent?.trim() ?? '',
              aseguradora: cells[4]?.textContent?.trim() ?? '',
              profesional_nombre: profesional,
              ubicacion: cells[6]?.textContent?.trim() ?? '',
              hora_inicial: (cells[7]?.textContent?.trim() ?? '').replace(/:\d{2}$/, ''),
              fase, fecha,
            })
          }
          return results
        }, fechaStr)

        if (dayAdmisiones) allAdmisiones.push(...dayAdmisiones)

        if (d % 10 === 0) {
          console.log(`[iSalud] Admision progress: day ${d}/${DIAS_ADELANTE}, ${allAdmisiones.length} total`)
        }
      } catch (err) {
        console.warn(`[iSalud] Error day ${fechaStr}: ${err}`)
      }
    }

    console.log(`[iSalud] Total: ${profesionales.length} profesionales, ${allAdmisiones.length} admisiones`)

    // --- POST TO OMUWAN ---
    console.log(`[iSalud] Posting results to ${API_URL}/api/sync/isalud/ingest`)
    const res = await fetch(`${API_URL}/api/sync/isalud/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: SECRET,
        clinicId: CLINIC_ID,
        profesionales,
        admisiones: allAdmisiones,
      }),
    })

    const result = await res.json()
    console.log(`[iSalud] Ingest result:`, JSON.stringify(result))

    if (!res.ok) {
      console.error(`[iSalud] Ingest failed: ${res.status}`)
      process.exit(1)
    }

    console.log('[iSalud] Sync complete!')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('[iSalud] Fatal error:', err)
  process.exit(1)
})
