/**
 * Trigger MANUAL del sync iSalud (UN solo run, monitoreado en vivo).
 *
 * - Llama syncAllISaludIntegrations() — exactamente el mismo entry point del cron.
 * - Logs RUN START/END con duración y reachedTerminal son visibles en stdout.
 * - Estado terminal (idle/error) se verifica desde la DB tras el run.
 * - No reintenta. No reactiva nada. Solo dispara una pasada.
 *
 * Run: NODE_ENV=development TZ=America/Bogota npx tsx scripts/run-isalud-sync-manual.ts
 */

import { syncAllISaludIntegrations } from '../src/lib/isalud/sync-agent'

async function main() {
  console.log('=== MANUAL iSalud sync — UN SOLO RUN ===')
  console.log(`Script start: ${new Date().toISOString()}`)
  console.log(`TZ: ${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`)
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`)
  console.log('')

  const t0 = Date.now()
  let result: { synced: number; errors: string[] }
  try {
    result = await syncAllISaludIntegrations()
  } catch (err) {
    console.error('')
    console.error('=== SCRIPT-LEVEL FATAL ===')
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    console.error(`Stack: ${err instanceof Error ? err.stack : ''}`)
    console.error('IMPORTANTE: syncAllISaludIntegrations tiene finally con persistSyncError.')
    console.error('Verificá DB: sync_integrations.sync_status debería ser "error", no "running".')
    process.exit(1)
  }

  const durationS = (Date.now() - t0) / 1000
  console.log('')
  console.log('=== SCRIPT-LEVEL RESULT ===')
  console.log(`Total duration: ${durationS.toFixed(2)}s`)
  console.log(`Integrations synced: ${result.synced}`)
  console.log(`Errors at top-level: ${result.errors.length}`)
  if (result.errors.length > 0) {
    result.errors.forEach((e, i) => console.log(`  [${i}] ${e}`))
  }
  console.log('')
  console.log('Próximo paso: verificar estado en sync_integrations y delta en appointments.')
}

main().catch((e) => {
  console.error('UNHANDLED:', e)
  process.exit(1)
})
