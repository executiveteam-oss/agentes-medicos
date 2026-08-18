/**
 * Verifica que el system prompt del agente renderice el teléfono nuevo de la
 * clínica, con los datos REALES de producción.
 *
 * Solo lectura: arma el prompt en memoria, no envía nada ni escribe en la DB.
 *
 * ⚠️ Imports dinámicos a propósito: los estáticos se hoistean por encima de
 * loadEnvFile() y `@/lib/supabase/admin` quedaría sin credenciales.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-telefono-prompt.ts
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const VIEJO = '3245820722'
const NUEVO = '+573046650214'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { buildSystemPrompt, PROMPT_CACHE_SPLIT_ANCHOR } = await import('@/agents/prompts/system-prompt')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true)
  if (!clinic || !doctors?.length) throw new Error('No se pudo cargar clínica o médicos')

  const prompt = buildSystemPrompt({
    clinic: clinic as never,
    doctor: doctors[0] as never,
    doctors: doctors as never,
    waConfig: clinic.whatsapp_config as never,
    patientPhone: '+570000000000',
    patientName: 'Verificación',
  })

  console.log('═══ Bloque INFO DEL CONSULTORIO, como lo ve el modelo ═══\n')
  const lineas = prompt.split('\n')
  const i = lineas.findIndex((l) => l.includes('INFO DEL CONSULTORIO'))
  console.log(lineas.slice(i, i + 7).join('\n'))

  console.log('\n═══ Chequeos ═══')
  console.log('¿aparece el número VIEJO?  ', prompt.includes(VIEJO) ? '❌ SÍ' : '✅ no')
  console.log('¿aparece el número NUEVO?  ', prompt.includes(NUEVO) ? '✅ sí' : '❌ NO')
  console.log('ocurrencias del viejo      :', prompt.split(VIEJO).length - 1)
  console.log('ocurrencias del nuevo      :', prompt.split(NUEVO).length - 1)

  // ¿La línea del teléfono cae en el bloque CACHEADO o en el dinámico?
  const anchor = prompt.indexOf(PROMPT_CACHE_SPLIT_ANCHOR)
  const posTel = prompt.indexOf(NUEVO)
  console.log('bloque del teléfono        :', posTel < anchor ? 'CACHEADO (prefijo estable)' : 'dinámico')
}
main().catch((e) => { console.error(e); process.exit(1) })
