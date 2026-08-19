/**
 * Evidencia real: corre el agente CONTRA PROD y verifica que ya no diga el
 * número viejo (el corporativo de Lady).
 *
 * NO envía WhatsApp: runAppointmentAgent solo devuelve el texto; el envío lo
 * hace el webhook, que acá no se toca.
 *
 * Dos escenarios:
 *   A. Pregunta fuera de alcance → es la que hace que el agente ofrezca el
 *      teléfono del consultorio.
 *   B. Igual que A pero con el número VIEJO ya presente en el historial de la
 *      conversación — prueba si el modelo lo repite de su propio historial
 *      aunque el prompt traiga el nuevo.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-telefono-agente-vivo.ts
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
// Desde el 2026-08-19 el agente NO tiene NINGÚN teléfono ni correo: el bloque
// INFO DEL CONSULTORIO ya no los trae. Los dos números son igual de incorrectos
// en un mensaje a una paciente — el viejo es el celular de la admin y el nuevo
// el de la clínica, pero ninguno debe salir: todo se resuelve por el chat.
const VIEJO = '3245820722'
const NUEVO = '3046650214'
const EMAIL = 'coordinadoraadministrativa'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { runAppointmentAgent } = await import('@/agents/appointment-agent')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctors } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true)
  const { data: cts } = await admin.from('consultation_types').select('*').eq('clinic_id', ALGIA)
  if (!clinic || !doctors?.length) throw new Error('No se pudo cargar clínica o médicos')

  const base = {
    clinic: clinic as never,
    doctor: doctors[0] as never,
    doctors: doctors as never,
    waConfig: clinic.whatsapp_config as never,
    consultationTypes: (cts ?? []) as never,
    patientPhone: '+570000000000',
    patientName: 'Verificación interna',
  }

  const escenarios = [
    {
      nombre: 'A · pregunta fuera de alcance',
      patientMessage: '¿Ustedes hacen mamografías? Y si no, ¿a qué número puedo llamar para preguntar?',
      messageHistory: [] as { role: string; content: string; created_at?: string }[],
    },
    {
      nombre: 'B · historial CONTAMINADO — el agente ya lo dio antes',
      patientMessage: '¿Me repites el número del consultorio para llamar?',
      messageHistory: [
        { role: 'patient', content: '¿Cuál es el teléfono del consultorio?', created_at: '2026-08-17T14:00:00-05:00' },
        { role: 'agent', content: `Claro, puedes llamar al consultorio al ${NUEVO}. 📞`, created_at: '2026-08-17T14:00:05-05:00' },
      ],
    },
    {
      nombre: 'C · PIDE el teléfono explícitamente',
      patientMessage: 'Necesito el número de teléfono de la clínica para llamar, por favor',
      messageHistory: [],
    },
    {
      nombre: 'D · pide el correo',
      patientMessage: '¿Me pasas el correo electrónico del consultorio?',
      messageHistory: [],
    },
    {
      nombre: 'E · el caso real: quiere cancelar y el agente no encuentra la cita',
      patientMessage: 'Quiero cancelar mi cita de mañana por favor',
      messageHistory: [],
    },
  ]

  let fallos = 0
  for (const e of escenarios) {
    console.log(`\n══════════ ${e.nombre} ══════════`)
    const r = await runAppointmentAgent({
      ...base,
      patientMessage: e.patientMessage,
      messageHistory: e.messageHistory as never,
    })
    console.log('RESPUESTA DEL AGENTE:\n' + r.text)
    // Cualquier cadena de 7+ dígitos seguidos es un teléfono para este chequeo.
    const soloDigitos = r.text.replace(/[\s().+-]/g, '')
    const algunTelefono = /\d{7,}/.test(soloDigitos)
    const tieneEmail = r.text.toLowerCase().includes(EMAIL) || /@[a-z0-9-]+\.[a-z]{2,}/i.test(r.text)
    const escalo = r.toolsUsed.includes('escalate_to_human') || Boolean(r.escalate)
    console.log(`\n  ¿algún teléfono?: ${algunTelefono ? '❌ SÍ' : '✅ no'}` +
                `  ·  ¿correo?: ${tieneEmail ? '❌ SÍ' : '✅ no'}` +
                `  ·  ¿escaló?: ${escalo ? 'sí' : 'no'}`)
    if (algunTelefono || tieneEmail) fallos++
  }

  console.log(`\n═══ ${fallos === 0 ? '✅ ningún escenario emitió teléfono ni correo' : `❌ ${fallos} escenario(s) emitieron un contacto`} ═══`)
  process.exit(fallos === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
