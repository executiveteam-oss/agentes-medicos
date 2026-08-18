// Diagnóstico: ¿Haiku 4.5 llama tools con el setup del harness? Aislado, 1 turno.
// Prueba la hipótesis de que "0 tools en el agendamiento" es artefacto del harness.
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
loadEnvFile('.env.production.local'); loadEnvFile('.env.local'); loadEnvFile('.env.local.prod-backup')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const MODELS = { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5' } as const
// Paciente con TODOS los datos + doctor + día → check_availability es el paso obvio.
const DIRECT_MSG = 'Hola, soy María Gómez, CC 1088123456, nací el 15/03/1990, correo maria@gmail.com, vivo en Pereira, voy particular. Quiero una consulta de primera vez de ginecología con la Dra. Angélica Quintero el jueves en la mañana.'

async function main() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { createClient } = await import('@supabase/supabase-js')
  const { buildSystemPrompt, PROMPT_CACHE_SPLIT_ANCHOR } = await import('../src/agents/prompts/system-prompt')
  const { agentTools } = await import('../src/lib/anthropic/tools')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await db.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await db.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const { data: cts } = await db.from('consultation_types').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('doctor_id, created_at')

  const systemPrompt = buildSystemPrompt({
    clinic: clinic as any, doctor: (doctors as any[])[0], doctors: doctors as any[],
    waConfig: (clinic as any).whatsapp_config, consultationTypes: cts as any[],
    patientPhone: '+573001112233', patientName: 'María', existingPatient: null,
    escalateHumanByCt: new Set(), ageLimitsByCt: new Map(), patientConditionsByCt: new Map(), authConveniosByCt: new Map(),
  })
  const splitIdx = systemPrompt.indexOf(PROMPT_CACHE_SPLIT_ANCHOR)
  const systemBlocks = splitIdx > 0
    ? [{ type: 'text' as const, text: systemPrompt.slice(0, splitIdx), cache_control: { type: 'ephemeral' as const } },
       { type: 'text' as const, text: systemPrompt.slice(splitIdx) }]
    : [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }]
  const cachedTools = agentTools.map((t: any, i: number) => i === agentTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t)

  // #1 — longitud del array de tools que se pasa (idéntico a ambos modelos)
  console.log(`tools pasados en el request: ${cachedTools.length} → [${(agentTools as any[]).map((t) => t.name).join(', ')}]\n`)
  console.log(`mensaje directo: "${DIRECT_MSG.slice(0, 70)}..."\n`)

  for (const mk of ['haiku', 'sonnet'] as const) {
    const r = await anthropic.messages.create({
      model: MODELS[mk], max_tokens: 1024, thinking: { type: 'disabled' },
      system: systemBlocks as any, tools: cachedTools as any,
      messages: [{ role: 'user', content: DIRECT_MSG }],
    })
    const toolUses = r.content.filter((b: any) => b.type === 'tool_use') as any[]
    const texts = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
    console.log(`### ${mk.toUpperCase()} (${MODELS[mk]})`)
    console.log(`  stop_reason: ${r.stop_reason}`)   // #3
    console.log(`  tools llamadas: ${toolUses.length ? toolUses.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', ') : '(ninguna)'}`)  // #4
    console.log(`  texto: ${texts.slice(0, 220)}${texts.length > 220 ? '…' : ''}\n`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
