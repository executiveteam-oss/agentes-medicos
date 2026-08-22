/**
 * ¿Dispara el GUARD 6 contra el LLM real? Fuerza el caso de las fechas.
 *
 * NO envía WhatsApp: corre el agente y pasa su salida por el guard, igual que
 * hace el webhook. Lo que se mide es si el guard atrapa una fecha inventada.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-guard6-vivo.ts
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

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { runAppointmentAgent } = await import('@/agents/appointment-agent')
  const { detectarMencionDeMedico } = await import('@/lib/agent/doctor-pin')
  const { detectDatosSinRespaldo } = await import('@/lib/whatsapp/agent-guards')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)

  const GUION = [
    'Hola, quiero cita con el doctor Jorge Dario, particular',
    'Sí, soy Carolina Restrepo',
    'Consulta de primera vez de ginecología',
    'Carolina Restrepo, CC 1088123456, 15/03/1990, Calle 10 # 5-20 Pereira',
    'No',
    'Quiero el jueves 20 de agosto',
    'Dame las tres fechas más próximas con día y número, por favor',
  ]
  const historia: { role: string; content: string; created_at: string }[] = []
  let pin: { doctor_id: string; doctor_name: string } | null = null
  const anioRef = 2026
  let disparos = 0

  for (let i = 0; i < GUION.length; i++) {
    if (!pin) pin = detectarMencionDeMedico(GUION[i], doctors!, { nombrePaciente: 'Carolina Restrepo' })
    const ts = new Date(Date.parse('2026-08-18T16:30:00-05:00') + i * 60000).toISOString()
    const r = await runAppointmentAgent({
      clinic: clinic as never, doctor: doctors![0] as never, doctors: doctors as never,
      waConfig: clinic!.whatsapp_config as never, consultationTypes: (cts ?? []) as never,
      patientPhone: '+570000000001', patientName: 'Carolina Restrepo',
      patientMessage: GUION[i], messageHistory: historia as never, pinMedico: pin,
    })

    const g = detectDatosSinRespaldo({ agentText: r.text, hechos: r.hechosDeTools, hoyCOT: '2026-08-22' })
    console.log(`\n${'─'.repeat(70)}\n👤 ${GUION[i]}\n🤖 ${r.text.slice(0, 400)}`)
    if (r.hechosDeTools?.diasQueAtiende.length || r.hechosDeTools?.huboSlots) {
      console.log(`   📊 tool dijo → días: ${JSON.stringify(r.hechosDeTools.diasQueAtiende)} · slots: ${r.hechosDeTools.minutosDeSlots.length}`)
    }
    if (g.blocked) { disparos++; console.log(`   🛑 GUARD 6 DISPARÓ — ${g.reason}\n      ${JSON.stringify(g.details)}`) }
    else console.log('   ✅ guard 6 no bloquea')

    historia.push({ role: 'patient', content: GUION[i], created_at: ts })
    historia.push({ role: 'agent', content: r.text, created_at: ts })
  }
  console.log(`\n═══ el guard disparó ${disparos} vez/veces en ${GUION.length} turnos ═══`)
}
main().catch((e) => { console.error(e); process.exit(1) })
