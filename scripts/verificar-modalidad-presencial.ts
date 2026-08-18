/**
 * Modalidad — verificación en vivo. SOLO LECTURA: no envía WhatsApp y no
 * escribe en la DB (runAppointmentAgent devuelve el texto; el envío lo hace el
 * webhook, que acá no se toca).
 *
 * Corre la pregunta REAL que hizo una paciente el 2026-08-18 y que el agente
 * contestó mal ("Claro, podemos agendar tu terapia de forma virtual").
 *
 * ⚠️ Imports dinámicos a propósito: los estáticos se hoistean por encima de
 * loadEnvFile() y `@/lib/supabase/admin` quedaría sin credenciales.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-modalidad-presencial.ts
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

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { buildSystemPrompt } = await import('@/agents/prompts/system-prompt')
  const { runAppointmentAgent } = await import('@/agents/appointment-agent')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true)
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)
  if (!clinic || !doctors?.length) throw new Error('No pude cargar clínica o médicos — abortando')

  const virtuales = (cts ?? []).filter((c) => c.modality === 'virtual' || c.modality === 'ambas')
  console.log(`servicios virtuales en el catálogo: ${virtuales.length} de ${cts?.length ?? 0}`)
  console.log(`virtual_config.enabled            : ${JSON.stringify((clinic.virtual_config as Record<string, unknown>)?.enabled)}`)

  const base = {
    clinic: clinic as never, doctor: doctors[0] as never, doctors: doctors as never,
    waConfig: clinic.whatsapp_config as never, consultationTypes: (cts ?? []) as never,
    patientPhone: '+570000000000', patientName: 'Verificación interna',
  }

  console.log('\n═══ 1. El bloque, como lo ve el modelo ═══')
  const prompt = buildSystemPrompt(base as never)
  const i = prompt.indexOf('MODALIDAD DE LAS CONSULTAS')
  console.log(i < 0 ? '❌ el bloque NO aparece' : prompt.slice(i, i + 460))

  console.log('\n═══ 2. La pregunta real de la paciente (18/08 13:04) ═══')
  const casos = [
    'Hola, quería saber si debido a todo lo que ha pasado estos días, la terapia se puede hacer virtualmente?',
    'Es que quiero cita online porque soy de Monterrey',
  ]
  let fallos = 0
  for (const patientMessage of casos) {
    const r = await runAppointmentAgent({ ...base, patientMessage, messageHistory: [] } as never)
    console.log(`\n─ paciente: "${patientMessage.slice(0, 62)}…"`)
    console.log(`  agente  : ${r.text.replace(/\n/g, '\n            ').slice(0, 420)}`)
    // Falla si PROMETE virtual. Mencionar la palabra para negarla es correcto.
    const promete = /(podemos|puedo|se puede|te agendo|claro).{0,40}(virtual|videollamada|online)/i.test(r.text)
      || /cita virtual confirmada/i.test(r.text)
    console.log(`  ¿promete virtual?: ${promete ? '❌ SÍ' : '✅ no'}`)
    if (promete) fallos++
  }
  console.log(`\n═══ ${fallos === 0 ? '✅ ningún caso prometió virtual' : `❌ ${fallos} caso(s) lo prometieron`} ═══`)
  process.exit(fallos === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
