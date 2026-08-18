/**
 * El guard 6 con HECHOS REALES de la tool en prod + los textos que el agente
 * escribió de verdad el 2026-08-18. Verifica la cadena completa: lo que la
 * tool devuelve hoy contra lo que el modelo dijo entonces.
 * Run: TZ=America/Bogota npx tsx scripts/test-guard6-forzado.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE = '069523a9-f13b-4268-a77c-514d54c5672c'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('@/agents/tools/executor')
  const { detectDatosSinRespaldo } = await import('@/lib/whatsapp/agent-guards')
  const { esMonologoInterno } = await import('@/lib/whatsapp/strip-internal-monologue')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: docs } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true)
  const jorge = docs!.find((d) => d.id === JORGE)!

  // Hechos REALES: lo que la tool devuelve hoy para Jorge un jueves
  const r = await executeTool('check_availability', { preferred_date: '2026-08-20', doctor_id: JORGE },
    ALGIA, clinic as never, jorge as never, { doctor_id: JORGE, doctor_name: jorge.name }) as { data?: Record<string, unknown> }
  const d = r.data ?? {}
  const hechos = {
    diasQueAtiende: [String(d.dias_que_atiende ?? '')].filter(Boolean),
    fechasDeTools: ((d.proximas_fechas as { fecha: string }[] | null) ?? []).map((f) => f.fecha),
    minutosDeSlots: [], huboSlots: false,
  }
  console.log('HECHOS REALES de la tool (prod):')
  console.log(`  días  : ${JSON.stringify(hechos.diasQueAtiende)}`)
  console.log(`  fechas: ${JSON.stringify(hechos.fechasDeTools)}\n`)

  const CASOS = [
    ['① lo que dijo el 18/08 (días inventados)',
     'El Dr. JORGE DARIO LOPEZ ISANOA no atiende los jueves. Atiende lunes, martes, miércoles, viernes y sábado.', true],
    ['② lo que dijo después (fechas inventadas)',
     'Te propongo con el Dr. Jorge Dario: lunes 19 de agosto, miércoles 21 de agosto o viernes 22 de agosto.', true],
    ['③ lo que dice AHORA (correcto)',
     'El Dr. Jorge Dario no atiende los jueves. Él atiende lunes, miércoles y viernes de 7:30 a 11:00 AM. Las próximas fechas: viernes 21 de agosto, lunes 24 de agosto, miércoles 26 de agosto.', false],
  ] as const

  for (const [label, texto, debeBloquear] of CASOS) {
    const g = detectDatosSinRespaldo({ agentText: texto, hechos, anioRef: 2026 })
    const bien = g.blocked === debeBloquear
    console.log(`${bien ? '✅' : '❌'} ${label}`)
    console.log(`   ${g.blocked ? `🛑 BLOQUEA — ${g.reason} · ${JSON.stringify(g.details)}` : 'pasa'}\n`)
  }

  console.log('MONÓLOGO — lo que salió en la corrida en vivo de recién:')
  const mono = 'Disculpa, Carolina. Necesito usar el doctor ID correcto. Déjame revisar de nuevo.'
  console.log(`  "${mono}"`)
  console.log(`  ${esMonologoInterno(mono) ? '✅ lo atrapa el strip' : '❌ NO lo atrapa'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
