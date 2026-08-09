// ============================================================
// EXTRACTOR DE ESCALACIONES — la mitad determinista del análisis.
//
// Este script NO opina. Junta los datos, resuelve los joins rotos y marca qué
// sabe y qué no. El juicio (¿hacía falta un humano? ¿hubo fricción?) lo hace
// el modelo leyendo las transcripciones que este script deja servidas.
//
// La separación es a propósito: si el mismo paso que junta los datos es el que
// los interpreta, no hay forma de distinguir un motivo LEÍDO de un motivo
// ADIVINADO. Acá esa frontera la pone el código, no la buena fe del modelo.
//
// Correr:
//   npx tsx .claude/skills/analizar-escalaciones/extraer.ts 2026-08-01 2026-08-15
//   npx tsx .claude/skills/analizar-escalaciones/extraer.ts 2026-08-01 2026-08-15 --json
//
// Fechas en COT (America/Bogota), inclusive de punta a punta.
// ============================================================

import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  ESCALATION_MECHANISM, ESCALATION_LABEL, isKnownReason,
  type EscalationReason, type EscalationMechanism,
} from '../../../src/lib/conversations/escalation-reasons'

// ---------- entorno ----------
const ENV_FILE = process.env.OMUWAN_ENV_FILE ?? '.env.production.local'
try {
  for (const l of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  console.error(`No pude leer ${ENV_FILE}. Pasá OMUWAN_ENV_FILE=<archivo> si está en otro lado.`)
  process.exit(1)
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ---------- parámetros ----------
const [desdeArg, hastaArg] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const JSON_OUT = process.argv.includes('--json')
if (!desdeArg || !hastaArg) {
  console.error('Uso: extraer.ts <desde YYYY-MM-DD> <hasta YYYY-MM-DD> [--json]')
  process.exit(1)
}
// COT = UTC-5. El día colombiano arranca a las 05:00Z y termina a las 04:59Z del siguiente.
const desdeUTC = `${desdeArg}T05:00:00.000Z`
const hastaUTC = new Date(new Date(`${hastaArg}T05:00:00.000Z`).getTime() + 24 * 3600_000).toISOString()

// Teléfonos del seed de demo (scripts/seed-review-demo-data.ts). No son tráfico
// real y arruinan cualquier conteo si se cuelan.
const DEMO_PHONES = new Set(['+573009000001', '+573009000002'])

// Umbrales de muestra. No son opinión: por debajo de esto la agrupación no
// distingue una señal de un accidente, y el informe tiene que decirlo.
const MUESTRA_MINIMA = 15         // menos que esto: no se concluye nada
const MUESTRA_CONFIABLE = 40      // a partir de acá se puede priorizar
const GRUPO_MINIMO = 3            // un grupo con menos que esto no es un patrón

const ACCIONES_ESCALACION = ['conversation_escalated', 'crisis_detected', 'escalate_service_deterministic']

type Confianza = 'leido' | 'inferido'

interface Turno {
  rol: 'patient' | 'agent' | 'staff'
  texto: string
  cuando: string
  tipo: string
  posible_truncado: boolean
  tools?: string[]
}

interface Caso {
  conversation_id: string
  paciente: string | null
  telefono: string | null
  cuando: string | null
  /** true = la fecha sale del evento de audit, no de `escalated_at`. */
  fecha_estimada?: boolean
  /** El motivo del conjunto cerrado, si está estampado. */
  motivo: EscalationReason | null
  /** Prosa vieja o valor fuera del conjunto — hay que interpretarlo. */
  motivo_crudo: string | null
  mecanismo: EscalationMechanism | null
  etiqueta: string | null
  detalle: string | null
  /** 'leido' = salió del campo. 'inferido' = hay que deducirlo del texto. */
  confianza: Confianza
  por_que_inferido: string | null
  /** Cómo se resolvió el vínculo evento→conversación. */
  vinculo: 'directo' | 'recuperado_por_tools' | 'sin_vinculo'
  devuelta_al_agente: boolean
  historial_previo: unknown[]
  estado_actual: string
  triage: string | null
  es_demo: boolean
  tools_del_turno: string[]
  transcripcion: Turno[]
}

async function main() {
  console.error(`Extrayendo escalaciones del ${desdeArg} al ${hastaArg} (COT)…\n`)

  // ---------- 1. eventos de escalación del período ----------
  const { data: eventos } = await sb.from('audit_log')
    .select('action, actor_type, target_id, details, created_at, clinic_id')
    .in('action', ACCIONES_ESCALACION)
    .gte('created_at', desdeUTC).lt('created_at', hastaUTC)
    .order('created_at')

  // ---------- 2. el rescate del join roto ----------
  // El tool escalate_to_human y (hasta hoy) el camino de keywords insertan en
  // audit_log SIN target_id. Pero `message_processed` sí trae conversation_id
  // junto con las tools de ese turno: emparejando por tiempo se recupera el
  // vínculo. Se exige match ÚNICO — si dos conversaciones escalan en la misma
  // ventana, se marca sin_vinculo en vez de elegir una a dedo.
  const { data: procesados } = await sb.from('audit_log')
    .select('details, created_at').eq('action', 'message_processed')
    .gte('created_at', new Date(new Date(desdeUTC).getTime() - 120_000).toISOString())
    .lt('created_at', new Date(new Date(hastaUTC).getTime() + 120_000).toISOString())

  const conEscalado = (procesados ?? []).filter(r => {
    const t = ((r.details as Record<string, unknown>)?.tools_used ?? []) as string[]
    return Array.isArray(t) && t.includes('escalate_to_human')
  })
  const VENTANA_MS = 45_000

  const vinculos = new Map<string, { convId: string | null; modo: Caso['vinculo']; cuando: string }>()
  let ambiguos = 0
  for (const e of eventos ?? []) {
    const key = `${e.action}|${e.created_at}`
    const cuandoEv = e.created_at as string
    if (e.target_id) { vinculos.set(key, { convId: e.target_id as string, modo: 'directo', cuando: cuandoEv }); continue }
    const t = new Date(e.created_at as string).getTime()
    const cerca = conEscalado.filter(m => Math.abs(new Date(m.created_at as string).getTime() - t) < VENTANA_MS)
    const ids = [...new Set(cerca.map(m => (m.details as Record<string, unknown>)?.conversation_id as string).filter(Boolean))]
    if (ids.length === 1) vinculos.set(key, { convId: ids[0], modo: 'recuperado_por_tools', cuando: cuandoEv })
    else { if (ids.length > 1) ambiguos++; vinculos.set(key, { convId: null, modo: 'sin_vinculo', cuando: cuandoEv }) }
  }

  // ---------- 3. conversaciones alcanzadas ----------
  const idsDeEventos = [...new Set([...vinculos.values()].map(v => v.convId).filter(Boolean) as string[])]

  // …más las que escalaron en el período aunque no hayan dejado evento
  const { data: porFecha } = await sb.from('conversations')
    .select('id').gte('escalated_at', desdeUTC).lt('escalated_at', hastaUTC)

  // …más las que YA fueron devueltas al agente: su escalación vive en el
  // historial, y son justo las que contestan "¿hacía falta un humano?".
  const { data: todasConHist } = await sb.from('conversations')
    .select('id, context').not('context->escalation_history', 'is', null)
  const devueltasEnRango = (todasConHist ?? []).filter(c => {
    const h = ((c.context as Record<string, unknown>)?.escalation_history ?? []) as { devuelta_at?: string }[]
    return Array.isArray(h) && h.some(e => e.devuelta_at && e.devuelta_at >= desdeUTC && e.devuelta_at < hastaUTC)
  }).map(c => c.id as string)

  const ids = [...new Set([...idsDeEventos, ...(porFecha ?? []).map(c => c.id as string), ...devueltasEnRango])]

  if (ids.length === 0) {
    console.error('No hay escalaciones en ese rango.')
    console.log(JSON_OUT ? JSON.stringify({ casos: [], meta: { total: 0 } }, null, 2) : 'Sin escalaciones en el rango.')
    return
  }

  const { data: convs } = await sb.from('conversations')
    .select('id, clinic_id, status, triage_state, escalated_at, context, whatsapp_phone, patients(name)')
    .in('id', ids)

  const { data: msgs } = await sb.from('messages')
    .select('conversation_id, role, content, message_type, created_at')
    .in('conversation_id', ids).order('created_at')

  // tools por turno, para saber qué INTENTÓ el agente antes de escalar
  const { data: toolsRows } = await sb.from('audit_log')
    .select('details, created_at').eq('action', 'message_processed')
    .gte('created_at', new Date(new Date(desdeUTC).getTime() - 7 * 86400_000).toISOString())
  const toolsPorConv = new Map<string, { cuando: string; tools: string[] }[]>()
  for (const r of toolsRows ?? []) {
    const d = (r.details ?? {}) as Record<string, unknown>
    const cid = d.conversation_id as string | undefined
    if (!cid) continue
    const arr = toolsPorConv.get(cid) ?? []
    arr.push({ cuando: r.created_at as string, tools: (d.tools_used ?? []) as string[] })
    toolsPorConv.set(cid, arr)
  }

  // ---------- 4. config de la clínica: keywords y reglas ----------
  const clinicIds = [...new Set((convs ?? []).map(c => c.clinic_id as string))]
  const { data: clinics } = await sb.from('clinics').select('id, name, whatsapp_config').in('id', clinicIds)
  const keywordsPorClinica = new Map<string, string[]>()
  for (const c of clinics ?? []) {
    const wc = (c.whatsapp_config ?? {}) as Record<string, unknown>
    const kws = (wc.escalation_keywords ?? wc.keywords_escalacion ?? []) as string[]
    keywordsPorClinica.set(c.id as string, Array.isArray(kws) ? kws : [])
  }
  const { data: reglas } = await sb.from('consultation_type_rules')
    .select('rule_type, action, consultation_types(name, clinic_id)').eq('rule_type', 'escalate_human')

  // ---------- 5. armar los casos ----------
  const msgsPorConv = new Map<string, typeof msgs>()
  for (const m of msgs ?? []) {
    const a = msgsPorConv.get(m.conversation_id as string) ?? []
    a.push(m); msgsPorConv.set(m.conversation_id as string, a as never)
  }
  const vinculoPorConv = new Map<string, Caso['vinculo']>()
  // Fecha del evento, para las conversaciones que perdieron `escalated_at`
  // (las devolvieron al agente antes de que existiera el historial). Sin esto
  // quedaban con `cuando: null` y no se podían ordenar ni ubicar en el rango —
  // y son justo las de motivo INFERIDO, las que más contexto necesitan.
  const fechaEventoPorConv = new Map<string, string>()
  for (const v of vinculos.values()) {
    if (!v.convId) continue
    if (!vinculoPorConv.has(v.convId)) vinculoPorConv.set(v.convId, v.modo)
    const previa = fechaEventoPorConv.get(v.convId)
    if (!previa || v.cuando < previa) fechaEventoPorConv.set(v.convId, v.cuando)
  }

  const casos: Caso[] = []
  for (const c of convs ?? []) {
    const ctx = (c.context ?? {}) as Record<string, unknown>
    const crudo = ctx.escalation_reason as string | undefined
    const hist = (ctx.escalation_history ?? []) as { reason?: string; detail?: string | null; devuelta_at?: string }[]
    const ultimoHist = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null

    // El motivo puede venir del campo vivo o del historial (si la devolvieron).
    const candidato = crudo ?? ultimoHist?.reason
    const leido = isKnownReason(candidato)
    const motivo = leido ? (candidato as EscalationReason) : null

    let porQue: string | null = null
    if (!leido) {
      porQue = candidato
        ? `El campo guarda "${String(candidato).slice(0, 80)}", que no es del conjunto cerrado (es de antes de que existiera). Hay que deducir el motivo leyendo la conversación.`
        : 'La conversación no tiene motivo estampado — escaló por un camino que en ese momento no escribía el campo. Hay que deducirlo leyendo la conversación.'
    }

    const tel = c.whatsapp_phone as string | null
    const turnosTools = (toolsPorConv.get(c.id as string) ?? []).sort((a, b) => a.cuando.localeCompare(b.cuando))

    const transcripcion: Turno[] = (msgsPorConv.get(c.id as string) ?? []).map(m => {
      const texto = String(m.content ?? '')
      const cercano = turnosTools.find(t => Math.abs(new Date(t.cuando).getTime() - new Date(m.created_at as string).getTime()) < 30_000)
      return {
        rol: m.role as Turno['rol'],
        texto,
        cuando: m.created_at as string,
        tipo: m.message_type as string,
        // sanitizePatientMessage trunca a 1000. Un mensaje justo en el techo
        // puede estar cortado, y el análisis leería media frase sin saberlo.
        posible_truncado: texto.length >= 1000,
        ...(m.role === 'agent' && cercano?.tools?.length ? { tools: cercano.tools } : {}),
      }
    })

    casos.push({
      conversation_id: c.id as string,
      paciente: ((c.patients as unknown as { name: string } | null)?.name) ?? null,
      telefono: tel,
      cuando: (c.escalated_at as string | null) ?? ultimoHist?.devuelta_at ?? fechaEventoPorConv.get(c.id as string) ?? null,
      fecha_estimada: !c.escalated_at,
      motivo,
      motivo_crudo: leido ? null : (candidato ?? null),
      mecanismo: motivo ? ESCALATION_MECHANISM[motivo] : null,
      etiqueta: motivo ? ESCALATION_LABEL[motivo] : null,
      detalle: (ctx.escalation_detail as string | null) ?? ultimoHist?.detail ?? null,
      confianza: leido ? 'leido' : 'inferido',
      por_que_inferido: porQue,
      vinculo: vinculoPorConv.get(c.id as string) ?? 'directo',
      devuelta_al_agente: Array.isArray(hist) && hist.length > 0,
      historial_previo: Array.isArray(hist) ? hist : [],
      estado_actual: c.status as string,
      triage: (c.triage_state as string | null) ?? null,
      es_demo: !!tel && DEMO_PHONES.has(tel),
      tools_del_turno: [...new Set(turnosTools.flatMap(t => t.tools))],
      transcripcion,
    })
  }

  casos.sort((a, b) => (a.cuando ?? '').localeCompare(b.cuando ?? ''))

  const reales = casos.filter(c => !c.es_demo)
  const meta = {
    rango: { desde: desdeArg, hasta: hastaArg, zona: 'America/Bogota' },
    total: casos.length,
    reales: reales.length,
    demo_excluidas: casos.length - reales.length,
    motivo_leido: reales.filter(c => c.confianza === 'leido').length,
    motivo_inferido: reales.filter(c => c.confianza === 'inferido').length,
    devueltas_al_agente: reales.filter(c => c.devuelta_al_agente).length,
    eventos_sin_vinculo: [...vinculos.values()].filter(v => v.modo === 'sin_vinculo').length,
    eventos_ambiguos: ambiguos,
    mensajes_posiblemente_truncados: reales.reduce((s, c) => s + c.transcripcion.filter(t => t.posible_truncado).length, 0),
    umbrales: { MUESTRA_MINIMA, MUESTRA_CONFIABLE, GRUPO_MINIMO },
    suficiencia:
      reales.length < MUESTRA_MINIMA ? 'INSUFICIENTE'
      : reales.length < MUESTRA_CONFIABLE ? 'PRELIMINAR'
      : 'SUFICIENTE',
    keywords_configuradas: Object.fromEntries(keywordsPorClinica),
    servicios_con_regla_escalate_human: [...new Set((reglas ?? [])
      .filter(r => clinicIds.includes((r.consultation_types as unknown as { clinic_id: string } | null)?.clinic_id ?? ''))
      .map(r => (r.consultation_types as unknown as { name: string } | null)?.name)
      .filter(Boolean) as string[])].sort(),
  }

  const salida = { meta, casos: reales, casos_demo: casos.filter(c => c.es_demo) }

  if (JSON_OUT) {
    console.log(JSON.stringify(salida, null, 2))
  } else {
    const path = `.claude/skills/analizar-escalaciones/datos-${desdeArg}_${hastaArg}.json`
    writeFileSync(path, JSON.stringify(salida, null, 2))
    console.error(`\n${'='.repeat(60)}`)
    console.error(`MUESTRA: ${meta.reales} escalaciones reales (${meta.demo_excluidas} de demo excluidas)`)
    console.error(`  motivo LEÍDO del campo:  ${meta.motivo_leido}`)
    console.error(`  motivo A INFERIR:        ${meta.motivo_inferido}`)
    console.error(`  devueltas al agente:     ${meta.devueltas_al_agente}`)
    if (meta.eventos_sin_vinculo) console.error(`  ⚠️  eventos sin vincular: ${meta.eventos_sin_vinculo} (ambiguos: ${meta.eventos_ambiguos})`)
    if (meta.mensajes_posiblemente_truncados) console.error(`  ⚠️  mensajes en el techo de 1000 chars: ${meta.mensajes_posiblemente_truncados}`)
    console.error(`SUFICIENCIA: ${meta.suficiencia}`)
    console.error(`${'='.repeat(60)}`)
    console.error(`\nDatos en: ${path}`)
  }
}

main().catch(e => { console.error('Error:', e instanceof Error ? e.message : e); process.exit(1) })
