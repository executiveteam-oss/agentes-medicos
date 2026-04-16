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

    // 4. Lista de convenios
    const convenios = await scrapeConvenioList(page, creds)
    totalConvenios = convenios.length
    console.log(`[ConveniosAgent] Found ${convenios.length} convenios`)

    if (convenios.length === 0) {
      errors.push('No se encontraron convenios en iSalud (revisar selectores)')
    }

    // 5. Por cada convenio: traer su detalle tarifario
    for (const conv of convenios) {
      try {
        const productos = await scrapeDetalleTarifario(page, creds, conv)
        if (productos.length === 0) {
          console.log(`[ConveniosAgent] Convenio ${conv.nombre}: 0 productos activos`)
          continue
        }
        // UPSERT en staging
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
          .upsert(rows, { onConflict: 'clinic_id,convenio_nit,producto_nombre' })
        if (insErr) {
          errors.push(`Insert ${conv.nombre}: ${insErr.message}`)
          console.error(`[ConveniosAgent] Insert error: ${insErr.message}`)
        } else {
          totalProductos += productos.length
          console.log(`[ConveniosAgent] Convenio ${conv.nombre}: +${productos.length} productos`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${conv.nombre}: ${msg}`)
        console.error(`[ConveniosAgent] Convenio ${conv.nombre} error: ${msg}`)
      }
    }

    console.log(`[ConveniosAgent] DONE: ${totalConvenios} convenios, ${totalProductos} productos, ${errors.length} errors`)
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
      await page.waitForTimeout(2000)

      // Diagnóstico: tabs presentes, tablas iniciales
      const initial = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('a, button, li, .nav-link, [role="tab"]'))
          .map((el) => ({
            text: (el.textContent ?? '').trim().slice(0, 50),
            tag: el.tagName,
            href: (el as HTMLAnchorElement).href ?? '',
            dataToggle: (el as HTMLElement).getAttribute('data-toggle') ?? '',
            dataTarget: (el as HTMLElement).getAttribute('data-target') ?? (el as HTMLElement).getAttribute('href') ?? '',
            role: (el as HTMLElement).getAttribute('role') ?? '',
          }))
          .filter((t) => /tarifario|tarifa/i.test(t.text) && t.text.length < 40)
        const tableCount = document.querySelectorAll('table').length
        return { tabs, tableCount, title: document.title, url: location.href }
      })
      console.log(`[ConveniosAgent]   Página cargada: ${initial.url}, ${initial.tableCount} tablas iniciales`)
      console.log(`[ConveniosAgent]   Tabs "tarifario" encontradas: ${initial.tabs.length}`)
      initial.tabs.slice(0, 5).forEach((t) => console.log(`[ConveniosAgent]     - <${t.tag}> "${t.text}" data-toggle="${t.dataToggle}" data-target/href="${t.dataTarget}"`))

      // Click robusto en tab "Detalle Tarifario": múltiples estrategias
      const clickResult = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
        for (const el of candidates) {
          const text = (el.textContent ?? '').trim().toLowerCase()
          if (text === 'detalle tarifario' || text.includes('detalle tarifario')) {
            // Bootstrap tab: dispatch en jQuery si está disponible
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jq = (window as any).$ ?? (window as any).jQuery
            if (jq) {
              try { jq(el).tab('show') } catch { /* */ }
            }
            ;(el as HTMLElement).click()
            return { clicked: true, text: (el.textContent ?? '').trim().slice(0, 50), tag: el.tagName }
          }
        }
        return { clicked: false }
      })
      console.log(`[ConveniosAgent]   Click tab: ${JSON.stringify(clickResult)}`)
      // Espera generosa para que Bootstrap tab dispare AJAX de DataTables
      if (clickResult.clicked) await page.waitForTimeout(4000)

      // Buscar entre TODAS las tablas la que tenga columnas Producto + Tarifa
      const tableInfo = await page.evaluate(() => {
        const allTables = Array.from(document.querySelectorAll('table'))
        return allTables.map((t, idx) => {
          const headers = Array.from(t.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim())
          const visible = (t as HTMLElement).offsetParent !== null
          const tbodyRows = t.querySelectorAll('tbody tr').length
          // Intentar identificar la tabla por id/clase
          const id = t.id || ''
          const cls = t.className.slice(0, 60)
          // ¿Está dentro de un panel/tab visible?
          const inPanel = t.closest('.tab-pane.active, [role="tabpanel"]')
          return { idx, id, cls, headers, tbodyRows, visible, inActiveTab: !!inPanel }
        })
      })
      console.log(`[ConveniosAgent]   Tablas encontradas tras click: ${tableInfo.length}`)
      tableInfo.forEach((t) => console.log(`[ConveniosAgent]     [${t.idx}] id="${t.id}" cls="${t.cls}" visible=${t.visible} activeTab=${t.inActiveTab} rows=${t.tbodyRows} headers=[${t.headers.join(' | ')}]`))

      // Buscar la tabla del tarifario: tiene "producto" + "tarifa" en headers
      const tarifarioIdx = tableInfo.findIndex((t) => {
        const lower = t.headers.map((h) => h.toLowerCase())
        return lower.some((h) => h.includes('producto')) && lower.some((h) => h.includes('tarifa'))
      })
      if (tarifarioIdx >= 0) {
        console.log(`[ConveniosAgent]   ✓ Tabla tarifario en índice ${tarifarioIdx}`)
        arrived = true
        arrivedUrl = url
        // Stash idx para usar después
        await page.evaluate((idx) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__tarifarioIdx = idx
        }, tarifarioIdx)
        break
      }
      console.log(`[ConveniosAgent]   ✗ No se encontró tabla con "producto" + "tarifa" tras click`)
    } catch (e) {
      console.log(`[ConveniosAgent] Detalle ${url} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!arrived) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: NO encontrada (saltando)`)
    return []
  }
  console.log(`[ConveniosAgent] Detalle URL: ${arrivedUrl}`)

  // Seleccionar la tabla específica del tarifario para todas las operaciones siguientes
  const tarifarioIdx = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__tarifarioIdx as number
  })

  // Maximizar DataTables: buscar el length-select asociado a la tabla del tarifario
  await page.evaluate((idx) => {
    const tables = document.querySelectorAll('table')
    const t = tables[idx]
    if (!t) return
    // Buscar el .dataTables_length cercano (mismo wrapper)
    const wrapper = t.closest('.dataTables_wrapper')
    if (!wrapper) return
    const sel = wrapper.querySelector('.dataTables_length select') as HTMLSelectElement | null
    if (!sel) return
    // Intentar -1 (todas) o 100
    const tryValues = ['-1', '100', '50']
    for (const v of tryValues) {
      const opt = Array.from(sel.options).find((o) => o.value === v)
      if (opt) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); return }
    }
  }, tarifarioIdx)
  await page.waitForTimeout(2000)

  // Mapear columnas por nombre, leyendo SOLO la tabla del tarifario
  const cols = await page.evaluate((idx: number) => {
    const tables = document.querySelectorAll('table')
    const t = tables[idx]
    if (!t) return { headers: [], producto: -1, tarifa: -1, opcion: -1, estado: -1, agendable: -1, duracion: -1, frecuencia: -1, agrupador: -1 }
    const headers = Array.from(t.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim())
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
  }, tarifarioIdx)
  console.log(`[ConveniosAgent] ${conv.nombre} headers: [${cols.headers.join(' | ')}], cols=${JSON.stringify({ producto: cols.producto, tarifa: cols.tarifa, opcion: cols.opcion, estado: cols.estado, agendable: cols.agendable, duracion: cols.duracion, frecuencia: cols.frecuencia, agrupador: cols.agrupador })}`)

  const allProducts: ConvenioProducto[] = []

  // Extraer página actual + paginar si hay paginación. Lectura SIEMPRE de la tabla específica.
  let pageNum = 1
  while (true) {
    const pageData = await page.evaluate((args: { idx: number; c: { producto: number; tarifa: number; opcion: number; estado: number; agendable: number; duracion: number; frecuencia: number; agrupador: number } }) => {
      const tables = document.querySelectorAll('table')
      const t = tables[args.idx]
      if (!t) return []
      const out: Array<{ producto: string; tarifa: string; opcion: string; estado: string; agendable: string; duracion: string }> = []
      t.querySelectorAll('tbody tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td')
        if (tds.length === 0) return
        const cellText = (i: number): string => i >= 0 && i < tds.length ? (tds[i]?.textContent ?? '').trim() : ''
        out.push({
          producto: cellText(args.c.producto),
          tarifa: cellText(args.c.tarifa),
          opcion: cellText(args.c.opcion),
          estado: cellText(args.c.estado),
          agendable: cellText(args.c.agendable),
          duracion: cellText(args.c.duracion),
        })
      })
      return out
    }, { idx: tarifarioIdx, c: { producto: cols.producto, tarifa: cols.tarifa, opcion: cols.opcion, estado: cols.estado, agendable: cols.agendable, duracion: cols.duracion, frecuencia: cols.frecuencia, agrupador: cols.agrupador } })

    if (pageNum === 1) console.log(`[ConveniosAgent] ${conv.nombre}: página 1 → ${pageData.length} filas raw`)

    for (const r of pageData) {
      // Solo activos (si la columna existe)
      if (cols.estado >= 0 && r.estado && !r.estado.toLowerCase().includes('activo')) continue
      if (!r.producto) continue
      // Tarifa: extraer entero de cualquier formato ("46.100", "$ 46100", "46,100")
      const tarifaNum = parseInt(r.tarifa.replace(/[^\d]/g, ''), 10) || 0
      // Duración: extraer entero o null si "Sin duración"
      let duracionMin: number | null = null
      if (r.duracion) {
        const m = r.duracion.match(/\d+/)
        if (m && !r.duracion.toLowerCase().includes('sin')) duracionMin = parseInt(m[0], 10)
      }
      // Agendable web: "tiene opción escogida" => true
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

    // Paginación: buscar "next" en el wrapper de la tabla específica del tarifario
    const paginated = await page.evaluate((idx: number) => {
      const tables = document.querySelectorAll('table')
      const t = tables[idx]
      if (!t) return false
      const wrapper = t.closest('.dataTables_wrapper')
      const root: Document | Element = wrapper ?? document
      const next = root.querySelector('.dataTables_paginate .paginate_button.next:not(.disabled)') as HTMLElement | null
      if (next) {
        next.click()
        return true
      }
      return false
    }, tarifarioIdx)

    if (!paginated) break
    await page.waitForTimeout(1200)
    pageNum++
    if (pageNum > 50) {
      console.log(`[ConveniosAgent] ${conv.nombre}: stopping at page ${pageNum} (safeguard)`)
      break
    }
  }
  console.log(`[ConveniosAgent] ${conv.nombre}: ${pageNum} págs procesadas, ${allProducts.length} productos activos extraídos (antes de dedup)`)

  // Deduplicar por producto (DataTables a veces re-renderiza)
  const dedup = new Map<string, ConvenioProducto>()
  for (const p of allProducts) {
    dedup.set(p.producto_nombre, p)
  }
  return Array.from(dedup.values())
}
