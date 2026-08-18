/**
 * DRY-RUN — Descubrimiento de fases reales de iSalud para Algia.
 *
 * - Lee credenciales de iSalud de Supabase (sync_integrations).
 * - Login real a iSalud productivo de Algia (mismo flujo que el sync cron).
 * - Scrape de admisiones SIN filtro de fase, sobre 3 días (ayer/hoy/mañana).
 * - Reporta los strings distintos de "fase" con conteos + ejemplo.
 * - NO escribe nada a Supabase. NO persiste cookies/HTML a disco.
 *
 * Después del descubrimiento, este script se borra.
 *
 * Run: ulimit -c 0 && npx tsx scripts/discover-isalud-fases.ts
 */

import { createClient } from '@supabase/supabase-js'
import { launchBrowserAndContext, loginAndInjectCookies, type ISaludCredentials } from '../src/lib/isalud/adapter'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

interface RawRow {
  id: string
  fase: string
  fecha: string
  profesional: string
  procedimiento: string
  paciente_preview: string
}

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log('[discover] Leyendo credenciales iSalud de Algia...')
  const { data: integration, error } = await supabase
    .from('sync_integrations')
    .select('credentials, sync_status')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('provider', 'isalud')
    .neq('sync_status', 'disabled')
    .single()

  if (error || !integration) {
    console.error('[discover] No se encontró integración activa de Algia:', error)
    process.exit(1)
  }

  const creds = integration.credentials as ISaludCredentials
  console.log(`[discover] Credenciales OK (subdomain=${creds.subdomain}, user=${creds.username.slice(0, 2)}***)`)

  const { browser, context } = await launchBrowserAndContext()
  try {
    const page = await loginAndInjectCookies(context, creds)
    console.log('[discover] Login OK. Navegando a /admision...')

    const baseUrl = `https://${creds.subdomain}.isalud.co`
    await page.goto(`${baseUrl}/admision`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Maximizar registros en DataTables
    try { await page.selectOption('.dataTables_length select', '-1') } catch {
      try { await page.selectOption('.dataTables_length select', '100') } catch {}
    }
    await page.waitForTimeout(1000)

    const today = new Date()
    // Rango ampliado [hoy-7, hoy+1] para resolver spelling Facturado/Inasistente
    // + diagnosticar anomalía del viernes (si días pasados también dan 0)
    const offsets = Array.from({ length: 9 }, (_, i) => i - 7)
    const allRows: RawRow[] = []
    const byDay = new Map<string, Map<string, number>>()

    for (const offset of offsets) {
      const date = new Date(today)
      date.setDate(date.getDate() + offset)
      const fechaStr = date.toISOString().split('T')[0]

      console.log(`[discover] Día ${fechaStr} (offset=${offset})...`)

      const setOk = await page.evaluate((fecha) => {
        const el = document.querySelector('#admision-date') as HTMLInputElement | null
        if (!el) return false
        el.value = fecha
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jq = (window as any).$ ?? (window as any).jQuery
        if (jq) {
          try { jq(el).datepicker('setDate', fecha) } catch { /* */ }
          try { jq(el).datepicker('update', fecha) } catch { /* */ }
          jq(el).trigger('change').trigger('changeDate').trigger('dp.change')
        }
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }, fechaStr)

      if (!setOk) {
        console.warn(`[discover]   datepicker no encontrado para ${fechaStr}`)
        continue
      }

      await page.waitForTimeout(2000)

      // Scrape SIN filtro de fase
      const dayRows = await page.evaluate(() => {
        const r: Array<{ id: string; fase: string; fecha: string; profesional: string; procedimiento: string; paciente_preview: string }> = []
        document.querySelectorAll('table tbody tr').forEach((row) => {
          const c = row.querySelectorAll('td')
          if (c.length < 15) return
          const id = c[0]?.textContent?.trim() ?? ''
          const fase = c[8]?.textContent?.trim() ?? ''
          if (!id) return // skip filas vacías de DataTables
          let fechaRaw = c[14]?.textContent?.trim() ?? ''
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw)) {
            const [dd, mm, yyyy] = fechaRaw.split('/')
            fechaRaw = `${yyyy}-${mm}-${dd}`
          }
          const pacFull = c[2]?.textContent?.trim() ?? ''
          r.push({
            id,
            fase,
            fecha: fechaRaw,
            profesional: c[5]?.textContent?.trim() ?? '',
            procedimiento: c[3]?.textContent?.trim() ?? '',
            paciente_preview: pacFull.slice(0, 12) + (pacFull.length > 12 ? '…' : ''),
          })
        })
        return r
      })

      // Breakdown por fase para este día
      const fasesDelDia = new Map<string, number>()
      for (const r of dayRows) {
        const k = r.fase || '(empty)'
        fasesDelDia.set(k, (fasesDelDia.get(k) ?? 0) + 1)
      }
      byDay.set(fechaStr, fasesDelDia)

      const breakdown = Array.from(fasesDelDia.entries())
        .map(([f, n]) => `${f}=${n}`)
        .join(', ')
      console.log(`[discover]   ${dayRows.length} filas (${breakdown || 'ninguna'})`)
      allRows.push(...dayRows)
    }

    // Agrupar por fase
    const byFase = new Map<string, { count: number; example: RawRow | null }>()
    for (const row of allRows) {
      const key = row.fase || '(empty)'
      const existing = byFase.get(key)
      if (existing) {
        existing.count++
      } else {
        byFase.set(key, { count: 1, example: row })
      }
    }

    console.log('\n========== BREAKDOWN POR DÍA ==========')
    const dayKeys = Array.from(byDay.keys()).sort()
    for (const day of dayKeys) {
      const fases = byDay.get(day)!
      const total = Array.from(fases.values()).reduce((a, b) => a + b, 0)
      const detail = Array.from(fases.entries())
        .map(([f, n]) => `${JSON.stringify(f)}=${n}`)
        .join(', ')
      console.log(`  ${day} → ${total} filas ${total > 0 ? `(${detail})` : '(vacío)'}`)
    }

    console.log('\n========== AGREGADO POR FASE ==========')
    console.log(`Total filas extraídas: ${allRows.length}`)
    console.log(`Fases distintas: ${byFase.size}\n`)

    const sorted = Array.from(byFase.entries()).sort((a, b) => b[1].count - a[1].count)
    for (const [fase, info] of sorted) {
      const escaped = JSON.stringify(fase)
      console.log(`  ${escaped.padEnd(20)} → ${info.count} filas`)
      if (info.example) {
        const ex = info.example
        console.log(`    ejemplo: id=${ex.id} | fecha=${ex.fecha} | ${ex.procedimiento.slice(0, 40)} | ${ex.profesional.slice(0, 20)} | "${ex.paciente_preview}"`)
      }
    }

    console.log('\n========================================')
    console.log('Strings a confirmar para el mapeo del sync:')
    console.log('  Programado → null              (cita futura)')
    console.log('  Admitido   → "admitido"        (llegó, no facturado)')
    console.log('  Facturado  → "facturado"       (DISPARA ENCUESTA)')
    console.log('  Inasistente→ "inasistente"     (no-show)')
    console.log('Si el spelling real difiere, ajustar el mapeo antes de tocar el sync.')
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error('[discover] ERROR:', err)
  process.exit(1)
})
