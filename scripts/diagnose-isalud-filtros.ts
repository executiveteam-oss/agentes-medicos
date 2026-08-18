/**
 * ⏳ Diagnóstico — modal "Filtrar registros" de /cliente.
 *
 * Objetivo: responder si la búsqueda por apellido es viable:
 *   - ¿Existe el modal/form con inputs identificables?
 *   - ¿Setear "Primer Apellido" + submit recarga la tabla server-side?
 *   - ¿Cuántas filas devuelve un apellido común?
 *
 * Hace UNA búsqueda de prueba (apellido "GARCIA" típicamente popular) y
 * compara filas antes/después.
 *
 * Run: TZ=America/Bogota npx tsx scripts/diagnose-isalud-filtros.ts
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const c = readFileSync(path, 'utf-8')
  for (const line of c.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')

import { launchBrowserAndContext, loginAndInjectCookies, type ISaludCredentials } from '../src/lib/isalud/adapter'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await supa
    .from('sync_integrations').select('credentials')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('provider', 'isalud').neq('sync_status', 'disabled')
    .limit(1).maybeSingle()
  const c = data!.credentials as { subdomain: string; username: string; password: string }
  const credentials: ISaludCredentials = c

  const { browser, context } = await launchBrowserAndContext()
  try {
    const page = await loginAndInjectCookies(context, credentials)

    console.log('\n=== /cliente ===')
    await page.goto(`https://${credentials.subdomain}.isalud.co/cliente`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    // ---- 1. Filas visibles antes de cualquier filtro
    const rowsBefore = await page.evaluate(() => document.querySelectorAll('table tbody tr').length)
    const sampleBefore = await page.evaluate(() => {
      const tr = document.querySelector('table tbody tr')
      if (!tr) return ''
      const tds = tr.querySelectorAll('td')
      return tds[2]?.textContent?.trim() ?? ''  // cédula primera fila
    })
    console.log(`Filas iniciales: ${rowsBefore}, cédula primera fila: ${sampleBefore}`)

    // ---- 2. Buscar TODOS los inputs del form de filtros (visibles o no)
    const allInputs = await page.evaluate(() => {
      const out: Array<{ tag: string; name: string; type: string; id: string; placeholder: string; visible: boolean }> = []
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        const e = el as HTMLInputElement
        const name = e.name ?? ''
        if (name.includes('filter') || name.includes('cliente_') || name === 'q' || name === 'search') {
          out.push({
            tag: el.tagName,
            name, type: e.type ?? '',
            id: e.id ?? '',
            placeholder: e.placeholder ?? '',
            visible: (e as HTMLElement).offsetParent !== null,
          })
        }
      })
      return out
    })
    console.log(`\n--- Inputs del form de filtros (${allInputs.length}) ---`)
    allInputs.forEach((i, idx) => console.log(`  [${idx}] ${i.tag} name="${i.name}" type=${i.type} id="${i.id}" placeholder="${i.placeholder}" visible=${i.visible}`))

    // ---- 3. Buscar botón "Filtrar" o "Buscar"
    const buttons = await page.evaluate(() => {
      const out: Array<{ text: string; classes: string; type: string; visible: boolean }> = []
      document.querySelectorAll('button, input[type="submit"], a[role="button"]').forEach((el) => {
        const e = el as HTMLElement
        const t = (e.textContent ?? '').trim().slice(0, 30)
        const text = t || (el as HTMLInputElement).value || ''
        if (text.match(/filtrar|buscar|aplicar|search/i)) {
          out.push({
            text,
            classes: e.className.slice(0, 80),
            type: (el as HTMLInputElement).type ?? el.tagName,
            visible: e.offsetParent !== null,
          })
        }
      })
      return out
    })
    console.log(`\n--- Botones Filtrar/Buscar (${buttons.length}) ---`)
    buttons.forEach((b, idx) => console.log(`  [${idx}] "${b.text}" type=${b.type} classes="${b.classes}" visible=${b.visible}`))

    // ---- 4. Form action — para saber si va por GET con query params (más fácil)
    const formInfo = await page.evaluate(() => {
      const forms = document.querySelectorAll('form')
      const out: Array<{ action: string; method: string; id: string }> = []
      forms.forEach((f) => {
        out.push({ action: f.action, method: f.method, id: f.id ?? '' })
      })
      return out
    })
    console.log(`\n--- Forms detectados (${formInfo.length}) ---`)
    formInfo.forEach((f, idx) => console.log(`  [${idx}] action="${f.action}" method=${f.method} id="${f.id}"`))

    // ---- 5. Test PRÁCTICO: navegar a /cliente?primerApellido=GARCIA (probar URL directa)
    console.log('\n=== Test 1: filtro por URL query param ===')
    const urlsToTry = [
      `https://${credentials.subdomain}.isalud.co/cliente?cliente_filters%5Bprimerapellido%5D=GARCIA`,
      `https://${credentials.subdomain}.isalud.co/cliente?cliente_filters[primerapellido]=GARCIA`,
      `https://${credentials.subdomain}.isalud.co/cliente?primer_apellido=GARCIA`,
      `https://${credentials.subdomain}.isalud.co/cliente?primerApellido=GARCIA`,
    ]
    for (const url of urlsToTry) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForTimeout(1500)
        const r = await page.evaluate(() => document.querySelectorAll('table tbody tr').length)
        const sample = await page.evaluate(() => {
          const trs = document.querySelectorAll('table tbody tr')
          const out: string[] = []
          for (let i = 0; i < Math.min(3, trs.length); i++) {
            const tr = trs[i]
            const tds = tr.querySelectorAll('td')
            out.push((tds[3]?.textContent ?? '').trim().slice(0, 40))  // nombre
          }
          return out
        })
        const finalUrl = page.url()
        console.log(`  URL: ${url}`)
        console.log(`    → ${finalUrl}`)
        console.log(`    → ${r} filas | muestras: ${JSON.stringify(sample)}`)
      } catch (e) {
        console.log(`  URL fallida: ${url} — ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ---- 6. Si los queryparams no funcionan, intentar el form
    console.log('\n=== Test 2: usar form directamente ===')
    await page.goto(`https://${credentials.subdomain}.isalud.co/cliente`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500)

    // Buscar y abrir modal de filtros si existe
    try {
      const modalTriggerExists = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, a'))
        return candidates.some((c) => /filtrar|filtros/i.test(c.textContent ?? ''))
      })
      console.log(`  Modal trigger detectado: ${modalTriggerExists}`)
    } catch {}

    // Listar nombres de TODOS los inputs con "apellido" en su name
    const apellidoInputs = await page.evaluate(() => {
      const out: Array<{ name: string; id: string; visible: boolean }> = []
      document.querySelectorAll('input').forEach((el) => {
        const name = el.name ?? ''
        if (/apellido/i.test(name) || /apellido/i.test(el.id ?? '')) {
          out.push({ name, id: el.id ?? '', visible: (el as HTMLElement).offsetParent !== null })
        }
      })
      return out
    })
    console.log(`\n  Inputs con "apellido" en name/id (${apellidoInputs.length}):`)
    apellidoInputs.forEach((i, idx) => console.log(`    [${idx}] name="${i.name}" id="${i.id}" visible=${i.visible}`))

  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
