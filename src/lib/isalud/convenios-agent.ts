// ⏳ MIGRACIÓN ALGIA — código de un solo uso. NO es feature del producto Omuwan.
// Ver sección "MIGRACIÓN ALGIA" en CLAUDE.md antes de modificar o reusar.
// ============================================================
// iSalud Convenios Agent — scraping de productos de convenios
//
// Único propósito: acelerar onboarding. Trae productos (procedimientos)
// y tarifas configuradas en iSalud, los vuelca en isalud_import_staging,
// y la admin escoge cuáles convertir en consultation_types de Omuwan.
//
// 100% idempotente: re-importar limpia el staging y vuelve a llenar.
// ============================================================

import type { Browser, Page } from 'playwright-core'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { launchBrowserAndContext, loginAndInjectCookies, type ISaludCredentials } from './adapter'

// --- Types ---

export interface ConvenioListItem {
  nit: string
  nombre: string
  nombre_abreviado: string | null
  detalle_url: string | null   // link al detalle del convenio (si lo encontramos)
}

export interface ConvenioProducto {
  convenio_nit: string
  convenio_nombre: string
  convenio_nombre_abreviado: string | null
  producto_nombre: string
  tarifa: number
  duracion_minutos: number | null
  agendable_web: boolean
  opcion_detalle: string | null
}

export interface ConveniosScrapeResult {
  convenios: number
  productos: number
  errors: string[]
}

const CONVENIO_TIMEOUT_MS = 60_000

// --- Main entry point ---

/**
 * Scrape de todos los convenios + productos activos.
 * Vuelca el resultado en `isalud_import_staging` (UPSERT).
 *
 * Idempotente: borra el staging previo de la clínica antes de empezar.
 */
export async function scrapeConvenios(clinicId: string): Promise<ConveniosScrapeResult> {
  console.log(`[ConveniosAgent] START clinic=${clinicId}`)

  // 1. Recuperar credenciales del clinic
  const { data: integ } = await supabaseAdmin
    .from('sync_integrations')
    .select('credentials')
    .eq('clinic_id', clinicId)
    .eq('provider', 'isalud')
    .maybeSingle()

  if (!integ?.credentials) {
    return { convenios: 0, productos: 0, errors: ['No hay credenciales de iSalud configuradas para esta clínica'] }
  }
  const creds = integ.credentials as ISaludCredentials

  // 2. Limpiar staging previo (idempotencia)
  await supabaseAdmin.from('isalud_import_staging').delete().eq('clinic_id', clinicId)

  // 3. Lanzar browser + login + scrape
  let browser: Browser | null = null
  const errors: string[] = []
  let totalConvenios = 0
  let totalProductos = 0

  try {
    const { browser: br, context } = await launchBrowserAndContext()
    browser = br
    const page = await loginAndInjectCookies(context, creds)

    // 4. Lista de convenios (en la página principal de login)
    const convenios = await scrapeConvenioList(page, creds)
    totalConvenios = convenios.length
    console.log(`[ConveniosAgent] Found ${convenios.length} convenios`)

    if (convenios.length === 0) {
      errors.push('No se encontraron convenios en iSalud (revisar selectores)')
    }

    // 5. Por cada convenio: traer su detalle tarifario SECUENCIALMENTE.
    //    Abrir 1 sola página a la vez para no saturar la RAM de Vercel (250MB).
    //    Si un convenio falla, reintenta 1 vez antes de saltar.
    const startedAt = Date.now()
    for (let i = 0; i < convenios.length; i++) {
      const conv = convenios[i]
      const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      console.log(`[ConveniosAgent] [${i + 1}/${convenios.length}] ${conv.nombre} (heap: ${heapMB}MB)`)

      let productos: ConvenioProducto[] = []
      let lastError = ''

      for (let attempt = 0; attempt < 2; attempt++) {
        const tabPage = await context.newPage()
        try {
          productos = await scrapeDetalleTarifario(tabPage, creds, conv)
          lastError = ''
          break // éxito
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt === 0) console.warn(`[ConveniosAgent] ${conv.nombre}: intento 1 falló (${lastError}), reintentando...`)
        } finally {
          await tabPage.close().catch(() => {})
        }
      }

      if (lastError) {
        errors.push(`${conv.nombre}: ${lastError}`)
        console.error(`[ConveniosAgent] ${conv.nombre}: falló tras 2 intentos — ${lastError}`)
        continue
      }
      if (productos.length === 0) {
        console.log(`[ConveniosAgent] ${conv.nombre}: 0 productos activos`)
        continue
      }

      const rows = productos.map((p) => ({
        clinic_id: clinicId,
        convenio_nit: p.convenio_nit,
        convenio_nombre: p.convenio_nombre,
        convenio_nombre_abreviado: p.convenio_nombre_abreviado,
        producto_nombre: p.producto_nombre,
        tarifa: p.tarifa,
        duracion_minutos: p.duracion_minutos,
        agendable_web: p.agendable_web,
        opcion_detalle: p.opcion_detalle,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('isalud_import_staging')
        .upsert(rows, { onConflict: 'clinic_id,convenio_nit,convenio_nombre_abreviado,producto_nombre' })
      if (insErr) {
        errors.push(`Insert ${conv.nombre}: ${insErr.message}`)
        console.error(`[ConveniosAgent] Insert error: ${insErr.message}`)
      } else {
        totalProductos += productos.length
        console.log(`[ConveniosAgent] ${conv.nombre}: +${productos.length} productos`)
      }
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
    console.log(`[ConveniosAgent] DONE in ${elapsedSec}s: ${totalConvenios} convenios, ${totalProductos} productos, ${errors.length} errors`)
    return { convenios: totalConvenios, productos: totalProductos, errors }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ConveniosAgent] FATAL: ${msg}`)
    return { convenios: 0, productos: 0, errors: [`Fatal: ${msg}`] }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// --- Scrape: lista de convenios ---

async function scrapeConvenioList(page: Page, creds: ISaludCredentials): Promise<ConvenioListItem[]> {
  const baseUrl = `https://${creds.subdomain}.isalud.co`
  // URL confirmada por logs reales (algia.isalud.co): la entidad se llama "aseguradora",
  // NO "convenio". El menú "Convenios" del UI rutea a `/aseguradora`.
  const candidates = [
    `${baseUrl}/aseguradora`,
    `${baseUrl}/aseguradoras`,
    // Fallbacks por si cambia en otra clínica
    `${baseUrl}/convenio`,
    `${baseUrl}/convenios`,
  ]

  let arrived = false
  let arrivedUrl = ''
  for (const url of candidates) {
    try {
      console.log(`[ConveniosAgent] Trying ${url}`)
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const httpStatus = resp?.status() ?? 0
      // Esperar a que cargue AJAX/DataTables
      await page.waitForTimeout(3500)

      const diag = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim())
        const tableCount = document.querySelectorAll('table').length
        const tbodyRows = document.querySelectorAll('table tbody tr').length
        const title = document.title
        const h1 = (document.querySelector('h1, h2, .page-title')?.textContent ?? '').trim().slice(0, 80)
        const bodyPreview = (document.body.innerText ?? '').slice(0, 250).replace(/\s+/g, ' ')
        return { headers, tableCount, tbodyRows, title, h1, bodyPreview }
      })

      const finalUrl = page.url()
      const lower = diag.headers.map((h) => h.toLowerCase())
      const hasNit = lower.some((h) => h.includes('nit'))
      const hasNombre = lower.some((h) => h.includes('nombre'))
      const hasAbreviado = lower.some((h) => h.includes('abreviad'))
      const hasAcciones = lower.some((h) => h.includes('accion'))
      // Match firme: NIT + Nombre (las dos columnas obligatorias en la pantalla de Convenios)
      // Match suave: NIT + Abreviado o NIT + Acciones
      const headersOk = (hasNit && hasNombre) || (hasNit && hasAbreviado) || (hasNit && hasAcciones)

      console.log(`[ConveniosAgent]   → status=${httpStatus} finalUrl=${finalUrl}`)
      console.log(`[ConveniosAgent]   → title="${diag.title}" h1="${diag.h1}"`)
      console.log(`[ConveniosAgent]   → tables=${diag.tableCount} tbodyRows=${diag.tbodyRows}`)
      console.log(`[ConveniosAgent]   → headers=[${diag.headers.join(' | ')}] match=${headersOk}`)
      if (!headersOk) {
        console.log(`[ConveniosAgent]   → bodyPreview="${diag.bodyPreview}"`)
      }

      if (headersOk) {
        console.log(`[ConveniosAgent] ✓ Arrived at ${url}`)
        arrived = true
        arrivedUrl = finalUrl
        break
      }
    } catch (e) {
      console.log(`[ConveniosAgent] ${url} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!arrived) {
    // Fallback: intentar descubrir la URL real navegando al menú principal y buscando un link
    // que diga "Convenio" o "Convenios"
    console.log(`[ConveniosAgent] Fallback: scanning home for "Convenio" link...`)
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2000)
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          text: (a.textContent ?? '').trim(),
          href: (a as HTMLAnchorElement).href,
        })).filter((l) => l.text.length > 0)
      })
      const conveniosLinks = links.filter((l) => /convenio/i.test(l.text) || /convenio/i.test(l.href))
      console.log(`[ConveniosAgent] Found ${conveniosLinks.length} links mentioning "convenio"`)
      conveniosLinks.slice(0, 10).forEach((l) => console.log(`[ConveniosAgent]   - "${l.text}" → ${l.href}`))

      if (conveniosLinks.length > 0) {
        const target = conveniosLinks[0]
        console.log(`[ConveniosAgent] Trying discovered link: ${target.href}`)
        await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(3500)
        const finalUrl = page.url()
        const diag = await page.evaluate(() => {
          const headers = Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim())
          const tableCount = document.querySelectorAll('table').length
          const tbodyRows = document.querySelectorAll('table tbody tr').length
          return { headers, tableCount, tbodyRows }
        })
        console.log(`[ConveniosAgent] Discovered finalUrl=${finalUrl}, tables=${diag.tableCount}, headers=[${diag.headers.join(' | ')}]`)
        const lower = diag.headers.map((h) => h.toLowerCase())
        if (lower.some((h) => h.includes('nit')) && (lower.some((h) => h.includes('nombre')) || lower.some((h) => h.includes('abreviad')))) {
          arrived = true
          arrivedUrl = finalUrl
          console.log(`[ConveniosAgent] ✓ Arrived via discovered link`)
        }
      }
    } catch (e) {
      console.log(`[ConveniosAgent] Discovery fallback failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!arrived) {
    throw new Error('No pude llegar a la pantalla de Convenios — revisar URL en iSalud (revisa logs de Vercel para ver qué URLs se probaron)')
  }
  console.log(`[ConveniosAgent] Using URL: ${arrivedUrl}`)

  // Detectar columnas
  const colIdx = await page.evaluate(() => {
    const hs = Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim().toLowerCase())
    const find = (...keys: string[]) => { for (let i = 0; i < hs.length; i++) for (const k of keys) if (hs[i].includes(k)) return i; return -1 }
    return { nit: find('nit'), nombre: find('nombre'), abreviado: find('abreviad', 'corto', 'siglas') }
  })
  console.log(`[ConveniosAgent] Column indices: ${JSON.stringify(colIdx)}`)

  // Función para leer los convenios de la página actual
  const readCurrentRows = () => page.evaluate((idx: { nit: number; nombre: number; abreviado: number }) => {
    const rows: Array<{ nit: string; nombre: string; nombre_abreviado: string | null; detalle_url: string | null }> = []
    document.querySelectorAll('table tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td')
      if (tds.length === 0) return
      const cell = (i: number): string => i >= 0 && i < tds.length ? (tds[i]?.textContent ?? '').trim() : ''
      const nombre = cell(idx.nombre)
      if (!nombre || nombre.length <= 1) return
      const link = tr.querySelector('a[href]') as HTMLAnchorElement | null
      rows.push({ nit: cell(idx.nit) || '', nombre, nombre_abreviado: cell(idx.abreviado) || null, detalle_url: link ? link.getAttribute('href') : null })
    })
    return rows
  }, colIdx)

  // iSalud usa paginación SERVER-SIDE con ?page=N (NO DataTables client-side).
  // Links: <a href="/aseguradora?page=2">2</a>, etc.
  // Leer todas las páginas navegando a cada ?page=N.
  const convenios: ConvenioListItem[] = []
  let pageNum = 1
  while (true) {
    const pageRows = await readCurrentRows()
    convenios.push(...pageRows)
    console.log(`[ConveniosAgent] Página ${pageNum}: ${pageRows.length} convenios (acumulado: ${convenios.length})`)

    if (pageRows.length === 0) break

    // Buscar el link a la página siguiente (?page=N+1)
    const nextPageUrl = await page.evaluate((currentPage: number) => {
      const nextPage = currentPage + 1
      // Buscar link con texto = nextPage o href que contenga page=nextPage
      const links = Array.from(document.querySelectorAll('a[href]'))
      for (const a of links) {
        const href = (a as HTMLAnchorElement).href
        if (href.includes('page=' + nextPage)) return href
      }
      return null
    }, pageNum)

    if (!nextPageUrl) break

    await page.goto(nextPageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(2000)
    pageNum++
    if (pageNum > 20) break // safeguard
  }

  console.log(`[ConveniosAgent] Total: ${convenios.length} convenios en ${pageNum} páginas`)
  if (convenios.length > 0) console.log(`[ConveniosAgent] First: ${JSON.stringify(convenios[0])}`)
  return convenios
}

// --- Scrape: detalle tarifario de un convenio ---

async function scrapeDetalleTarifario(page: Page, creds: ISaludCredentials, conv: ConvenioListItem): Promise<ConvenioProducto[]> {
  const baseUrl = `https://${creds.subdomain}.isalud.co`

  // URL principal: la del listing → "Acciones" (ya capturada como detalle_url, ej. /aseguradora/{id}/edit).
  // Las URLs `/convenio/*` no existen en iSalud — la entidad es `aseguradora`.
  const candidates: string[] = []
  if (conv.detalle_url) {
    const fullUrl = conv.detalle_url.startsWith('http') ? conv.detalle_url : `${baseUrl}${conv.detalle_url.startsWith('/') ? conv.detalle_url : '/' + conv.detalle_url}`
    candidates.push(fullUrl)
  }

  // Navegar a la URL del detalle del convenio
  if (candidates.length === 0) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: sin URL (saltando)`)
    return []
  }
  const url = candidates[0]
  console.log(`[ConveniosAgent] Detalle ${conv.nombre}: navegando a ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONVENIO_TIMEOUT_MS })
  await page.waitForTimeout(2000)

  // LECTURA DIRECTA del DOM — sin activar la tab "Detalle Tarifario".
  // DataTables solo renderiza la página actual en el DOM (~8-10 filas).
  // Para leer TODAS las filas, primero intentamos "mostrar todos" via
  // DataTables API, luego leemos. Si eso falla, paginamos manualmente.

  // Paso 1: Activar la tab para que DataTables inicialice (necesario para la API)
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jq = (window as any).$ ?? (window as any).jQuery
    if (!jq) return
    const tabLink = document.querySelector('ul.nav-tabs a[data-toggle="tab"][href*="Detalle"][href*="Tarifario"]') as HTMLElement | null
    if (tabLink) {
      try { jq(tabLink).tab('show') } catch { /* */ }
      tabLink.click()
    }
  })
  await page.waitForTimeout(1000)

  // Paso 2: Cambiar el select de paginación a "100" (máx disponible).
  // NO usar DataTables API (.page.len(-1).draw()) — corrompe la tabla
  // porque -1 no es una opción válida y .draw() puede hacer un AJAX reload.
  await page.evaluate(() => {
    const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
    if (!wrapper) return
    const sel = wrapper.querySelector('.dataTables_length select') as HTMLSelectElement | null
    if (!sel) return
    // Intentar 100 (máx disponible en iSalud), luego 50, luego 25
    for (const v of ['100', '50', '25']) {
      const opt = Array.from(sel.options).find((o) => o.value === v)
      if (opt) {
        sel.value = v
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
    }
  })
  await page.waitForTimeout(1500)

  // Paso 3: Leer headers + filas + paginar si hay más.
  const allRows: string[][] = []

  // Headers (del scrollHead, tabla separada por DataTables scrollY)
  const headers = await page.evaluate(() => {
    const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
    const headerTable = wrapper?.querySelector('.dataTables_scrollHead table thead')
    if (headerTable) return Array.from(headerTable.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim())
    const table = document.querySelector('#tabladetalletarifario')
    if (table) return Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim())
    return [] as string[]
  })

  if (headers.length === 0) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: tabla no encontrada (saltando)`)
    return []
  }

  // Función para leer filas del tbody
  const readCurrentPage = async (): Promise<string[][]> => {
    return page.evaluate(() => {
      const table = document.querySelector('#tabladetalletarifario')
      if (!table) return []
      return Array.from(table.querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()))
        .filter((cells) => cells.length > 0 && !cells.every((c) => c === ''))
    })
  }

  // Leer + paginar
  let pageNum = 1
  while (true) {
    const pageRows = await readCurrentPage()
    // Filtrar placeholder "No hay datos"
    const realRows = pageRows.filter((cells) => {
      const joined = cells.join(' ').toLowerCase()
      return !joined.includes('no hay datos') && !joined.includes('no data')
    })
    allRows.push(...realRows)

    // ¿Hay botón "next" habilitado en el wrapper del tarifario?
    const hasNext = await page.evaluate(() => {
      const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
      if (!wrapper) return false
      const next = wrapper.querySelector('.paginate_button.next') as HTMLElement | null
      if (!next) return false
      return !next.classList.contains('disabled')
    })

    if (!hasNext) break

    await page.evaluate(() => {
      const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
      const next = wrapper?.querySelector('.paginate_button.next') as HTMLElement | null
      next?.click()
    })
    await page.waitForTimeout(800)
    pageNum++
    if (pageNum > 50) break
  }
  if (pageNum > 1) console.log(`[ConveniosAgent] ${conv.nombre}: paginó ${pageNum} páginas`)

  // Construir resultado
  const extraction = { error: null as string | null, headers: headers as string[], rows: allRows }

  if (extraction.error) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: ${extraction.error} (saltando)`)
    return []
  }

  // Mapear columnas por nombre
  const lower = extraction.headers.map((h) => h.toLowerCase())
  const find = (...keys: string[]): number => {
    for (let i = 0; i < lower.length; i++) {
      for (const k of keys) {
        if (lower[i].includes(k)) return i
      }
    }
    return -1
  }
  const ci = {
    producto: find('producto'),
    tarifa: find('tarifa'),
    opcion: find('opción detalle', 'opcion detalle', 'opción', 'opcion'),
    estado: find('estado'),
    agendable: find('agendada web', 'agendable web', 'agendable', 'web'),
    duracion: find('duración', 'duracion'),
  }
  console.log(`[ConveniosAgent] ${conv.nombre}: ${extraction.rows.length} filas raw (${pageNum} págs)`)

  // Detectar placeholder vacío
  if (extraction.rows.length <= 1) {
    const firstText = (extraction.rows[0] ?? []).join(' ').toLowerCase()
    if (extraction.rows.length === 0 || firstText.includes('no hay datos') || firstText.includes('no data')) {
      console.log(`[ConveniosAgent] ${conv.nombre}: tabla vacía`)
      return []
    }
  }

  // Procesar filas
  const allProducts: ConvenioProducto[] = []
  for (const cells of extraction.rows) {
    const cell = (i: number): string => i >= 0 && i < cells.length ? cells[i] : ''

    // Solo activos
    if (ci.estado >= 0 && cell(ci.estado) && !cell(ci.estado).toLowerCase().includes('activo')) continue
    const producto = cell(ci.producto)
    if (!producto) continue

    const tarifaNum = parseInt(cell(ci.tarifa).replace(/[^\d]/g, ''), 10) || 0
    let duracionMin: number | null = null
    const durStr = cell(ci.duracion)
    if (durStr) {
      const m = durStr.match(/\d+/)
      if (m && !durStr.toLowerCase().includes('sin')) duracionMin = parseInt(m[0], 10)
    }
    const agendableStr = cell(ci.agendable).toLowerCase()
    const agendable = agendableStr.includes('tiene opción escogida') || agendableStr === 'sí' || agendableStr === 'si'

    allProducts.push({
      convenio_nit: conv.nit,
      convenio_nombre: conv.nombre,
      convenio_nombre_abreviado: conv.nombre_abreviado,
      producto_nombre: producto,
      tarifa: tarifaNum,
      duracion_minutos: duracionMin,
      agendable_web: agendable,
      opcion_detalle: cell(ci.opcion) || null,
    })
  }
  console.log(`[ConveniosAgent] ${conv.nombre}: ${allProducts.length} productos activos (antes de dedup)`)

  // Deduplicar por producto (DataTables a veces re-renderiza)
  const dedup = new Map<string, ConvenioProducto>()
  for (const p of allProducts) {
    dedup.set(p.producto_nombre, p)
  }
  return Array.from(dedup.values())
}
