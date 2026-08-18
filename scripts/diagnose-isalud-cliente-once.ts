/**
 * ⏳ Diagnóstico — pantalla /cliente de iSalud Algia.
 * Login + navega + dump de DOM relevante (selects, paginador, primera fila).
 * Sale sin scrapear, en ~30 seg.
 *
 * Run: TZ=America/Bogota npx tsx scripts/diagnose-isalud-cliente-once.ts
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split('\n')) {
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

import {
  launchBrowserAndContext,
  loginAndInjectCookies,
  type ISaludCredentials,
} from '../src/lib/isalud/adapter'

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

    console.log('\n=== Navigating to /cliente ===')
    await page.goto(`https://${credentials.subdomain}.isalud.co/cliente`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3500)

    // 1. Headers
    const headers = await page.evaluate(() => {
      const h: string[] = []
      document.querySelectorAll('table thead th').forEach((th) => h.push(th.textContent?.trim() ?? ''))
      return h
    })
    console.log(`\n--- HEADERS (${headers.length}) ---`)
    headers.forEach((h, i) => console.log(`  [${i}] "${h}"`))

    // 2. Primera fila (verificar mapeo de columnas)
    const firstRow = await page.evaluate(() => {
      const tr = document.querySelector('table tbody tr')
      if (!tr) return null
      const cells: string[] = []
      tr.querySelectorAll('td').forEach((td) => cells.push((td.textContent ?? '').trim().slice(0, 50)))
      return cells
    })
    console.log(`\n--- PRIMERA FILA (${firstRow?.length ?? 0} cells, truncado a 50 chars) ---`)
    firstRow?.forEach((c, i) => console.log(`  [${i}] "${c}"`))

    // 3. Todos los <select> visibles + sus options
    const selects = await page.evaluate(() => {
      const out: Array<{ name: string; id: string; classes: string; options: string[]; visible: boolean }> = []
      document.querySelectorAll('select').forEach((s) => {
        const opts: string[] = []
        s.querySelectorAll('option').forEach((o) => opts.push(`"${(o.textContent ?? '').trim()}"=${o.value}`))
        out.push({
          name: s.name ?? '',
          id: s.id ?? '',
          classes: s.className ?? '',
          options: opts,
          visible: (s as HTMLElement).offsetParent !== null,
        })
      })
      return out
    })
    console.log(`\n--- SELECTS encontrados (${selects.length}) ---`)
    selects.forEach((s, i) => {
      console.log(`  [${i}] name="${s.name}" id="${s.id}" classes="${s.classes}" visible=${s.visible}`)
      console.log(`       options: ${s.options.join(' | ')}`)
    })

    // 4. Paginador — buttons, links, controles típicos
    const paginator = await page.evaluate(() => {
      const out: Array<{ tag: string; text: string; classes: string; visible: boolean }> = []
      // Búsqueda amplia: cualquier cosa que parezca paginación
      document.querySelectorAll('.pagination, .paginate, .dataTables_paginate, [class*="page"]').forEach((el) => {
        const e = el as HTMLElement
        out.push({
          tag: el.tagName,
          text: (el.textContent ?? '').trim().slice(0, 100),
          classes: el.className ?? '',
          visible: e.offsetParent !== null,
        })
      })
      return out.slice(0, 20)
    })
    console.log(`\n--- PAGINADOR candidatos (${paginator.length}) ---`)
    paginator.forEach((p, i) => {
      console.log(`  [${i}] <${p.tag}> "${p.text}" classes="${p.classes.slice(0, 60)}" visible=${p.visible}`)
    })

    // 5. Info de "mostrando X de Y" — dataTables_info o similar
    const info = await page.evaluate(() => {
      const candidates: string[] = []
      document.querySelectorAll('.dataTables_info, .pagination-info, [class*="info"]').forEach((el) => {
        const t = (el.textContent ?? '').trim()
        if (t.length > 5 && t.length < 200) candidates.push(t)
      })
      return candidates.slice(0, 5)
    })
    console.log(`\n--- INFO "Mostrando N de TOTAL" candidatos ---`)
    info.forEach((s, i) => console.log(`  [${i}] "${s}"`))

    // 6. Total de filas visibles en este momento
    const visibleRows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length)
    console.log(`\n--- Filas visibles en el tbody ahora: ${visibleRows} ---`)

  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
