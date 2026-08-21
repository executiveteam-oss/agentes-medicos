/**
 * Plantilla contacto_general a pacientes con cita futura que NUNCA escribieron.
 *
 * POR QUÉ: dos personas del equipo de Algia (la gerente y la dueña) tenían el
 * número VIEJO del agente y sus mensajes nunca llegaban. Una plantilla saliente
 * restablece la sesión del lado correcto — verificado con la gerente el 20/08:
 * delivered en 24s, y respondió ocho minutos después.
 *
 * ⚠️ NO manda a todo el mundo. Recibe cuántos días de anticipación como
 * argumento y sólo alcanza a las citas dentro de esa ventana. Se decidió así
 * porque la bandeja de Atención ya tiene 51 conversaciones sin atender: sumarle
 * escalaciones nuevas a una fila que nadie trabaja no mejora nada.
 *
 * Run: TZ=America/Bogota npx tsx scripts/enviar-contacto-general.ts <dias> [--enviar]
 *      Sin --enviar hace DRY RUN: lista a quién le mandaría y no manda nada.
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV='development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TEXTO='Tienes una cita agendada con nosotros. Por este chat puedes confirmarla, cambiar la fecha o resolver cualquier duda — respóndenos cuando quieras.'

async function main(): Promise<void> {
  const dias = parseInt(process.argv[2] ?? '3', 10)
  const enviarDeVerdad = process.argv.includes('--enviar')
  const supa=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { sendWhatsAppTemplate } = await import('../src/lib/whatsapp/client')
  const { toTitleCase } = await import('../src/lib/utils/normalize-name')

  const { data: c } = await supa.from('clinics')
    .select('whatsapp_phone_id, whatsapp_access_token, name').eq('id', ALGIA).single()

  // 🔴 LA SELECCIÓN ARRANCA POR LAS CITAS, NO POR LOS PACIENTES.
  //
  // La primera versión traía `patients` sin filtro y filtraba en memoria.
  // Supabase corta en 1.000 filas y Algia tiene 14.870: el dry run devolvió 2
  // pacientes en vez de 7, y ninguno era el correcto. Arrancar por la ventana
  // de citas —que son decenas— hace que no haya nada que truncar.
  const limite = new Date(Date.now() + dias*24*3600*1000).toISOString()
  const { data: citas } = await supa
    .from('appointments')
    .select('patient_id, starts_at')
    .eq('clinic_id', ALGIA)
    .in('status', ['confirmed','blocked_external'])
    .gte('starts_at', new Date().toISOString())
    .lte('starts_at', limite)
    .not('patient_id', 'is', null)
    .order('starts_at')

  const proximaPorPaciente = new Map<string,string>()
  for (const a of citas ?? []) {
    const id = a.patient_id as string
    const prev = proximaPorPaciente.get(id)
    if (!prev || (a.starts_at as string) < prev) proximaPorPaciente.set(id, a.starts_at as string)
  }
  const ids = [...proximaPorPaciente.keys()]
  if (ids.length === 0) { console.log('\nNadie con cita en esa ventana.\n'); return }

  const { data: pacientes } = await supa
    .from('patients')
    .select('id, name, phone, proactive_contact_opt_in')
    .eq('clinic_id', ALGIA)
    .in('id', ids)

  // ¿Escribió alguna vez? Sólo se miran SUS conversaciones.
  const { data: convs } = await supa
    .from('conversations').select('id, patient_id')
    .eq('clinic_id', ALGIA).in('patient_id', ids)
  const escribieron = new Set<string>()
  const convIds = (convs ?? []).map((x)=>x.id as string)
  if (convIds.length > 0) {
    const { data: msgs } = await supa.from('messages')
      .select('conversation_id').eq('role','patient').in('conversation_id', convIds)
    const dueño = new Map((convs ?? []).map((x)=>[x.id as string, x.patient_id as string]))
    for (const m of msgs ?? []) {
      const pid = dueño.get(m.conversation_id as string)
      if (pid) escribieron.add(pid)
    }
  }

  const objetivo = (pacientes ?? [])
    .filter((p)=>p.proactive_contact_opt_in)             // opt-in de canal
    .filter((p)=>!escribieron.has(p.id))                 // nunca escribió
    .filter((p)=>/^\+?57[0-9]{10}$/.test((p.phone ?? '').replace(/[\s\-()]/g,'')))
    // El bloqueo de agenda de iSalud viene con NOMBRE y hasta con documento.
    .filter((p)=>!/no agendar/i.test(p.name ?? ''))
    .sort((a,b)=>(proximaPorPaciente.get(a.id) ?? '').localeCompare(proximaPorPaciente.get(b.id) ?? ''))

  // Tope explícito: la tanda que se autorizó, no "todo lo que entre en la
  // ventana". Una ventana en días redondos incluye o excluye gente según la
  // hora a la que se corra el script — el tope hace que la tanda sea la misma
  // que se revisó.
  const iMax = process.argv.indexOf('--max')
  const tope = iMax >= 0 ? parseInt(process.argv[iMax+1] ?? '0', 10) : objetivo.length
  const tanda = objetivo.slice(0, tope)

  console.log(`\n${enviarDeVerdad ? '📤 ENVIANDO' : '🔍 DRY RUN'} · citas dentro de ${dias} días · ${tanda.length} de ${objetivo.length} candidatas\n`)

  for (const p of tanda) {
    const cuando = new Date(proximaPorPaciente.get(p.id)!)
    const cot = new Date(cuando.getTime() - 5*3600*1000)
    const fecha = `${String(cot.getUTCDate()).padStart(2,'0')}/${String(cot.getUTCMonth()+1).padStart(2,'0')} ${String(cot.getUTCHours()).padStart(2,'0')}:${String(cot.getUTCMinutes()).padStart(2,'0')}`
    const primerNombre = toTitleCase((p.name ?? '').trim().split(/\s+/)[0] ?? '')
    if (!enviarDeVerdad) { console.log(`  · ${primerNombre.padEnd(12)} ${p.phone}  cita ${fecha}`); continue }

    const r = await sendWhatsAppTemplate(
      (p.phone ?? '').replace(/^\+/,''), 'contacto_general', 'es_CO',
      [primerNombre, c!.name as string, TEXTO], null,
      { phoneNumberId: c!.whatsapp_phone_id as string, accessToken: c!.whatsapp_access_token as string },
      { clinicId: ALGIA, sendType: 'contacto_general' },
    )
    console.log(`  ${r.ok?'✅':'🔴'} ${primerNombre.padEnd(12)} ${p.phone}  cita ${fecha}  ${r.ok?'':JSON.stringify(r)}`)
    await new Promise((res)=>setTimeout(res, 1200))   // no golpear la API de Meta
  }
  console.log('')
}
main().catch((e)=>{console.error('🔴',e);process.exit(1)})
