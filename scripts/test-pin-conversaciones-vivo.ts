/**
 * Las tres capas contra el LLM REAL y la config REAL de prod.
 *
 * NO envía WhatsApp (runAppointmentAgent solo devuelve texto) y las
 * conversaciones se cortan ANTES de confirmar, así que no crean citas.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-pin-conversaciones-vivo.ts
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

const ALGIA  = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JUANDI = '97a20f5e-4aac-48d0-bef9-4240e666dca5'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { runAppointmentAgent } = await import('@/agents/appointment-agent')
  const { detectarMencionDeMedico } = await import('@/lib/agent/doctor-pin')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)

  const escenarios = [
    { n: '1 · CASO LINA (el que rompió): cistitis + "doctor Jorge Dario"',
      msg: 'Hola buenas tardes...para sacar cita revisión por cistitis con el doctor Jorge Dario ...esta semana porfa es que estoy delicada',
      paciente: 'Lina Marcela Gallego Londoño', esperaPin: 'JORGE' },
    { n: '2 · CASO LUISA: primera vez con Jorge (servicio que SÍ tiene)',
      msg: 'Buenas, quiero una consulta de primera vez de ginecología con el doctor Jorge Isanoa, particular',
      paciente: 'Luisa María García Montes', esperaPin: 'JORGE' },
    { n: '3 · CONTROL: pide a Juan Diego (debe funcionar igual que siempre)',
      msg: 'Hola, quiero un control o seguimiento con el doctor Juan Diego Villegas',
      paciente: 'Paciente Prueba', esperaPin: 'JUAN DIEGO' },
    { n: '4 · CONTROL: sin nombrar médico (no debe pinear ni romperse)',
      msg: 'Hola, quisiera agendar una cita de ginecología para esta semana',
      paciente: 'Paciente Prueba', esperaPin: null },
  ]

  for (const e of escenarios) {
    console.log(`\n${'═'.repeat(72)}\n${e.n}\n${'═'.repeat(72)}`)
    const pin = detectarMencionDeMedico(e.msg, doctors!, { nombrePaciente: e.paciente })
    console.log(`📌 pin detectado: ${pin ? pin.doctor_name : '(ninguno)'}`)
    const pinOk = e.esperaPin === null ? pin === null : !!pin && pin.doctor_name.toUpperCase().includes(e.esperaPin)
    console.log(`   ${pinOk ? '✅' : '❌'} pin esperado: ${e.esperaPin ?? '(ninguno)'}`)

    const r = await runAppointmentAgent({
      clinic: clinic as never, doctor: doctors![0] as never, doctors: doctors as never,
      waConfig: clinic!.whatsapp_config as never, consultationTypes: (cts ?? []) as never,
      patientPhone: '+570000000001', patientName: e.paciente,
      patientMessage: e.msg, messageHistory: [],
      pinMedico: pin,
    })

    console.log(`\n💬 RESPUESTA:\n${r.text}\n`)
    const usados = r.toolCalls.map((c) => {
      const i = c.input as Record<string, unknown>
      return `${c.tool}(doctor_id=${String(i.doctor_id ?? '—').slice(0, 8)})`
    })
    console.log(`🔧 tools: ${usados.join(', ') || '(ninguna)'}`)
    if (r.escalate) console.log(`🚨 escala: ${r.escalate.reason}`)

    const tocóJuanDiego = r.toolCalls.some((c) => String((c.input as Record<string, unknown>).doctor_id ?? '') === JUANDI)
    if (e.esperaPin === 'JORGE') {
      console.log(`   ${!tocóJuanDiego ? '✅' : '❌'} NO consultó con Juan Diego`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
