/**
 * REPRODUCCIÓN COMPLETA del caso que rompió (Lina Marcela, 2026-08-17),
 * turno por turno, contra el LLM y la config REALES de prod.
 *
 * Lo que pasó sin las capas:
 *   check_availability(doctor_id=JUAN DIEGO) ×5  →  cita creada con Juan Diego.
 * Lo que tiene que pasar ahora:
 *   ninguna tool con Juan Diego, y al pedir "control o seguimiento" —que Jorge
 *   NO presta— decírselo y escalar, sin mudarla de médico.
 *
 * NO envía WhatsApp. Si alguna cita llegara a crearse, el script la reporta
 * en rojo al final (no debería: el flujo choca con la capa 2 antes).
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-pin-conversacion-lina.ts
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
const JORGE  = '069523a9-f13b-4268-a77c-514d54c5672c'
const PACIENTE = 'Lina Marcela Gallego Londoño'

// El guion real de la paciente, mensaje por mensaje.
// Va directo al servicio que NO existe bajo Jorge ("control o seguimiento por
// ginecología" solo lo tienen Juan Diego y Angélica). Es el punto exacto donde
// el 2026-08-17 el modelo se mudó de médico.
const GUION = [
  'Hola buenas tardes, quiero agendar una CONSULTA DE CONTROL O DE SEGUIMIENTO POR ESPECIALISTA EN GINECOLOGIA con el doctor Jorge Dario, esta semana porfa que estoy delicada',
  'Sí, soy Lina Marcela Gallego Londoño',
  'Voy como particular',
  'Lina Marcela gallego Londoño, CC 1088296082, 17 enero 1992, Balcones de Villa verde',
  'No',
  'Sí, ese mismo, el control o seguimiento de ginecología con el doctor Jorge',
  'El miércoles en la mañana por favor',
]

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { runAppointmentAgent } = await import('@/agents/appointment-agent')
  const { detectarMencionDeMedico } = await import('@/lib/agent/doctor-pin')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)

  const historia: { role: string; content: string; created_at: string }[] = []
  let pin: { doctor_id: string; doctor_name: string } | null = null
  const todasLasTools: { tool: string; doctorId: string }[] = []
  let escalo: string | null = null
  let citaCreada: string | null = null

  for (let i = 0; i < GUION.length; i++) {
    const msg = GUION[i]
    const ts = new Date(Date.parse('2026-08-19T15:00:00-05:00') + i * 60000).toISOString()

    // Lo mismo que hace el webhook: el primero que pinea, gana.
    if (!pin) {
      const d = detectarMencionDeMedico(msg, doctors!, { nombrePaciente: PACIENTE })
      if (d) { pin = d; console.log(`\n📌 PIN → ${d.doctor_name}`) }
    }

    console.log(`\n${'─'.repeat(70)}\n👤 ${msg.split('\n')[0].slice(0, 90)}`)
    const r = await runAppointmentAgent({
      clinic: clinic as never, doctor: doctors![0] as never, doctors: doctors as never,
      waConfig: clinic!.whatsapp_config as never, consultationTypes: (cts ?? []) as never,
      patientPhone: '+570000000001', patientName: PACIENTE,
      patientMessage: msg, messageHistory: historia as never,
      pinMedico: pin,
    })
    console.log(`🤖 ${r.text}`)

    for (const c of r.toolCalls) {
      const did = String((c.input as Record<string, unknown>).doctor_id ?? '')
      todasLasTools.push({ tool: c.tool, doctorId: did })
      const quien = did === JUANDI ? '⛔ JUAN DIEGO' : did === JORGE ? '✅ Jorge' : did ? did.slice(0, 8) : '—'
      console.log(`   🔧 ${c.tool} → ${quien}`)
    }
    if (r.escalate) { escalo = r.escalate.reason; console.log(`   🚨 ESCALA: ${r.escalate.reason}`) }
    if (r.appointmentData) { citaCreada = r.appointmentData.id; console.log(`   📅 CITA CREADA: ${r.appointmentData.doctor_name}`) }

    historia.push({ role: 'patient', content: msg, created_at: ts })
    historia.push({ role: 'agent', content: r.text, created_at: ts })
    if (escalo) break
  }

  console.log(`\n${'═'.repeat(70)}\nVEREDICTO\n${'═'.repeat(70)}`)
  // OJO al leer esto: una tool con Juan Diego NO es un fallo — el executor la
  // rechaza (success=false) y el modelo reintenta con Jorge. Lo que importa es
  // que ningún horario suyo llegue a la paciente y que no se cree la cita.
  const conJuanDiego = todasLasTools.filter((t) => t.doctorId === JUANDI)
  console.log(`  ℹ️  intentos con JUAN DIEGO: ${conJuanDiego.length} — todos rechazados por el pin (ver success=false arriba)`)
  console.log(`  ${escalo ? '✅' : '⚠️ '} escaló: ${escalo ?? 'no'}`)
  console.log(`  ${!citaCreada ? '✅' : '❌'} cita creada: ${citaCreada ?? 'ninguna'}`)
  if (citaCreada) {
    console.log(`\n  ⚠️  Se creó la cita ${citaCreada} — BORRALA a mano si no la querés.`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
