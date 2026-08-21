/**
 * PARTE 1 — las fallas que NINGÚN guard atrapó.
 *
 * Busca en TODAS las conversaciones las señales de que algo salió mal aunque el
 * sistema no se haya enterado: la paciente repite, corrige, no entiende, o la
 * conversación se muere justo después de una respuesta del agente. Y compara
 * pregunta contra respuesta para detectar cuándo el agente contestó otra cosa.
 *
 * 🚨 READ-ONLY. Sólo SELECT + una pasada de clasificación con el modelo.
 * La salida va a scripts/sombra/salida/ (gitignoreado): trae texto de pacientes
 * y este repo es PÚBLICO.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sombra/audit-fallas-calladas.mts [--conc 8]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { createClient } = await import('@supabase/supabase-js')
const Anthropic = (await import('@anthropic-ai/sdk')).default
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const CONC = (() => { const i = process.argv.indexOf('--conc'); return i > 0 ? Number(process.argv[i+1]) : 8 })()

// ── Señales deterministas ─────────────────────────────────────────────
const CORRIGE = /\bno,?\s*(yo\s+)?(dije|pregunt[ée]|quise decir|me refiero|es eso|era eso)\b|\bno es eso\b|\bte pregunt[ée] (otra|por)\b|\bno me (entendiste|entiendes|est[áa]s entendiendo)\b|\beso no (fue|es) lo que\b|\bme refiero a\b|\bno,? es que\b/i
const CONFUSO  = /¿?c[oó]mo as[ií]\b|\bno entiendo\b|\bno comprendo\b|\?{3,}|\bno me queda claro\b|\bqu[ée] quiere decir\b|\bc[oó]mo\?\s*$/i
// Mensajes que NO los escribe el modelo: el gate de consentimiento y el saludo
// de bienvenida. Emparejar la pregunta con ESTOS y concluir "contestó otra cosa"
// es un error de medición: la respuesta real viene después.
const AUTOMATICO = /^📋 Antes de continuar|^¡Hola!\s*😊\s*Soy el asistente virtual|^¡Hola! Soy el asistente virtual/
const CIERRE = /^\s*(muchas\s+)?(gracias|mil gracias|ok(ey)?|listo|perfecto|vale|bueno|dale|de acuerdo|entendido|excelente|👍|🙏|😊|❤️|bendiciones|feliz d[ií]a)[\s!.,👍🙏😊❤️]*$/i
const ES_PREGUNTA = /\?|^\s*(cu[aá]l|cu[aá]nto|cu[aá]ndo|d[oó]nde|qu[ée]|qui[eé]n|c[oó]mo|puedo|pueden|tienen|atienden|hay|necesito saber)/i

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const VACIAS = new Set(['de','la','el','en','y','a','que','los','las','un','una','por','para','con','mi','me','es','se','del','al','lo','si','no','o','su','tu'])
const tokens = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !VACIAS.has(w)))
function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b)
  if (A.size === 0 || B.size === 0) return 0
  const inter = [...A].filter((w) => B.has(w)).length
  return inter / new Set([...A, ...B]).size
}

interface Msg { id: string; role: string; content: string; created_at: string }
const { data: convs } = await db.from('conversations')
  .select('id, status, last_message_at, patients(name)').eq('clinic_id', ALGIA)
const conversaciones = (convs ?? []) as Array<Record<string, unknown>>
console.log(`conversaciones: ${conversaciones.length}`)

interface Caso {
  tipo: 'REPITE' | 'CORRIGE' | 'CONFUSA' | 'MUERE' | 'OTRA_PREGUNTA' | 'SOLO_AUTOMATICO'
  conv: string; fecha: string
  pregunta: string; respuesta: string; extra?: string
  tarea?: string; veredicto?: string; porque?: string
}
const casos: Caso[] = []
const pares: Array<{ conv: string; fecha: string; pregunta: string; respuesta: string; idx: number; saltados?: number }> = []

for (const c of conversaciones) {
  const { data: raw } = await db.from('messages')
    .select('id, role, content, created_at').eq('conversation_id', c.id as string)
    .order('created_at', { ascending: true }).limit(1000)
  const msgs = ((raw ?? []) as Msg[]).filter((m) => m.role === 'patient' || m.role === 'agent')
  if (msgs.length === 0) continue

  // pares pregunta→respuesta
  for (let i = 0; i < msgs.length - 1; i++) {
    if (msgs[i].role !== 'patient' || msgs[i + 1].role !== 'agent') continue
    const q = msgs[i].content
    if (norm(q).length < 4) continue          // "si", "ok", emojis: no son una tarea
    if (CIERRE.test(q)) continue              // agradecimientos: tampoco
    // La respuesta es el primer mensaje del agente que NO sea automático.
    let j = i + 1, saltados = 0
    while (j < msgs.length && msgs[j].role === 'agent' && AUTOMATICO.test(msgs[j].content)) { j++; saltados++ }
    const contestada = j < msgs.length && msgs[j].role === 'agent'
    if (!contestada) {
      // El gate fue TODO lo que recibió: nunca le contestaron la pregunta.
      casos.push({ tipo: 'SOLO_AUTOMATICO', conv: c.id as string, fecha: msgs[i].created_at,
        pregunta: q, respuesta: msgs[i + 1].content.slice(0, 120) + '…', extra: 'sólo recibió mensajes automáticos' })
      continue
    }
    pares.push({ conv: c.id as string, fecha: msgs[i].created_at, pregunta: q, respuesta: msgs[j].content, idx: pares.length, saltados })
  }

  const dePaciente = msgs.filter((m) => m.role === 'patient')
  for (const m of dePaciente) {
    const sig = msgs.find((x) => x.role === 'agent' && x.created_at > m.created_at)
    const previo = [...msgs].reverse().find((x) => x.role === 'agent' && x.created_at < m.created_at)
    if (CORRIGE.test(m.content)) casos.push({ tipo: 'CORRIGE', conv: c.id as string, fecha: m.created_at, pregunta: m.content, respuesta: previo?.content ?? '(nada antes)', extra: 'lo que el agente había dicho' })
    else if (CONFUSO.test(m.content)) casos.push({ tipo: 'CONFUSA', conv: c.id as string, fecha: m.created_at, pregunta: m.content, respuesta: previo?.content ?? '(nada antes)', extra: 'lo que el agente había dicho' })
    void sig
  }

  // repeticiones: dos preguntas parecidas con al menos una respuesta del agente en medio
  const preguntas = dePaciente.filter((m) => ES_PREGUNTA.test(m.content))
  for (let i = 0; i < preguntas.length; i++) {
    for (let j = i + 1; j < preguntas.length; j++) {
      const sim = jaccard(preguntas[i].content, preguntas[j].content)
      if (sim < 0.5) continue
      const huboAgente = msgs.some((x) => x.role === 'agent' && x.created_at > preguntas[i].created_at && x.created_at < preguntas[j].created_at)
      if (!huboAgente) continue
      const respuesta = msgs.find((x) => x.role === 'agent' && x.created_at > preguntas[i].created_at)
      casos.push({ tipo: 'REPITE', conv: c.id as string, fecha: preguntas[j].created_at,
        pregunta: preguntas[i].content, respuesta: respuesta?.content ?? '', extra: `volvió a preguntar: "${preguntas[j].content}" (similitud ${sim.toFixed(2)})` })
      break
    }
  }

  // muerte: el último mensaje es del agente y la paciente no volvió
  const ultimo = msgs[msgs.length - 1]
  if (ultimo.role === 'agent') {
    const antes = [...msgs].reverse().find((x) => x.role === 'patient')
    const horas = (Date.now() - new Date(ultimo.created_at).getTime()) / 3.6e6
    // Sólo cuenta si el agente PREGUNTÓ algo y ella no volvió: un cierre
    // normal también termina con el agente y no es una falla.
    const dejoLaPelota = /\?/.test(ultimo.content)
    const ellaCerro = antes ? CIERRE.test(antes.content) : false
    if (horas > 24 && antes && dejoLaPelota && !ellaCerro) {
      casos.push({ tipo: 'MUERE', conv: c.id as string, fecha: ultimo.created_at,
        pregunta: antes.content, respuesta: ultimo.content, extra: `no volvió a escribir (${Math.round(horas)} h)` })
    }
  }
}
console.log(`señales deterministas: ${casos.length}  ·  pares pregunta→respuesta a clasificar: ${pares.length}`)

// ── Clasificación: ¿contestó lo que le preguntaron? y de qué tarea se trata ──
const TAREAS = ['precio','ubicacion','horario_clinica','cual_medico_mi_cita','a_que_hora_mi_cita',
  'preparacion_examen','cancelar','cambiar_fecha','voy_tarde','convenio_eps','orden_medica',
  'cita_con_medico','dias_del_medico','primera_vez_o_control','virtual','otra'] as const

async function clasificar(p: typeof pares[number]) {
  const prompt = `Sos un auditor de calidad de un asistente de WhatsApp de una clínica.
Te doy lo que escribió la PACIENTE y lo que contestó el AGENTE.

PACIENTE: ${p.pregunta.slice(0, 600)}
AGENTE: ${p.respuesta.slice(0, 900)}

Devolvé SOLO un JSON, sin texto alrededor:
{"tarea":"<una de: ${TAREAS.join('|')}>","contesto":"si"|"no"|"parcial","porque":"<máx 15 palabras>"}

"contesto":"no" SOLO si el agente respondió algo distinto de lo que le preguntaron,
o pidió datos en vez de responder algo que ya podía responder.
Pedir confirmación de identidad ANTES de responder NO cuenta como "no": marcá "parcial".`
  const r = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
  const txt = (r.content.find((b) => b.type === 'text') as { text: string } | undefined)?.text ?? ''
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) as { tarea: string; contesto: string; porque: string } } catch { return null }
}

let hechos = 0
const clasif: Array<{ p: typeof pares[number]; c: { tarea: string; contesto: string; porque: string } }> = []
let idx = 0
await Promise.all(Array.from({ length: CONC }, async () => {
  for (;;) {
    const i = idx++
    if (i >= pares.length) return
    try { const c = await clasificar(pares[i]); if (c) clasif.push({ p: pares[i], c }) } catch { /* sigue */ }
    if (++hechos % 100 === 0) process.stdout.write(`  ${hechos}/${pares.length}\n`)
  }
}))

for (const { p, c } of clasif) {
  if (c.contesto === 'no') casos.push({ tipo: 'OTRA_PREGUNTA', conv: p.conv, fecha: p.fecha, pregunta: p.pregunta, respuesta: p.respuesta, tarea: c.tarea, porque: c.porque })
}
// etiquetar tarea en las señales deterministas usando el par más cercano
const porConv = new Map<string, string>()
for (const { p, c } of clasif) if (!porConv.has(p.conv + p.fecha)) porConv.set(p.conv + p.fecha, c.tarea)
for (const k of casos) if (!k.tarea) k.tarea = porConv.get(k.conv + k.fecha) ?? 'otra'

mkdirSync('scripts/sombra/salida', { recursive: true })
writeFileSync('scripts/sombra/salida/fallas-calladas.json', JSON.stringify({ casos, clasificados: clasif.length, pares: pares.length }, null, 2))

const porTipo: Record<string, number> = {}
for (const k of casos) porTipo[k.tipo] = (porTipo[k.tipo] ?? 0) + 1
console.log('\n═══ SEÑALES ═══'); console.log(JSON.stringify(porTipo, null, 2))
const porTarea: Record<string, number> = {}
for (const k of casos) porTarea[k.tarea ?? 'otra'] = (porTarea[k.tarea ?? 'otra'] ?? 0) + 1
console.log('\n═══ POR TAREA ═══'); console.log(JSON.stringify(porTarea, null, 2))
console.log(`\n→ scripts/sombra/salida/fallas-calladas.json  (${casos.length} casos)\n`)
