/**
 * ¿El agente sigue inventando los días? Contra el LLM y la config REALES.
 * NO envía WhatsApp. Run: TZ=America/Bogota npx tsx scripts/test-dias-agente-vivo.ts
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
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)

  const GUION = [
    'Hola, quiero cita con el doctor Jorge Dario, particular, para el jueves',
    'Sí, soy Carolina Restrepo',
    'Consulta de primera vez de ginecología',
    'Carolina Restrepo, CC 1088123456, 15/03/1990, Calle 10 # 5-20 Pereira',
    'No',
    'Quiero el jueves 20 de agosto por favor',
    '¿Y qué días atiende él entonces?',
  ]
  const historia: { role: string; content: string; created_at: string }[] = []
  let pin: { doctor_id: string; doctor_name: string } | null = null

  for (let i = 0; i < GUION.length; i++) {
    if (!pin) pin = detectarMencionDeMedico(GUION[i], doctors!, { nombrePaciente: 'Carolina Restrepo' })
    const ts = new Date(Date.parse('2026-08-18T16:00:00-05:00') + i * 60000).toISOString()
    console.log(`\n${'─'.repeat(70)}\n👤 ${GUION[i]}`)
    const r = await runAppointmentAgent({
      clinic: clinic as never, doctor: doctors![0] as never, doctors: doctors as never,
      waConfig: clinic!.whatsapp_config as never, consultationTypes: (cts ?? []) as never,
      patientPhone: '+570000000001', patientName: 'Carolina Restrepo',
      patientMessage: GUION[i], messageHistory: historia as never, pinMedico: pin,
    })
    console.log(`🤖 ${r.text}`)
    historia.push({ role: 'patient', content: GUION[i], created_at: ts })
    historia.push({ role: 'agent', content: r.text, created_at: ts })

    const t = r.text.toLowerCase()
    // OJO: "no atiende los jueves" es CORRECTO. Sólo cuenta como inventado si
    // el día aparece en una afirmación POSITIVA de atención.
    const inventados = ['martes', 'jueves', 'sábado', 'sabado', 'domingo']
      .filter((d) => new RegExp(`(?<!no )atiende(?![^.]*\\bno\\b)[^.]*${d}`).test(t)
                  || new RegExp(`consulta los[^.]*${d}`).test(t))
    if (/atiende/.test(t)) {
      console.log(inventados.length === 0
        ? '   ✅ no nombra ningún día que Jorge NO atienda'
        : `   ❌ nombra días inventados: ${inventados.join(', ')}`)
      const reales = ['lunes','miércoles','viernes'].filter((d) => t.includes(d))
      console.log(`   días reales mencionados: ${reales.join(', ') || '(ninguno)'}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
