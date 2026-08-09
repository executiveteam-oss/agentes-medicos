// ============================================================
// ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
//
// Scrape de /cliente con paginación, checkpoint persistente, rate limit.
// Solo extrae 3 campos: nombre, cédula (col IDENTIFICACIÓN),
// celular (col CELULAR NO.1 — la col TELÉFONO es fijo y suele ser "0").
//
// Diseñado para correr SOLO desde scripts standalone (no Vercel),
// porque 15K registros pasan el límite de maxDuration=600s.
// ============================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Page } from 'playwright-core'
import type { ISaludCredentials } from './adapter'

export interface ISaludCliente {
  documento: string  // cédula limpia (solo dígitos)
  nombre: string     // raw del HTML, sin canonizar (canonización es responsabilidad del matcher)
  telefono: string   // CELULAR NO.1 — raw del HTML, sin normalizar a +57
}

export interface ScrapeClientesOptions {
  cacheDir?: string                    // default ~/.omuwan-cache/algia-clientes
  pageSizeFallback?: string[]          // default ['100','50','25','10']
  betweenPagesMs?: number              // default 1500
  maxRetries?: number                  // default 2 por página
  resume?: boolean                     // default true — usar checkpoint si existe
}

export interface ScrapeClientesResult {
  clientes: ISaludCliente[]
  totalPages: number
  pageSize: number
  durationMs: number
  errorsPages: number[]
  resumedFromPage: number              // 0 = empezó desde cero
  cacheDir: string
}

const DEFAULT_OPTS: Required<ScrapeClientesOptions> = {
  cacheDir: join(homedir(), '.omuwan-cache', 'algia-clientes'),
  pageSizeFallback: ['100', '50', '25'],  // sin '10' porque /cliente no tiene control de page size
  betweenPagesMs: 1500,                    // rate limit conservador (preferimos robustez sobre velocidad)
  maxRetries: 2,
  resume: true,
}

function ensureCacheDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function batchPath(dir: string, pageNum: number): string {
  return join(dir, `batch-${String(pageNum).padStart(5, '0')}.json`)
}

function findResumePage(dir: string): number {
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir).filter((f) => f.startsWith('batch-') && f.endsWith('.json'))
  const pages = files.map((f) => parseInt(f.replace('batch-', '').replace('.json', ''), 10))
  if (pages.length === 0) return 0
  return Math.max(...pages) + 1  // siguiente página
}

function loadCheckpointedBatches(dir: string): ISaludCliente[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('batch-') && f.endsWith('.json'))
    .sort()
  const all: ISaludCliente[] = []
  for (const f of files) {
    const content = readFileSync(join(dir, f), 'utf-8')
    all.push(...(JSON.parse(content) as ISaludCliente[]))
  }
  return all
}

/**
 * Configura page size con fallback chain. Devuelve el size que funcionó.
 * Tira si ninguno funciona.
 */
async function setPageSize(page: Page, fallbacks: string[]): Promise<number> {
  for (const size of fallbacks) {
    try {
      await page.selectOption('.dataTables_length select', size)
      await page.waitForTimeout(1000)
      console.log(`[ClientesScrape] Page size = ${size}`)
      return parseInt(size, 10)
    } catch {
      // No tira fatal — /cliente NO tiene control de page size (lo confirmamos en diagnóstico).
      // Se queda con el default de iSalud (10 filas/página).
    }
  }
  console.log(`[ClientesScrape] No hay control de page size en /cliente — usando default (10 filas/página).`)
  return 10
}

/**
 * Detecta total de páginas extrayendo el N del href del último link.
 * El paginador de /cliente tiene como último <li><a href="/cliente?page=N">
 * que es el "Última" (» icon). El href contiene el total.
 *
 * Estrategia (con fallbacks):
 *   1. Leer el href del ÚLTIMO link de la paginación (botón "Última»")
 *   2. Tomar el max page=N de todos los hrefs presentes
 *   3. Fallback: max número visible como texto
 */
async function detectTotalPages(page: Page): Promise<number> {
  const info = await page.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.pagination li')) as HTMLLIElement[]
    const links: Array<{ text: string; href: string; classes: string }> = []
    for (const li of lis) {
      const a = li.querySelector('a') as HTMLAnchorElement | null
      links.push({
        text: (a?.textContent ?? li.textContent ?? '').trim(),
        href: a?.getAttribute('href') ?? '',
        classes: li.className,
      })
    }
    return links
  })
  console.log(`[ClientesScrape] Paginator links: ${JSON.stringify(info)}`)

  // 1. Extraer N de todos los hrefs page=N y tomar el max
  // El "Última" tiene el N más alto.
  const pagesFromHref = info
    .map((l) => {
      const m = l.href.match(/[?&]page=(\d+)/i)
      return m ? parseInt(m[1], 10) : 0
    })
    .filter((n) => n > 0)
  if (pagesFromHref.length > 0) {
    return Math.max(...pagesFromHref)
  }

  // 2. Fallback: max número como texto
  const nums = info
    .map((l) => parseInt(l.text, 10))
    .filter((n) => !isNaN(n) && n > 0)
  if (nums.length > 0) return Math.max(...nums)

  return 0
}

/**
 * Navega directamente a una página por URL (?page=N).
 * Mucho más robusto y rápido que clickear "Siguiente".
 * Si la sesión expira, page.goto redirige a /login y lo detectamos
 * porque los selectores de tabla no estarán presentes.
 */
async function gotoPage(page: Page, baseUrl: string, pageNum: number): Promise<boolean> {
  try {
    await page.goto(`${baseUrl}/cliente?page=${pageNum}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(700)  // pequeño wait por si el render final tarda

    // Sanity: la URL final debe contener /cliente
    const url = page.url()
    if (!url.includes('/cliente')) {
      console.warn(`[ClientesScrape] gotoPage(${pageNum}) redirigió a ${url} — posible sesión expirada`)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[ClientesScrape] gotoPage(${pageNum}) falló: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * Extrae los rows visibles de la página actual.
 * Mapeo de columnas REAL confirmado por diagnóstico 2026-06-16:
 *   [0] (vacío checkbox)  [1] FOTO  [2] IDENTIFICACIÓN(cédula)  [3] NOMBRE
 *   [4] TELÉFONO(fijo, no usar)  [5] CELULAR NO.1 ← este  [6] CELULAR NO.2
 *   [7] EMAIL  [8] ACUDIENTE  [9] AF.  [10] VIP  [11] ACCIONES
 */
async function extractRows(page: Page): Promise<ISaludCliente[]> {
  return await page.evaluate(() => {
    const rows: Array<{ documento: string; nombre: string; telefono: string }> = []
    document.querySelectorAll('table tbody tr').forEach((tr) => {
      const cells = tr.querySelectorAll('td')
      if (cells.length < 6) return  // necesitamos hasta index 5 (Celular No.1)
      const documento = (cells[2]?.textContent?.trim() ?? '').replace(/[^\d]/g, '')
      const nombre = (cells[3]?.textContent?.trim() ?? '').toUpperCase()
      const telefono = (cells[5]?.textContent?.trim() ?? '').replace(/[^\d+]/g, '')
      // Skip filas sin datos clave
      if (!documento && !nombre) return
      rows.push({ documento, nombre, telefono })
    })
    return rows
  })
}

/**
 * Scrape principal de /cliente con paginación + checkpoint + rate limit.
 */
export async function scrapeClientes(
  page: Page,
  credentials: ISaludCredentials,
  options: ScrapeClientesOptions = {},
): Promise<ScrapeClientesResult> {
  const opts = { ...DEFAULT_OPTS, ...options }
  ensureCacheDir(opts.cacheDir)

  const startMs = Date.now()
  const errorsPages: number[] = []
  const baseUrl = `https://${credentials.subdomain}.isalud.co`

  console.log(`[ClientesScrape] START — cache: ${opts.cacheDir}`)
  console.log(`[ClientesScrape] Navigating to ${baseUrl}/cliente`)
  await page.goto(`${baseUrl}/cliente`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)

  // Log headers para verificar columnas
  const headers = await page.evaluate(() => {
    const h: string[] = []
    document.querySelectorAll('table thead th').forEach((th) => h.push(th.textContent?.trim() ?? ''))
    return h
  })
  console.log(`[ClientesScrape] Headers: [${headers.join(' | ')}]`)

  // Validar columnas: si los headers no matchean lo esperado, parar
  const expectedCols = ['', 'Foto', 'Identificación', 'Nombre', 'Teléfono', 'Celular No. 1']
  const headersOK = expectedCols.every((expected, i) =>
    (headers[i] ?? '').trim().toLowerCase().startsWith(expected.toLowerCase()),
  )
  if (!headersOK) {
    throw new Error(
      `Headers no coinciden con lo esperado. ` +
        `Esperaba: [${expectedCols.join(' | ')}]. ` +
        `Recibí: [${headers.slice(0, 6).join(' | ')}]. ` +
        `Probable cambio en el HTML de iSalud — verificá índices de columna antes de scrapear.`,
    )
  }

  // Setear page size (no-fatal — /cliente no tiene control, queda en 10)
  const pageSize = await setPageSize(page, opts.pageSizeFallback)
  await page.waitForTimeout(1500)

  // Detectar total de páginas
  const totalPages = await detectTotalPages(page)
  console.log(`[ClientesScrape] Total pages detectado: ${totalPages || 'desconocido'}`)

  // SAFETY: validar coherencia (esperamos ~1547 para 15.469 clientes @ 10/página)
  // Si está fuera de [800, 2500], parar antes de scrapear toda la noche con un valor mal leído
  if (totalPages > 0 && (totalPages < 800 || totalPages > 2500)) {
    throw new Error(
      `Total de páginas detectado (${totalPages}) fuera del rango esperado [800, 2500] ` +
        `para ~15.469 clientes a 10 filas/página. ` +
        `Probable que el paginador esté siendo leído mal. ` +
        `Revisá el dump del paginador arriba y ajustá detectTotalPages antes de continuar.`,
    )
  }
  if (totalPages === 0) {
    console.warn(
      `[ClientesScrape] ⚠ No pude detectar el total de páginas. ` +
        `Voy a scrapear hasta que clickNextPage devuelva false. ` +
        `Si esto se cuelga, abortá y revisá detectTotalPages.`,
    )
  }

  // Reanudación: usamos URL ?page=N → goto directo (instantáneo, sin clickear N veces)
  const resumePage = opts.resume ? findResumePage(opts.cacheDir) : 0
  if (resumePage > 0) {
    console.log(`[ClientesScrape] RESUME desde página ${resumePage} (checkpoint encontrado)`)
  }

  // iSalud usa páginas 1-based (?page=1 es la primera).
  // Internamente uso 1-based para consistencia con la URL.
  // Los archivos de checkpoint se nombran por la misma N (batch-00001.json = página 1).
  // findResumePage devuelve el siguiente número a procesar.
  const startPage = Math.max(1, resumePage)
  let lastProcessedPage = startPage - 1

  for (let currentPage = startPage; ; currentPage++) {
    lastProcessedPage = currentPage
    // Navegar a la página
    const ok = await gotoPage(page, baseUrl, currentPage)
    if (!ok) {
      console.warn(`[ClientesScrape] gotoPage(${currentPage}) devolvió false — corto el scrape`)
      break
    }

    // Extraer con retries
    let attempts = 0
    let rows: ISaludCliente[] = []
    while (attempts <= opts.maxRetries) {
      try {
        rows = await extractRows(page)
        break
      } catch (err) {
        attempts++
        console.warn(`[ClientesScrape] Page ${currentPage} extract failed (intento ${attempts}/${opts.maxRetries + 1}): ${err instanceof Error ? err.message : String(err)}`)
        if (attempts > opts.maxRetries) {
          errorsPages.push(currentPage)
          break
        }
        await page.waitForTimeout(2000)
      }
    }

    // Guardar checkpoint (incluso si rows está vacío — marca página como visitada)
    writeFileSync(batchPath(opts.cacheDir, currentPage), JSON.stringify(rows, null, 2), 'utf-8')

    if (currentPage % 25 === 0 || currentPage <= 3 || rows.length === 0) {
      const elapsed = Math.round((Date.now() - startMs) / 1000)
      const pct = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0
      console.log(`[ClientesScrape] Page ${currentPage}/${totalPages || '?'}: ${rows.length} rows | elapsed ${elapsed}s${pct ? ` | ${pct}%` : ''}`)
    }

    // Si la página devolvió 0 rows después de página 1, probable que pasamos el final
    if (currentPage > 1 && rows.length === 0) {
      console.log(`[ClientesScrape] Página ${currentPage} sin filas — asumo fin del paginador`)
      break
    }

    // Si llegamos al total detectado, fin
    if (totalPages > 0 && currentPage >= totalPages) {
      console.log(`[ClientesScrape] Página ${currentPage} = totalPages ${totalPages}, fin`)
      break
    }

    // Rate limit (solo entre páginas)
    await page.waitForTimeout(opts.betweenPagesMs)
  }

  // Consolidar todos los batches
  const clientes = loadCheckpointedBatches(opts.cacheDir)
  const durationMs = Date.now() - startMs

  console.log(`[ClientesScrape] DONE — ${clientes.length} clientes, ${lastProcessedPage} páginas procesadas, ${Math.round(durationMs / 1000)}s, ${errorsPages.length} errores`)

  return {
    clientes,
    totalPages: lastProcessedPage,
    pageSize,
    durationMs,
    errorsPages,
    resumedFromPage: resumePage,
    cacheDir: opts.cacheDir,
  }
}
