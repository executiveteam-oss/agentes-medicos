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

    // 5. Por cada convenio: traer su detalle tarifario en BATCHES PARALELOS.
    //    Reusa el browser context (cookies de auth compartidas), abre una página
    //    nueva por convenio, las cierra al terminar. CONCURRENCY = 3 para no
    //    saturar memoria de Vercel (250MB) ni la sesión de iSalud.
    const CONCURRENCY = 3
    const startedAt = Date.now()
    for (let i = 0; i < convenios.length; i += CONCURRENCY) {
      const batch = convenios.slice(i, i + CONCURRENCY)
      console.log(`[ConveniosAgent] Batch ${Math.floor(i / CONCURRENCY) + 1}: convenios ${i + 1}-${i + batch.length} de ${convenios.length}`)

      const batchResults = await Promise.all(batch.map(async (conv) => {
        const tabPage = await context.newPage()
        try {
          const productos = await scrapeDetalleTarifario(tabPage, creds, conv)
          return { conv, productos, error: null as string | null }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { conv, productos: [], error: msg }
        } finally {
          await tabPage.close().catch(() => {})
        }
      }))

      // Procesar resultados (UPSERT secuencial — DB ops son rápidas)
      for (const r of batchResults) {
        if (r.error) {
          errors.push(`${r.conv.nombre}: ${r.error}`)
          console.error(`[ConveniosAgent] Convenio ${r.conv.nombre} error: ${r.error}`)
          continue
        }
        if (r.productos.length === 0) {
          console.log(`[ConveniosAgent] Convenio ${r.conv.nombre}: 0 productos activos`)
          continue
        }
        const rows = r.productos.map((p) => ({
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
          .upsert(rows, { onConflict: 'clinic_id,convenio_nit,producto_nombre' })
        if (insErr) {
          errors.push(`Insert ${r.conv.nombre}: ${insErr.message}`)
          console.error(`[ConveniosAgent] Insert error: ${insErr.message}`)
        } else {
          totalProductos += r.productos.length
          console.log(`[ConveniosAgent] Convenio ${r.conv.nombre}: +${r.productos.length} productos`)
        }
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

  // Maximizar registros visibles (DataTables)
  try { await page.selectOption('.dataTables_length select', '-1') } catch {
    try { await page.selectOption('.dataTables_length select', '100') } catch {}
  }
  await page.waitForTimeout(1500)

  // Diagnóstico: encabezados
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim())
  )
  console.log(`[ConveniosAgent] Convenios headers: [${headers.join(' | ')}]`)

  // Detectar índices por nombre de header (más robusto que asumir orden)
  const colIdx = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim().toLowerCase())
    const find = (...keys: string[]) => {
      for (let i = 0; i < headers.length; i++) {
        for (const k of keys) {
          if (headers[i].includes(k)) return i
        }
      }
      return -1
    }
    return {
      nit: find('nit'),
      nombre: find('nombre'),
      abreviado: find('abreviad', 'corto', 'siglas'),
    }
  })
  console.log(`[ConveniosAgent] Column indices: ${JSON.stringify(colIdx)}`)

  // Extraer filas
  const convenios = await page.evaluate((idx: { nit: number; nombre: number; abreviado: number }) => {
    const rows: Array<{ nit: string; nombre: string; nombre_abreviado: string | null; detalle_url: string | null }> = []
    document.querySelectorAll('table tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td')
      if (tds.length === 0) return
      const cellText = (i: number): string => i >= 0 && i < tds.length ? (tds[i]?.textContent ?? '').trim() : ''
      const nit = cellText(idx.nit)
      const nombre = cellText(idx.nombre)
      const abreviado = cellText(idx.abreviado)
      // Buscar link al detalle
      const link = tr.querySelector('a[href]') as HTMLAnchorElement | null
      const detalleHref = link ? link.getAttribute('href') : null
      if (nombre && nombre.length > 1) {
        rows.push({
          nit: nit || '',
          nombre,
          nombre_abreviado: abreviado || null,
          detalle_url: detalleHref,
        })
      }
    })
    return rows
  }, colIdx)

  console.log(`[ConveniosAgent] Extracted ${convenios.length} convenio rows`)
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

  let arrived = false
  let arrivedUrl = ''
  for (const url of candidates) {
    try {
      console.log(`[ConveniosAgent] Detalle ${conv.nombre}: navegando a ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONVENIO_TIMEOUT_MS })
      await page.waitForTimeout(1500)

      // Click determinístico en la pestaña "Detalle Tarifario".
      // HTML confirmado: <ul class="nav-tabs"> ... <li><a href="#Detalle&nbsp;Tarifario" data-toggle="tab">Detalle&nbsp;Tarifario</a></li>
      // Selector acotado al ul.nav-tabs de ESTA página (no captura menús globales).
      const clickResult = await page.evaluate(() => {
        const a = document.querySelector(
          'ul.nav-tabs a[data-toggle="tab"][href*="Detalle"][href*="Tarifario"]'
        ) as HTMLAnchorElement | null
        if (!a) return { clicked: false, reason: 'tab not found in ul.nav-tabs' }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jq = (window as any).$ ?? (window as any).jQuery
        if (jq) { try { jq(a).tab('show') } catch { /* */ } }
        a.click()
        return { clicked: true, href: a.getAttribute('href') ?? '' }
      })
      console.log(`[ConveniosAgent]   Click tab: ${JSON.stringify(clickResult)}`)
      if (!clickResult.clicked) {
        // La pestaña no existe en esta página → saltar el convenio
        continue
      }

      // La tabla tiene ID fijo: #tabladetalletarifario.
      // DataTables con scrollY la divide en DOS <table>: una para headers (scrollHead)
      // y otra para datos (scrollBody con el ID). Esperar a que el tbody tenga filas.
      await page.waitForFunction(() => {
        const t = document.querySelector('#tabladetalletarifario')
        if (!t) return false
        return t.querySelectorAll('tbody tr').length > 0
      }, { timeout: 10000 }).catch(() => null)

      // Verificar que la tabla existe y tiene datos
      const tableCheck = await page.evaluate(() => {
        const t = document.querySelector('#tabladetalletarifario')
        if (!t) return { found: false, rows: 0, firstRowText: '' }
        const rows = t.querySelectorAll('tbody tr').length
        const firstRow = t.querySelector('tbody tr')
        const firstRowText = (firstRow?.textContent ?? '').trim().slice(0, 100)
        return { found: true, rows, firstRowText }
      })

      if (tableCheck.found && tableCheck.rows > 0) {
        console.log(`[ConveniosAgent]   ✓ #tabladetalletarifario: ${tableCheck.rows} filas, first="${tableCheck.firstRowText}"`)
        arrived = true
        arrivedUrl = url
        break
      }
      console.log(`[ConveniosAgent]   ✗ #tabladetalletarifario: found=${tableCheck.found}, rows=${tableCheck.rows}`)
    } catch (e) {
      console.log(`[ConveniosAgent] Detalle ${url} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!arrived) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: NO encontrada (saltando)`)
    return []
  }
  console.log(`[ConveniosAgent] Detalle URL: ${arrivedUrl}`)

  // La tabla #tabladetalletarifario usa DataTables con scrollY. Esto causa:
  //   dataTables_scrollHead > table > thead  (headers en una tabla separada)
  //   dataTables_scrollBody > table#tabladetalletarifario > tbody  (datos en otra tabla)
  // Los headers NO están en la misma <table> que el tbody.

  // Maximizar DataTables: seleccionar "mostrar todos" en el length-select del wrapper
  await page.evaluate(() => {
    const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
    if (!wrapper) return
    const sel = wrapper.querySelector('.dataTables_length select') as HTMLSelectElement | null
    if (!sel) return
    for (const v of ['-1', '100', '50']) {
      const opt = Array.from(sel.options).find((o) => o.value === v)
      if (opt) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); return }
    }
  })
  await page.waitForTimeout(1000)

  // Leer headers desde el scrollHead, columnas del tarifario
  const cols = await page.evaluate(() => {
    const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
    if (!wrapper) return { headers: [], producto: -1, tarifa: -1, opcion: -1, estado: -1, agendable: -1, duracion: -1, frecuencia: -1, agrupador: -1 }
    // Headers están en dataTables_scrollHead (tabla separada)
    const headerTable = wrapper.querySelector('.dataTables_scrollHead table thead')
    const headers = headerTable
      ? Array.from(headerTable.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim())
      : []
    const lower = headers.map((h) => h.toLowerCase())
    const find = (...keys: string[]) => {
      for (let i = 0; i < lower.length; i++) {
        for (const k of keys) {
          if (lower[i].includes(k)) return i
        }
      }
      return -1
    }
    return {
      headers,
      producto:   find('producto'),
      tarifa:     find('tarifa'),
      opcion:     find('opción detalle', 'opcion detalle', 'opción', 'opcion'),
      estado:     find('estado'),
      agendable:  find('agendada web', 'agendable web', 'agendable', 'web'),
      duracion:   find('duración', 'duracion'),
      frecuencia: find('frecuencia'),
      agrupador:  find('agrupador'),
    }
  })
  console.log(`[ConveniosAgent] ${conv.nombre} headers: [${cols.headers.join(' | ')}]`)

  const allProducts: ConvenioProducto[] = []

  // Extraer filas de #tabladetalletarifario. Paginar usando el wrapper del DataTable.
  let pageNum = 1
  while (true) {
    const pageData = await page.evaluate((c) => {
      const t = document.querySelector('#tabladetalletarifario')
      if (!t) return { rows: [], emptyPlaceholder: false, tbodyCount: 0 }
      const trList = Array.from(t.querySelectorAll('tbody tr'))
      const tbodyCount = trList.length

      // Placeholder "No hay datos disponibles"
      let emptyPlaceholder = false
      if (trList.length <= 1) {
        const firstTr = trList[0]
        const text = (firstTr?.textContent ?? '').trim().toLowerCase()
        if (
          !firstTr ||
          firstTr.querySelector('.dataTables_empty') != null ||
          text.includes('no hay datos') ||
          text.includes('no data')
        ) {
          emptyPlaceholder = true
        }
      }

      const out: Array<{ producto: string; tarifa: string; opcion: string; estado: string; agendable: string; duracion: string }> = []
      if (!emptyPlaceholder) {
        for (const tr of trList) {
          const tds = tr.querySelectorAll('td')
          if (tds.length === 0) continue
          const cell = (i: number): string => i >= 0 && i < tds.length ? (tds[i]?.textContent ?? '').trim() : ''
          out.push({
            producto: cell(c.producto),
            tarifa: cell(c.tarifa),
            opcion: cell(c.opcion),
            estado: cell(c.estado),
            agendable: cell(c.agendable),
            duracion: cell(c.duracion),
          })
        }
      }
      return { rows: out, emptyPlaceholder, tbodyCount }
    }, { producto: cols.producto, tarifa: cols.tarifa, opcion: cols.opcion, estado: cols.estado, agendable: cols.agendable, duracion: cols.duracion })

    if (pageNum === 1) {
      console.log(`[ConveniosAgent] ${conv.nombre}: pág 1 → tbody=${pageData.tbodyCount}, empty=${pageData.emptyPlaceholder}, extraídas=${pageData.rows.length}`)
    }

    if (pageData.emptyPlaceholder) break

    for (const r of pageData.rows) {
      if (cols.estado >= 0 && r.estado && !r.estado.toLowerCase().includes('activo')) continue
      if (!r.producto) continue
      const tarifaNum = parseInt(r.tarifa.replace(/[^\d]/g, ''), 10) || 0
      let duracionMin: number | null = null
      if (r.duracion) {
        const m = r.duracion.match(/\d+/)
        if (m && !r.duracion.toLowerCase().includes('sin')) duracionMin = parseInt(m[0], 10)
      }
      const agendable = (r.agendable ?? '').toLowerCase().includes('tiene opción escogida')
        || (r.agendable ?? '').toLowerCase() === 'sí'
        || (r.agendable ?? '').toLowerCase() === 'si'

      allProducts.push({
        convenio_nit: conv.nit,
        convenio_nombre: conv.nombre,
        convenio_nombre_abreviado: conv.nombre_abreviado,
        producto_nombre: r.producto,
        tarifa: tarifaNum,
        duracion_minutos: duracionMin,
        agendable_web: agendable,
        opcion_detalle: r.opcion || null,
      })
    }

    // Paginación: "next" dentro de #tabladetalletarifario_wrapper
    const paginated = await page.evaluate(() => {
      const wrapper = document.querySelector('#tabladetalletarifario_wrapper')
      if (!wrapper) return false
      const next = wrapper.querySelector('.dataTables_paginate .paginate_button.next:not(.disabled)') as HTMLElement | null
      if (next) { next.click(); return true }
      return false
    })

    if (!paginated) break
    await page.waitForTimeout(800)
    pageNum++
    if (pageNum > 50) {
      console.log(`[ConveniosAgent] ${conv.nombre}: stopping at page ${pageNum} (safeguard)`)
      break
    }
  }
  console.log(`[ConveniosAgent] ${conv.nombre}: ${pageNum} págs, ${allProducts.length} productos activos (antes de dedup)`)

  // Deduplicar por producto (DataTables a veces re-renderiza)
  const dedup = new Map<string, ConvenioProducto>()
  for (const p of allProducts) {
    dedup.set(p.producto_nombre, p)
  }
  return Array.from(dedup.values())
}
