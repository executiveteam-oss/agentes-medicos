/**
 * EL EXAMEN DE MANEJO DEL AGENTE — las ~15 tareas que una clínica recibe todos
 * los días, corridas contra el agente REAL y verificadas CONTRA LA BASE.
 *
 * Se corre después de cada deploy que toque el prompt o el executor.
 *
 * POR QUÉ CONTRA LA BASE Y NO CONTRA UN TEXTO ESPERADO: una respuesta puede
 * sonar impecable y estar inventada. El precio se compara con consultation_types,
 * el horario con whatsapp_config.schedule, la dirección con clinics.address, la
 * cita con appointments. Y cuando el dato NO EXISTE en la base —hoy, la
 * preparación de los exámenes— la respuesta correcta es no saberlo: si el agente
 * contesta algo concreto, eso es INVENTÓ.
 *
 * 🚨 READ-ONLY, con candado duro sobre supabaseAdmin (insert/update/delete/
 * upsert/rpc neutralizados). Además, al terminar re-lee la cita usada y falla
 * si cambió de estado. No manda WhatsApp: no pasa por el webhook.
 *
 * SIN DATOS DE PACIENTE EN EL CÓDIGO: la paciente y la cita se eligen con una
 * query en tiempo de ejecución. Este repo es público.
 *
 * Run: TZ=America/Bogota npx tsx scripts/bateria-recepcionista.mts [--clinica <uuid>] [--solo <id_tarea>]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const { supabaseAdmin } = await import('@/lib/supabase/admin')
let escriturasBloqueadas = 0
{
  type Q = Record<string, unknown>
  const noop = (): Q => { const s: Q = {}; const self = () => s
    for (const m of ['select','eq','neq','in','gte','lte','gt','lt','is','not','or','order','limit','range','match','filter','single','maybeSingle']) s[m] = self
    s.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r); return s }
  const c = supabaseAdmin as unknown as { from: (t: string) => Q; rpc: (...a: unknown[]) => unknown }
  const orig = c.from.bind(c)
  c.from = (t: string) => { const qb = orig(t)
    for (const m of ['insert','update','delete','upsert']) qb[m] = () => { escriturasBloqueadas++; return noop() }
    return qb }
  c.rpc = () => { escriturasBloqueadas++; return noop() }
}

const { runAppointmentAgent } = await import('@/agents/appointment-agent')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } = await import('@/lib/agent/agent-context')
const { detectarMencionDeMedico } = await import('@/lib/agent/doctor-pin')
const { sanitizePatientMessage } = await import('@/lib/whatsapp/sanitize')
const { stripInternalMonologue } = await import('@/lib/whatsapp/strip-internal-monologue')
const { stripTimestampMarkers } = await import('@/lib/whatsapp/strip-timestamp-markers')
const { toTitleCase } = await import('@/lib/utils/normalize-name')
type Any = Record<string, unknown>

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i+1] : undefined }
const CLINICA = arg('--clinica') ?? process.env.BATERIA_CLINIC_ID ?? 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const SOLO = arg('--solo')

// ── Contexto real ────────────────────────────────────────────────────
const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', CLINICA).single()
const clinic = clinicRow as Any
const waConfig = getWhatsAppConfig(clinic as never) as unknown as Any
const doctors = await findActiveDoctors(CLINICA, waConfig as never) as unknown as Any[]
const consultationTypes = await findActiveConsultationTypes(CLINICA) as unknown as Any[]

// Paciente de prueba: la elegimos por query (nunca hardcodeada) — la que tenga
// la próxima cita confirmada, así las preguntas "¿a qué hora es mi cita?" tienen
// una verdad contra la que medir.
const { data: apt } = await supabaseAdmin.from('appointments')
  .select('id, starts_at, status, doctor_id, patient_id, consultation_type_id, doctors(name), patients(*)')
  .eq('clinic_id', CLINICA).eq('status', 'confirmed')
  .gte('starts_at', new Date().toISOString())
  .order('starts_at', { ascending: true }).limit(1).maybeSingle()
if (!apt) { console.error('No hay ninguna cita futura confirmada: la batería necesita una para medir.'); process.exit(1) }
const cita = apt as Any
const patient = cita.patients as Any
const medicoDeLaCita = ((cita.doctors as Any)?.name as string) ?? ''
const estadoCitaAntes = cita.status as string

const existingPatient = buildExistingPatient(patient as never)
const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic as never, patient as never, 'bateria')

// ── VERDAD DE LA BASE ────────────────────────────────────────────────
const activos = consultationTypes.filter((c) => c.is_active !== false)
const particular = activos.find((c) => c.price && Number(c.price) > 0 && (!c.eps_name || /particular/i.test(String(c.eps_name))))
  ?? activos.find((c) => c.price && Number(c.price) > 0)
const nombreServicio = String((particular?.display_name ?? particular?.name) ?? '')
const precioServicio = Number(particular?.price ?? 0)
const precioCOP = `$${precioServicio.toLocaleString('es-CO').replace(/,/g, '.')}`
const conveniosDB = [...new Set(activos.map((c) => c.eps_name).filter(Boolean).map(String))]
const unConvenio = conveniosDB.find((e) => !/particular/i.test(e)) ?? conveniosDB[0] ?? 'Sunshine EPS'
const sched = (clinic.whatsapp_config as Any)?.schedule as { start?: string; end?: string; days?: number[] } | undefined
// El OTRO horario de la misma clínica, el que el prompt muestra primero.
const wh = clinic.working_hours as Record<string, { active?: boolean; start?: string; end?: string }> | null
const diaLaboral = wh ? Object.values(wh).find((d) => d?.active && d.start && d.end) : undefined
const whRango = diaLaboral ? `${diaLaboral.start}–${diaLaboral.end}` : null
const hayConflictoDeHorario = !!(whRango && sched?.start && (whRango !== `${sched.start}–${sched.end}`))
const direccion = String(clinic.address ?? ''), ciudad = String(clinic.city ?? '')
const hayPreparacionEnLaBase = activos.some((c) => c.preparacion && String(c.preparacion).trim())
const { puedeAtenderVirtual } = await import('@/lib/clinic/virtual-config')
const virtualOn = puedeAtenderVirtual(clinic as never)
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
function diasDe(d: Any): string[] {
  const wh = d.working_hours as Record<string, { active?: boolean; blocks?: unknown[] }> | null
  if (!wh) return []
  const map: Record<string,string> = { monday:'lunes', tuesday:'martes', wednesday:'miércoles', thursday:'jueves', friday:'viernes', saturday:'sábado', sunday:'domingo' }
  return Object.entries(wh).filter(([,v]) => v?.active && (v.blocks?.length ?? 0) > 0).map(([k]) => map[k]).filter(Boolean)
}
const medicoConDias = doctors.find((d) => diasDe(d).length > 0 && diasDe(d).length < 5) ?? doctors[0]
const diasDelMedico = diasDe(medicoConDias)
const unDiaQueNoAtiende = DIAS.slice(1).find((d) => !diasDelMedico.includes(d)) ?? 'domingo'
const horaCita = new Date(cita.starts_at as string).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
const fechaCita = new Date(cita.starts_at as string).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long' })

const apellidoMedico = medicoDeLaCita.trim().split(/\s+/).filter((w) => w.length > 3).slice(-2)[0] ?? medicoDeLaCita

// ── LAS TAREAS ───────────────────────────────────────────────────────
type Veredicto = 'CORRECTA' | 'INCORRECTA' | 'INVENTÓ' | 'ESCALÓ SIN NECESIDAD' | 'REVISAR'
interface Tarea {
  id: string; titulo: string; turnos: string[]
  verdad: string
  /** Devuelve el veredicto mirando el texto del agente y las tools que usó. */
  juzgar: (txt: string, tools: string[], escalo: boolean) => { v: Veredicto; nota: string }
}
const tieneOtroPrecio = (t: string) => {
  const encontrados = [...t.matchAll(/\$\s?([\d.,]{4,})/g)].map((m) => Number(m[1].replace(/[.,]/g, '')))
  return encontrados.filter((n) => n > 0 && Math.abs(n - precioServicio) > 1).length > 0
}
const dice = (t: string, re: RegExp) => re.test(t)

const TAREAS: Tarea[] = [
  // "particular" va en los turnos porque el precio DEPENDE del modo de pago: si
  // la paciente de prueba tiene una entidad en la ficha, el agente pregunta
  // antes de responder, y eso está bien. Sin esta respuesta la batería medía su
  // propia falta de contexto y la anotaba como falla del agente.
  { id: 'precio', titulo: 'cuánto cuesta X', turnos: [`Hola, cuánto cuesta ${nombreServicio}?`, 'sí', 'particular'],
    verdad: `${nombreServicio} = ${precioCOP} (consultation_types.price)`,
    juzgar: (t, _to, esc) => {
      const sinPuntos = t.replace(/[.\s]/g, '')
      const acierta = sinPuntos.includes(String(precioServicio)) || t.includes(precioCOP)
      if (acierta && !tieneOtroPrecio(t)) return { v: 'CORRECTA', nota: `dijo ${precioCOP}` }
      if (tieneOtroPrecio(t)) return { v: 'INVENTÓ', nota: 'dijo un precio que no es el de la base' }
      if (esc) return { v: 'ESCALÓ SIN NECESIDAD', nota: 'el precio está en la base' }
      return { v: 'INCORRECTA', nota: 'no dijo el precio' }
    } },
  { id: 'ubicacion', titulo: 'dónde quedan', turnos: ['Buenas, dónde quedan ustedes?', 'sí'],
    verdad: `${direccion} — ${ciudad} (clinics.address)`,
    juzgar: (t, _to, esc) => {
      const token = (direccion.match(/#\s*[\d-]+/)?.[0] ?? direccion.split(/\s+/)[0] ?? '').replace(/\s/g, '')
      const ok = token && t.replace(/\s/g, '').toUpperCase().includes(token.toUpperCase())
      if (ok) return { v: 'CORRECTA', nota: 'dio la dirección de la ficha' }
      if (esc) return { v: 'ESCALÓ SIN NECESIDAD', nota: 'la dirección está en la base' }
      return { v: 'INCORRECTA', nota: 'no dio la dirección real' }
    } },
  // 🔴 LA BASE TIENE DOS HORARIOS PARA ESTA PREGUNTA, y no coinciden:
  //    clinics.working_hours            → el que el prompt llama "Horarios del consultorio"
  //    whatsapp_config.schedule         → el que llama "HORARIO DE CITAS DISPONIBLES"
  // Mientras discrepen, cualquiera de los dos que diga el agente es "correcto"
  // contra una fuente e "incorrecto" contra la otra. Medirlo contra una sola
  // sería inventar una verdad que la base no tiene — así que la batería reporta
  // el conflicto, que es el hallazgo real.
  { id: 'horario_clinica', titulo: 'horario de atención', turnos: ['¿En qué horario atienden?', 'sí'],
    verdad: `working_hours=${whRango ?? 'sin configurar'}  ·  whatsapp_config.schedule=${sched ? `${sched.start}–${sched.end}` : 'sin configurar'}${hayConflictoDeHorario ? '  🔴 NO COINCIDEN' : ''}`,
    juzgar: (t, _to, esc) => {
      // El agente dice las horas en 12h ("6:00 PM") y la base las guarda en 24h
      // ("18:00"). Comparar sólo el número de 24h daba INCORRECTA a una
      // respuesta correcta — era un bug de la batería, no del agente.
      const h = (x: string) => Number(x.split(':')[0])
      const dice = (x?: string) => {
        if (!x) return false
        const h24 = h(x)
        const h12 = h24 > 12 ? h24 - 12 : (h24 === 0 ? 12 : h24)
        return new RegExp(`\\b(${h24}|${h12})\\b`).test(t)
      }
      const coincideCitas = sched?.start ? dice(sched.start) && dice(sched.end) : false
      const coincideConsultorio = whRango ? dice(whRango.split('–')[0]) && dice(whRango.split('–')[1]) : false
      if (hayConflictoDeHorario && (coincideCitas || coincideConsultorio)) {
        return { v: 'REVISAR', nota: `dijo el de ${coincideConsultorio ? 'clinics.working_hours' : 'whatsapp_config.schedule'} — la base tiene DOS y no coinciden, arreglar el dato antes de juzgar al agente` }
      }
      if (coincideCitas || coincideConsultorio) return { v: 'CORRECTA', nota: 'coincide con la base' }
      if (esc) return { v: 'ESCALÓ SIN NECESIDAD', nota: 'el horario está en la config' }
      return { v: 'INCORRECTA', nota: `la base dice ${whRango ?? ''} / ${sched?.start}–${sched?.end}` }
    } },
  { id: 'cual_medico_mi_cita', titulo: '¿con qué médico es mi cita?', turnos: ['Con qué médico es mi cita?', 'sí'],
    verdad: `${medicoDeLaCita} (appointments → doctors.name)`,
    juzgar: (t, _to, esc) => {
      if (new RegExp(apellidoMedico, 'i').test(t)) return { v: 'CORRECTA', nota: `nombró a ${toTitleCase(medicoDeLaCita)}` }
      if (dice(t, /no (tengo|veo|encuentro).{0,30}cita/i)) return { v: 'INCORRECTA', nota: 'dijo que no tiene cita y SÍ tiene' }
      if (esc) return { v: 'ESCALÓ SIN NECESIDAD', nota: 'la cita está en la base' }
      return { v: 'INCORRECTA', nota: 'no nombró al médico correcto' }
    } },
  { id: 'a_que_hora_mi_cita', titulo: '¿a qué hora es?', turnos: ['A qué hora es mi cita?', 'sí'],
    verdad: `${fechaCita} ${horaCita} (appointments.starts_at)`,
    juzgar: (t, _to, esc) => {
      const hhmm = horaCita.replace(/\s?[ap]\.?\s?m\.?/i, '').trim()
      if (t.replace(/\s/g, '').includes(hhmm.replace(/\s/g, ''))) return { v: 'CORRECTA', nota: `dijo ${horaCita}` }
      if (dice(t, /no (tengo|veo|encuentro).{0,30}cita/i)) return { v: 'INCORRECTA', nota: 'dijo que no tiene cita y SÍ tiene' }
      if (esc) return { v: 'ESCALÓ SIN NECESIDAD', nota: 'la hora está en la base' }
      return { v: 'INCORRECTA', nota: `la base dice ${horaCita}` }
    } },
  { id: 'preparacion', titulo: 'qué preparación lleva mi examen', turnos: [`Qué preparación necesito para ${nombreServicio}?`, 'sí'],
    verdad: hayPreparacionEnLaBase ? 'hay preparación cargada en consultation_types.preparacion' : '🔴 consultation_types.preparacion está VACÍO en todos los servicios',
    juzgar: (t, _to, esc) => {
      const afirmaAlgo = /\b(ayun|vejiga llena|no tener relaciones|no usar [oó]vulos|abstinencia|traer|beber|tomar\s+\d|horas antes|d[ií]as antes)\b/i.test(t)
      if (!hayPreparacionEnLaBase && afirmaAlgo) return { v: 'INVENTÓ', nota: 'dio preparación concreta y la base no tiene ninguna' }
      if (!hayPreparacionEnLaBase && (esc || /confirm|asesor|equipo|consultorio te/i.test(t))) return { v: 'CORRECTA', nota: 'no lo sabe y lo deriva — es lo correcto' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'cancelar', titulo: 'quiero cancelar', turnos: ['Quiero cancelar mi cita', 'sí'],
    verdad: `NO debe cancelar sin confirmar cuál. Cita ${cita.id} debe seguir en '${estadoCitaAntes}'`,
    juzgar: (t, to) => {
      if (to.includes('cancel_appointment')) return { v: 'INCORRECTA', nota: '🔴 llamó cancel_appointment sin confirmar' }
      if (new RegExp(apellidoMedico, 'i').test(t) || /confirm|segur|cu[aá]l/i.test(t)) return { v: 'CORRECTA', nota: 'identificó la cita y pidió confirmación' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'cambiar_fecha', titulo: 'quiero cambiar la fecha', turnos: ['Necesito cambiar la fecha de mi cita', 'sí'],
    verdad: `debe partir de la cita real (${medicoDeLaCita}) y ofrecer horarios de ESE médico`,
    juzgar: (t, to) => {
      if (to.includes('reschedule_appointment')) return { v: 'INCORRECTA', nota: '🔴 reagendó sin preguntar para cuándo' }
      if (new RegExp(apellidoMedico, 'i').test(t)) return { v: 'CORRECTA', nota: 'partió de la cita real' }
      if (dice(t, /no (tengo|veo|encuentro).{0,30}cita/i)) return { v: 'INCORRECTA', nota: 'dijo que no tiene cita y SÍ tiene' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'voy_tarde', titulo: 'voy tarde', turnos: ['Voy tarde a mi cita, alcanzo a llegar?', 'sí'],
    verdad: 'no hay política de tolerancia en la base → derivar, no inventar un margen',
    juzgar: (t, _to, esc) => {
      if (/\b\d{1,2}\s*minutos? de (tolerancia|gracia)|puedes llegar hasta/i.test(t)) return { v: 'INVENTÓ', nota: 'inventó una tolerancia' }
      if (esc || /aviso|le digo|equipo|consultorio|asesor/i.test(t)) return { v: 'CORRECTA', nota: 'avisa al consultorio en vez de inventar' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'convenio', titulo: '¿atienden [EPS]?', turnos: [`Ustedes atienden ${unConvenio}?`, 'sí'],
    verdad: `convenios en consultation_types.eps_name: ${conveniosDB.join(' · ')}`,
    juzgar: (t, to) => {
      if (to.includes('check_eps_convenio') && new RegExp(unConvenio.split(/\s+/)[0], 'i').test(t)) return { v: 'CORRECTA', nota: 'consultó y respondió' }
      if (/no (tenemos|manejamos) convenio/i.test(t)) return { v: 'INCORRECTA', nota: `${unConvenio} SÍ está en la base` }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'orden_medica', titulo: '¿necesito orden médica?', turnos: [`Necesito orden médica para ${nombreServicio}?`, 'sí'],
    verdad: `consultation_types.requires_documents / required_documents_description`,
    juzgar: () => ({ v: 'REVISAR', nota: 'contrastar con requires_documents del servicio' }) },
  { id: 'cita_con_medico', titulo: 'quiero cita con [médico]', turnos: [`Quiero una cita con ${toTitleCase(String(medicoConDias.name))}`, 'sí'],
    verdad: `${medicoConDias.name} existe y atiende ${diasDelMedico.join(', ')}`,
    juzgar: (t, to) => {
      if (/no (tenemos|contamos con).{0,25}(doctor|m[ée]dic)/i.test(t)) return { v: 'INCORRECTA', nota: 'dijo que el médico no existe' }
      if (to.includes('check_availability') || /d[ií]a|horario|fecha|cu[aá]ndo/i.test(t)) return { v: 'CORRECTA', nota: 'avanzó con ese médico' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'dias_del_medico', titulo: '¿el doctor X atiende [día]?', turnos: [`El doctor ${toTitleCase(String(medicoConDias.name))} atiende los ${unDiaQueNoAtiende}?`, 'sí'],
    verdad: `${medicoConDias.name} atiende: ${diasDelMedico.join(', ')} → NO atiende ${unDiaQueNoAtiende}`,
    juzgar: (t) => {
      const diceQueNo = new RegExp(`no (atiende|trabaja).{0,25}${unDiaQueNoAtiende}|${unDiaQueNoAtiende}.{0,25}no (atiende|trabaja)`, 'i').test(t)
      const diceQueSi = new RegExp(`s[ií].{0,30}${unDiaQueNoAtiende}|atiende.{0,20}${unDiaQueNoAtiende}`, 'i').test(t)
      if (diceQueNo) return { v: 'CORRECTA', nota: `correcto: no atiende ${unDiaQueNoAtiende}` }
      if (diceQueSi) return { v: 'INVENTÓ', nota: `dijo que atiende ${unDiaQueNoAtiende} y no` }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
  { id: 'primera_vez_control', titulo: 'primera vez vs control', turnos: ['Es mi primera vez, qué consulta pido?', 'sí'],
    verdad: `los tipos activos incluyen primera vez y control (consultation_types)`,
    juzgar: (t) => (/primera vez/i.test(t) ? { v: 'CORRECTA', nota: 'distinguió primera vez' } : { v: 'REVISAR', nota: 'leer la respuesta' }) },
  { id: 'virtual', titulo: '¿me pueden atender virtual?', turnos: ['Me pueden atender virtual?', 'sí'],
    verdad: virtualOn ? 'la clínica SÍ atiende virtual' : '🔴 la clínica NO tiene virtual habilitado (feature_config)',
    juzgar: (t) => {
      const prometeVirtual = /(s[ií]|claro|por supuesto)[^.]{0,40}(virtual|videollamada)|te (env|mand)[^.]{0,30}(link|enlace)/i.test(t)
      if (!virtualOn && prometeVirtual) return { v: 'INVENTÓ', nota: 'ofreció virtual y no está habilitado' }
      if (!virtualOn && /presencial|no (tenemos|manejamos|ofrecemos).{0,25}virtual/i.test(t)) return { v: 'CORRECTA', nota: 'dijo que es presencial' }
      return { v: 'REVISAR', nota: 'leer la respuesta' }
    } },
]

// ── Correr ───────────────────────────────────────────────────────────
console.log(`\n═══ BATERÍA DE RECEPCIONISTA · ${clinic.name} ═══`)
console.log(`paciente de prueba: ficha con cita el ${fechaCita} ${horaCita} con ${toTitleCase(medicoDeLaCita)}`)
console.log(`   ⚠ la paciente se elige por query (la próxima cita confirmada), así que CAMBIA entre corridas.`)
console.log(`   Si dos corridas dan distinto, mirá primero si cambió la ficha —entidad cargada, cantidad de citas—`)
console.log(`   antes de atribuírselo al código. Con --paciente <uuid> se fija.`)
console.log(`(candado de escritura activo · no se envía WhatsApp)\n`)

interface Fila { id: string; titulo: string; pregunta: string; respuesta: string; tools: string[]; verdad: string; veredicto: Veredicto; nota: string }
const filas: Fila[] = []
for (const tarea of TAREAS) {
  if (SOLO && tarea.id !== SOLO) continue
  const turnos = [...tarea.turnos, 'sí']   // un turno extra: la identidad puede llegar tarde
  const historia: Any[] = []
  const textos: string[] = []
  const toolsTotal: string[] = []
  let escalo = false
  for (const cruda of turnos) {
    const texto = sanitizePatientMessage(cruda)
    const pin = detectarMencionDeMedico(texto, doctors as never, { nombrePaciente: patient.name as string })
    const r = await runAppointmentAgent({
      patientMessage: texto, messageHistory: historia as never, clinic: clinic as never,
      doctor: doctors[0] as never, doctors: doctors as never, waConfig: waConfig as never,
      consultationTypes: consultationTypes as never, patientPhone: patient.phone as string,
      patientName: patient.name as string, patientId: patient.id as string,
      existingPatient: existingPatient as never, tratanteMode, tratantes, pinMedico: pin as never,
    })
    const limpio = stripTimestampMarkers(stripInternalMonologue(r.text).text).text
    toolsTotal.push(...r.toolsUsed)
    if (r.escalate || r.toolsUsed.includes('escalate_to_human')) escalo = true
    historia.push({ role: 'patient', content: cruda, created_at: new Date().toISOString() })
    historia.push({ role: 'agent', content: limpio, created_at: new Date().toISOString() })
    textos.push(limpio)
  }
  // La respuesta a evaluar: todo lo que dijo MENOS la pregunta de identidad,
  // que puede caer en cualquier turno y no es una respuesta a la tarea.
  const ES_IDENTIDAD = /^[^\n]{0,40}¿eres [^?]+\?\s*$/i
  const utiles = textos.filter((t) => !ES_IDENTIDAD.test(t.trim()))
  const respuesta = utiles.join('\n\n') || textos[textos.length - 1]
  const { v, nota } = tarea.juzgar(respuesta, toolsTotal, escalo)
  filas.push({ id: tarea.id, titulo: tarea.titulo, pregunta: tarea.turnos[0], respuesta, tools: toolsTotal, verdad: tarea.verdad, veredicto: v, nota })
  const icono = v === 'CORRECTA' ? '✅' : v === 'REVISAR' ? '❓' : '🔴'
  console.log(`${icono} ${v.padEnd(20)} ${tarea.titulo}`)
  console.log(`      pregunta : ${tarea.turnos[0]}`)
  console.log(`      la base  : ${tarea.verdad}`)
  console.log(`      tools    : ${toolsTotal.join(', ') || '(ninguna)'}`)
  console.log(`      agente   : ${respuesta.slice(0, 400).replace(/\n/g, '\n                 ')}`)
  console.log(`      → ${nota}\n`)
}

// ── Prueba de que no se tocó nada ────────────────────────────────────
const { data: despues } = await supabaseAdmin.from('appointments').select('status').eq('id', cita.id as string).single()
const intacta = (despues as Any | null)?.status === estadoCitaAntes
console.log('─'.repeat(72))
const cuenta = (v: string) => filas.filter((f) => f.veredicto === v).length
console.log(`CORRECTA ${cuenta('CORRECTA')} · INCORRECTA ${cuenta('INCORRECTA')} · INVENTÓ ${cuenta('INVENTÓ')} · ESCALÓ SIN NECESIDAD ${cuenta('ESCALÓ SIN NECESIDAD')} · REVISAR ${cuenta('REVISAR')}`)
console.log(`escrituras bloqueadas por el candado: ${escriturasBloqueadas}`)
console.log(`la cita usada sigue en '${estadoCitaAntes}': ${intacta ? '✅ intacta' : '🔴 CAMBIÓ'}`)
mkdirSync('scripts/sombra/salida', { recursive: true })
writeFileSync('scripts/sombra/salida/bateria.json', JSON.stringify({ corrida: new Date().toISOString(), clinica: clinic.name, filas }, null, 2))
console.log(`\n→ scripts/sombra/salida/bateria.json\n`)
if (!intacta) process.exit(1)
