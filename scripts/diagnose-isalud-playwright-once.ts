/**
 * Diagnóstico de UN SOLO intento de login con Playwright contra iSalud.
 *
 * - Lee credenciales del DB (no imprime ni usuario completo ni clave)
 * - Llama loginAndInjectCookies (nueva implementación Playwright-native)
 * - Reporta: postUrl tras submit, finalUrl tras /disponibilidad, title, primeras filas
 * - UN intento. Sin retries. Sin escribir en DB. Sin reactivar cron.
 *
 * Run: TZ=America/Bogota npx tsx scripts/diagnose-isalud-playwright-once.ts
 */

import { createClient } from '@supabase/supabase-js'
import { launchBrowserAndContext, loginAndInjectCookies, type ISaludCredentials } from '../src/lib/isalud/adapter'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main() {
  console.log('=== iSalud Playwright Login — UN SOLO INTENTO ===')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`TZ: ${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`)
  console.log('')

  // 1. Read creds from DB
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) { console.error('Missing Supabase env vars'); process.exit(1) }

  const admin = createClient(supaUrl, supaKey)
  const { data: integration, error } = await admin
    .from('sync_integrations')
    .select('credentials, sync_status')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('provider', 'isalud')
    .single()

  if (error || !integration) { console.error('No integration found:', error?.message); process.exit(1) }
  const creds = integration.credentials as ISaludCredentials
  console.log(`Integration sync_status: ${integration.sync_status} (esperado: disabled)`)
  console.log(`Subdomain: ${creds.subdomain}`)
  console.log(`Username length: ${creds.username.length}, password length: ${creds.password.length}`)
  console.log('')

  // 2. Launch browser
  console.log('--- Launching browser + context ---')
  const tLaunch = Date.now()
  const { browser, context } = await launchBrowserAndContext()
  console.log(`Browser launched in ${Date.now() - tLaunch}ms`)
  console.log('')

  try {
    // 3. Login (UN solo intento)
    console.log('--- loginAndInjectCookies (Playwright-native, UN intento) ---')
    const tLogin = Date.now()
    const page = await loginAndInjectCookies(context, creds)
    console.log(`Login + post-login navigation completed in ${Date.now() - tLogin}ms`)
    console.log('')

    // 4. Estado tras login (la función ya navegó a /disponibilidad)
    const finalUrl = page.url()
    const title = await page.title()
    const stillHasLoginForm = (await page.locator('input[name="login[Usuario]"]').count()) > 0
    console.log('--- Estado post-login ---')
    console.log(`  finalUrl: ${finalUrl}`)
    console.log(`  title: "${title}"`)
    console.log(`  ¿form de login aún presente? ${stillHasLoginForm}`)
    console.log('')

    // 5. Inspección estructural — aplica el MISMO filtro que el scraper de producción
    //    (adapter.ts:240-257): cells.length >= 7 Y cells[5] (profesional) con length > 3.
    //    Esto excluye el datepicker (calendar widget tiene 7 celdas pero cells[5] es un número).
    console.log('--- Inspección de tabla en /disponibilidad (filtro idéntico al scraper) ---')
    const pageInfo = await page.evaluate(() => {
      const tables = document.querySelectorAll('table')
      const allTbodyRows = document.querySelectorAll('table tbody tr')
      const headers: string[] = []
      document.querySelectorAll('table thead th').forEach((th) => { headers.push((th.textContent ?? '').trim()) })

      let calendarRows = 0
      const dataRows: Array<{ id: string; fecha: string; horaInicial: string; horaFinal: string; duracion: string; profesional: string; punto: string }> = []

      allTbodyRows.forEach((row) => {
        const cells = row.querySelectorAll('td')
        if (cells.length < 7) { calendarRows++; return }
        const profesional = (cells[5]?.textContent ?? '').trim()
        if (profesional.length <= 3) { calendarRows++; return }
        dataRows.push({
          id:           (cells[0]?.textContent ?? '').trim(),
          fecha:        (cells[1]?.textContent ?? '').trim(),
          horaInicial:  (cells[2]?.textContent ?? '').trim(),
          horaFinal:    (cells[3]?.textContent ?? '').trim(),
          duracion:     (cells[4]?.textContent ?? '').trim(),
          profesional,
          punto:        (cells[6]?.textContent ?? '').trim(),
        })
      })

      const bodyPreview = (document.body.innerText ?? '').slice(0, 300)
      return { tableCount: tables.length, totalRows: allTbodyRows.length, calendarRows, dataRows, headers, bodyPreview }
    })

    console.log(`  Tablas: ${pageInfo.tableCount}`)
    console.log(`  Filas tbody TOTAL: ${pageInfo.totalRows}`)
    console.log(`  Filas descartadas (calendario/widget): ${pageInfo.calendarRows}`)
    console.log(`  Filas de DATOS reales: ${pageInfo.dataRows.length}`)
    console.log('')

    if (pageInfo.dataRows.length > 0) {
      console.log(`  Primeras ${Math.min(5, pageInfo.dataRows.length)} filas de datos:`)
      pageInfo.dataRows.slice(0, 5).forEach((r, i) => {
        console.log(`    [${i}] id=${r.id} | fecha=${r.fecha} | ${r.horaInicial}→${r.horaFinal} (${r.duracion}min) | ${r.profesional} | ${r.punto}`)
      })
      console.log('')

      // Validación de parsing — fechas, horas, nombres
      console.log('  --- Validación de campos ---')
      const fechaRegex = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/
      const horaRegex = /^\d{1,2}:\d{2}(:\d{2})?$/
      const sampleSize = Math.min(5, pageInfo.dataRows.length)
      let fechasOk = 0, horasIniOk = 0, horasFinOk = 0, profesionalOk = 0
      for (const r of pageInfo.dataRows.slice(0, sampleSize)) {
        if (fechaRegex.test(r.fecha)) fechasOk++
        if (horaRegex.test(r.horaInicial)) horasIniOk++
        if (horaRegex.test(r.horaFinal)) horasFinOk++
        if (r.profesional.length >= 5 && /[A-ZÁÉÍÓÚÑa-záéíóúñ]/.test(r.profesional)) profesionalOk++
      }
      console.log(`    Fechas en formato YYYY-MM-DD ó DD/MM/YYYY:   ${fechasOk}/${sampleSize}`)
      console.log(`    Horas iniciales en formato HH:MM[:SS]:        ${horasIniOk}/${sampleSize}`)
      console.log(`    Horas finales en formato HH:MM[:SS]:          ${horasFinOk}/${sampleSize}`)
      console.log(`    Profesionales con nombre legible (>=5 chars): ${profesionalOk}/${sampleSize}`)
    } else {
      console.log(`  ⚠️  Sin filas de datos. Body preview: ${pageInfo.bodyPreview.slice(0, 200)}`)
    }
    console.log('')

    // 6. Veredicto del single-shot
    console.log('=== VEREDICTO ===')
    const loginNavigatedAwayFromRoot = !finalUrl.endsWith('isalud.co/') && !finalUrl.endsWith('isalud.co')
    const dataRowsPresent = pageInfo.dataRows.length > 0
    console.log(`  ¿Login navegó a página interna (no /)?  ${loginNavigatedAwayFromRoot ? '✅ SÍ' : '❌ NO'}  (finalUrl: ${finalUrl})`)
    console.log(`  ¿/disponibilidad sin form de login?       ${!stillHasLoginForm ? '✅ SÍ' : '❌ NO'}`)
    console.log(`  ¿Filas de datos reales (post-filtro)?     ${dataRowsPresent ? `✅ SÍ (${pageInfo.dataRows.length})` : '❌ NO'}`)
  } finally {
    // Cleanup garantizado
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    console.log('')
    console.log('Browser cerrado.')
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error('Stack:', e instanceof Error ? e.stack : '')
  process.exit(1)
})
