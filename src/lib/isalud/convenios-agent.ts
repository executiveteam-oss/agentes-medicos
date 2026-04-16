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
  // Rutas candidatas. Patrón observado en iSalud: rutas raíz singulares
  // (`/disponibilidad`, `/admision`). Los items del menú "Gestión de Agendas"
  // NO usan namespace `/agenda/...`. Probamos `/convenio` primero, luego variantes.
  const candidates = [
    `${baseUrl}/convenio`,
    `${baseUrl}/convenios`,
    `${baseUrl}/admision/convenios`,
    `${baseUrl}/admision/convenio`,
    `${baseUrl}/agenda/convenio`,
    `${baseUrl}/agenda/convenios`,
    `${baseUrl}/maestros/convenio`,
    `${baseUrl}/maestros/convenios`,
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

  // Intentar varias URLs de detalle. Si tenemos detalle_url, esa es la primera opción.
  const candidates: string[] = []
  if (conv.detalle_url) {
    const fullUrl = conv.detalle_url.startsWith('http') ? conv.detalle_url : `${baseUrl}${conv.detalle_url.startsWith('/') ? conv.detalle_url : '/' + conv.detalle_url}`
    candidates.push(fullUrl)
  }
  if (conv.nit) {
    candidates.push(`${baseUrl}/convenio/${encodeURIComponent(conv.nit)}/tarifario`)
    candidates.push(`${baseUrl}/convenio/${encodeURIComponent(conv.nit)}`)
    candidates.push(`${baseUrl}/convenio/detalle/${encodeURIComponent(conv.nit)}`)
  }

  let arrived = false
  for (const url of candidates) {
    try {
      console.log(`[ConveniosAgent] Detalle ${conv.nombre}: trying ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONVENIO_TIMEOUT_MS })
      await page.waitForTimeout(1500)
      // Si en esta página hay un tab "Detalle Tarifario" hacer click
      const tabClicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button'))
        for (const el of links) {
          const t = (el.textContent ?? '').trim().toLowerCase()
          if (t.includes('detalle tarifario') || t.includes('tarifario')) {
            ;(el as HTMLElement).click()
            return true
          }
        }
        return false
      })
      if (tabClicked) {
        await page.waitForTimeout(1500)
      }
      // Verificar que la tabla actual tiene columnas tipo "Producto" / "Tarifa"
      const ok = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('table thead th')).map((th) => (th.textContent ?? '').trim().toLowerCase())
        return headers.some((h) => h.includes('producto')) && headers.some((h) => h.includes('tarifa'))
      })
      if (ok) {
        arrived = true
        break
      }
    } catch (e) {
      console.log(`[ConveniosAgent] Detalle ${url} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!arrived) {
    console.log(`[ConveniosAgent] Detalle ${conv.nombre}: NO encontrada (saltando)`)
    return []
  }

  // Maximizar DataTables
  try { await page.selectOption('.dataTables_length select', '-1') } catch {
    try { await page.selectOption('.dataTables_length select', '100') } catch {}
  }
  await page.waitForTimeout(1500)

  // Mapear columnas por nombre
  const cols = await page.evaluate(() => {
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
      headers,
      producto: find('producto'),
      tarifa: find('tarifa'),
      opcion: find('opción detalle', 'opcion detalle', 'opcion'),
      estado: find('estado'),
      agendable: find('agendada web', 'agendable', 'web'),
      duracion: find('duración', 'duracion'),
    }
  })
  console.log(`[ConveniosAgent] ${conv.nombre} headers: [${cols.headers.join(' | ')}], cols=${JSON.stringify({ producto: cols.producto, tarifa: cols.tarifa, opcion: cols.opcion, estado: cols.estado, agendable: cols.agendable, duracion: cols.duracion })}`)

  const allProducts: ConvenioProducto[] = []

  // Extraer página actual + paginar si hay paginación
  let pageNum = 1
  while (true) {
    const pageData = await page.evaluate((c: { producto: number; tarifa: number; opcion: number; estado: number; agendable: number; duracion: number }) => {
      const out: Array<{ producto: string; tarifa: string; opcion: string; estado: string; agendable: string; duracion: string }> = []
      document.querySelectorAll('table tbody tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td')
        if (tds.length === 0) return
        const cellText = (i: number): string => i >= 0 && i < tds.length ? (tds[i]?.textContent ?? '').trim() : ''
        out.push({
          producto: cellText(c.producto),
          tarifa: cellText(c.tarifa),
          opcion: cellText(c.opcion),
          estado: cellText(c.estado),
          agendable: cellText(c.agendable),
          duracion: cellText(c.duracion),
        })
      })
      return out
    }, { producto: cols.producto, tarifa: cols.tarifa, opcion: cols.opcion, estado: cols.estado, agendable: cols.agendable, duracion: cols.duracion })

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

    // Paginación: buscar "next" en DataTables
    const paginated = await page.evaluate(() => {
      // DataTables next button
      const next = document.querySelector('.dataTables_paginate .paginate_button.next:not(.disabled), .paginate_button.next:not(.disabled)') as HTMLElement | null
      if (next) {
        next.click()
        return true
      }
      return false
    })

    if (!paginated) break
    await page.waitForTimeout(1000)
    pageNum++
    if (pageNum > 50) {
      console.log(`[ConveniosAgent] ${conv.nombre}: stopping at page ${pageNum} (safeguard)`)
      break
    }
  }

  // Deduplicar por producto (DataTables a veces re-renderiza)
  const dedup = new Map<string, ConvenioProducto>()
  for (const p of allProducts) {
    dedup.set(p.producto_nombre, p)
  }
  return Array.from(dedup.values())
}
