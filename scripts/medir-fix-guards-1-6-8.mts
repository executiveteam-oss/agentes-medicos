/**
 * MEDICIÓN DE LOS TRES ARREGLOS — guards 6, 1 y 8 (2026-08-22).
 *
 * Orden del patrón 11: primero los textos DETERMINISTAS del propio sistema,
 * después la salida real del modelo de 30 días leyendo cada disparo, y recién
 * al final los señuelos y los casos positivos.
 *
 * Run: TZ=America/Bogota npx tsx scripts/medir-fix-guards-1-6-8.mts
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const G = await import('@/lib/whatsapp/agent-guards')
let fallos = 0
const chequear = (cond: boolean, etiqueta: string) => { if (!cond) { fallos++; console.log(`    🔴 ${etiqueta}`) } }

const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// ════════════════════════════════════════════════════════════════════════════
// GUARD 6 — las 2.190 fechas, con el arreglo puesto
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ GUARD 6 · la rejilla completa, con el arreglo ═══\n')
const HOY = '2026-08-22'
// 🔴 LA REJILLA DE LA PRIMERA VERSIÓN ESTABA MAL, y hay que decirlo porque casi
// condena un arreglo bueno: fijaba `hoy` en agosto de 2026 y después generaba
// fechas de hasta 365 días adelante — o sea, fechas de 2027 escritas sin año
// ("23 de febrero"). El guard las resolvía a 2026 y la rejilla las comparaba
// contra el día de 2027. Los "233 escapes" y los "180 falsos positivos" que
// salieron de ahí eran del medidor, no del guard.
//
// Lo que se mide ahora es lo que el agente hace de verdad: ofrecer una fecha
// PRÓXIMA. Por eso `hoy` se para tres días antes de cada fecha probada, que es
// donde la interpretación del año no tiene ninguna ambigüedad.
const menos3 = (dt: Date) => new Date(dt.getTime() - 3 * 864e5).toISOString().slice(0, 10)
let equivocadas = 0, escapan = 0, correctas = 0, falsosPositivos = 0
const ejemplosEscape: string[] = []
const ejemplosFP: string[] = []
for (let d = 0; d < 365; d++) {
  const dt = new Date(Date.UTC(2026, 7, 22 + d, 12))
  const real = dt.getUTCDay()
  const hoy = menos3(dt)
  for (let w = 0; w < 7; w++) {
    const texto = `Te agendo el ${DIAS[w]} ${dt.getUTCDate()} de ${MES[dt.getUTCMonth()]}`
    const bloqueado = G.detectDatosSinRespaldo({ agentText: texto, hechos: undefined, hoyCOT: hoy }).blocked
    if (w === real) {
      correctas++
      if (bloqueado) { falsosPositivos++; if (ejemplosFP.length < 5) ejemplosFP.push(`${texto} (hoy=${hoy})`) }
    } else {
      equivocadas++
      if (!bloqueado) { escapan++; if (ejemplosEscape.length < 5) ejemplosEscape.push(`${texto} (cae ${DIAS[real]}, hoy=${hoy})`) }
    }
  }
}
console.log(`  afirmaciones EQUIVOCADAS : ${equivocadas}   se escapan: ${escapan}   (antes del arreglo: 365 = 16,7%)`)
console.log(`  afirmaciones CORRECTAS   : ${correctas}   falsos positivos: ${falsosPositivos}`)
for (const e of ejemplosEscape) console.log(`      escape: ${e}`)
for (const e of ejemplosFP) console.log(`      FP: ${e}`)
chequear(escapan === 0, `quedan ${escapan} escapes`)
chequear(falsosPositivos === 0, `${falsosPositivos} falsos positivos nuevos`)

// El caso que motivaba el candidato del año siguiente
console.log('\n  ── "5 de enero" dicho en diciembre — el caso que el candidato existía para cubrir ──')
// 2027-01-05 es MARTES; 2026-01-05 fue LUNES.
const casosEnero: Array<[string, string, boolean, string]> = [
  ['2026-12-15', 'Te agendo el martes 5 de enero',     false, 'martes = 05/01/2027 ✓ → NO debe bloquear'],
  ['2026-12-15', 'Te agendo el lunes 5 de enero',      true,  '05/01/2027 es martes → "lunes" miente y bloquea'],
  ['2026-12-31', 'Te agendo el martes 5 de enero',     false, 'víspera de año nuevo, mismo caso ✓'],
  // Dicho el 22/08/2026, el 5 de enero más cercano es el de 2027 (136 días
  // adelante) y no el de 2026 (229 atrás). 05/01/2027 es MARTES.
  ['2026-08-22', 'Te agendo el martes 5 de enero',     false, 'el enero más cercano es 2027 y cae martes ✓'],
  ['2026-08-22', 'Te agendo el lunes 5 de enero',      true,  'mismo caso: 05/01/2027 es martes, "lunes" miente'],
  ['2026-08-22', 'Te agendo el martes 12 de agosto',   true,  'fecha PASADA reciente (Luz Estella): 12/08/2026 fue miércoles → bloquea'],
]
for (const [hoy, texto, esperaBloqueo, porque] of casosEnero) {
  const r = G.detectDatosSinRespaldo({ agentText: texto, hechos: undefined, hoyCOT: hoy })
  const ok = r.blocked === esperaBloqueo
  if (!ok) fallos++
  console.log(`    ${ok ? '✅' : '🔴'} hoy=${hoy}  "${texto}"  → ${r.blocked ? 'BLOQUEA' : 'pasa'}   (${porque})`)
}

// De dónde sale el "hoy": la franja peligrosa de la noche.
console.log('\n  ── la franja de la noche: 8 PM en Bogotá ya es el día siguiente en UTC ──')
const nocheUTC = new Date('2026-08-22T01:30:00Z')   // = 21/08 20:30 en Bogotá
console.log(`    instante: ${nocheUTC.toISOString()} (UTC)  =  ${nocheUTC.toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (COT)`)
console.log(`    toISOString().slice(0,10)                        → ${nocheUTC.toISOString().slice(0, 10)}   ← el día CORRIDO`)
console.log(`    toLocaleDateString('en-CA', America/Bogota)      → ${nocheUTC.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}   ← el que se le pasa`)
chequear(nocheUTC.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) === '2026-08-21', 'la fuente de hoyCOT no da la fecha de Bogotá')

// ════════════════════════════════════════════════════════════════════════════
// GUARD 1 — el prefijo, con y sin tilde, y los señuelos que pediste
// ════════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ GUARD 1 · afirmación con tilde y señuelos ═══\n')
const casosPrefijo: Array<[string, boolean]> = [
  ['Sí, correcto', true], ['Si, correcto', true],
  ['Sí. soy yo', true], ['Sí soy yo', true], ['Si soy yo', true],
  ['sí, esa soy', true], ['SÍ, correcto', true],
  // señuelos
  ['Sinceramente no sé', false], ['Sin problema', false], ['Sin tilde', false],
  ['Simón', false], ['Siempre he venido acá', false], ['Sigo esperando', false],
  ['Si no puedo ir, aviso', true],   // "Si " condicional: ya entraba antes, no cambia
]
for (const [t, esperado] of casosPrefijo) {
  const r = G.PATIENT_AFFIRMATION_PREFIX.test(t)
  const ok = r === esperado
  if (!ok) fallos++
  console.log(`    ${ok ? '✅' : '🔴'} ${JSON.stringify(t).padEnd(26)} → ${r ? 'cuenta como sí' : 'no cuenta'}`)
}

console.log('\n  ── end-to-end: ella confirma con tilde y el guard NO debe pedirle que repita ──')
for (const t of ['Sí, correcto', 'Si, correcto', 'Sí, esa soy']) {
  const r = G.detectHallucinatedIdentity({
    agentText: 'Gracias, identidad confirmada. ¿Para qué fecha quieres la cita?',
    messageHistory: [{ role: 'agent', content: '¿Confirmas que eres Laura Valencia?' }] as never,
    currentPatientMsg: t, patientName: 'Laura Valencia',
  })
  chequear(!r.blocked, `"${t}" todavía bloquea`)
  console.log(`    ${r.blocked ? '🔴 BLOQUEA' : '✅ pasa'}  ${JSON.stringify(t)}`)
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD 8 — las conjugaciones nuevas
// ════════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ GUARD 8 · conjugaciones nuevas ═══\n')
const ELLA = 'pero yo tengo una cita el jueves'
const g8 = (agentText: string, patientText = ELLA) =>
  G.detectCitaNegadaQueEllaAfirma({ agentText, patientText, toolsUsed: ['get_patient_appointments'], yaVaAEscalar: false }).blocked
for (const [t, esperado] of [
  ['No encuentro ninguna cita registrada a tu nombre.', true],
  ['No encontré ninguna cita registrada a tu nombre.', true],
  ['No encontre ninguna cita registrada a tu nombre.', true],
  ['No encontró el sistema ninguna cita agendada.', true],
  ['No encontramos ninguna cita programada.', true],
  ['No logré encontrar una cita registrada a tu nombre.', true],
  ['No hallé ninguna cita agendada.', true],
  // señuelos: no debe disparar
  ['No tengo registrado ese convenio en el sistema.', false],
  ['No encontré el consultorio en el mapa, te paso la dirección.', false],
] as Array<[string, boolean]>) {
  const r = g8(t)
  const ok = r === esperado
  if (!ok) fallos++
  console.log(`    ${ok ? '✅' : '🔴'} ${r ? 'BLOQUEA' : 'pasa   '}  ${JSON.stringify(t.slice(0, 62))}`)
}

// ════════════════════════════════════════════════════════════════════════════
// PATRÓN 11 — los textos DETERMINISTAS del sistema, contra los tres guards
// ════════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ PATRÓN 11 · los textos que escribe EL SISTEMA ═══\n')
const DETERMINISTAS = [
  'Para la ecografía de mapeo, un asesor del consultorio confirma los detalles contigo antes de agendar. Ya les avisé y te contactan pronto. 🙂',
  '📎 Recibí tu archivo, gracias. Ya lo tenemos. Una persona del consultorio lo revisa y te escribe.',
  'Entiendo que necesitas ayuda urgente. Voy a pasar tu mensaje a alguien del consultorio para que te atienda lo antes posible. 🙏',
  'Disculpa, quiero confirmarte los horarios exactos antes de decirte algo equivocado. Ya le pasé tu caso a una persona del consultorio.',
  'Disculpa, tuve un cruce con el médico de tu cita y no quiero confirmarte algo equivocado. Ya le pasé tu caso a una persona del consultorio para que lo revise.',
  'Dame un momentito, te comunico con alguien del equipo para dejar tu cita confirmada. 🙏',
  'Prefiero no darte una indicación de preparación de memoria, porque para cada examen es distinta y no quiero que te prepares mal 🙏 Ya le pedí al consultorio que te confirme exactamente qué debes tener en cuenta.',
  'Eso lo tiene que revisar tu médico — ya le pasé tu consulta al equipo del consultorio para que te respondan. 🙏',
  'Nuestro asistente virtual está temporalmente fuera de servicio. Por favor comunícate directamente con el consultorio.',
  'Disculpa, estoy teniendo dificultades técnicas en este momento. Intenta de nuevo en unos minutos o escribe "hablar con humano" si es urgente. 🙏',
  'Tu solicitud requiere validación con un asesor del consultorio antes de agendar. Te paso con el equipo y te contactan.',
  'Antes de continuar necesito que confirmes tu identidad. ¿Eres Laura Valencia, CC 1234567? Respóndeme "sí" o "no" para seguir.',
]
let disparosDet = 0
for (const t of DETERMINISTAS) {
  const d6 = G.detectDatosSinRespaldo({ agentText: t, hechos: undefined, hoyCOT: HOY }).blocked
  const d8 = g8(t)
  const d11 = G.detectInterpretacionClinica({ agentText: t }).blocked
  if (d6 || d8 || d11) {
    disparosDet++
    console.log(`    🔴 dispara [${[d6 && 'g6', d8 && 'g8', d11 && 'g11'].filter(Boolean).join(',')}]: ${t.slice(0, 90)}`)
  }
}
console.log(`    ${disparosDet === 0 ? '✅' : '🔴'} ${DETERMINISTAS.length} textos deterministas · disparos: ${disparosDet}`)
chequear(disparosDet === 0, `${disparosDet} textos del sistema bloqueados`)

// ════════════════════════════════════════════════════════════════════════════
// 30 DÍAS DE SALIDA REAL — cuántos disparos por día suma cada arreglo
// ════════════════════════════════════════════════════════════════════════════
const { supabaseAdmin } = await import('@/lib/supabase/admin')
const CLINIC = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const desde = new Date(Date.now() - 30 * 864e5).toISOString()
const { data: convs } = await supabaseAdmin.from('conversations').select('id').eq('clinic_id', CLINIC)
const ids = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id)
const msgs: Array<{ content: string; created_at: string; conversation_id: string }> = []
for (let i = 0; i < ids.length; i += 50) {
  let off = 0
  for (;;) {
    const { data } = await supabaseAdmin.from('messages').select('content, created_at, conversation_id')
      .in('conversation_id', ids.slice(i, i + 50)).eq('role', 'agent').gte('created_at', desde)
      .order('created_at').range(off, off + 999)
    const lote = (data ?? []) as typeof msgs
    msgs.push(...lote); if (lote.length < 1000) break; off += 1000
  }
}

console.log(`\n\n═══ 30 DÍAS DE SALIDA REAL — ${msgs.length} mensajes del agente ═══\n`)
const hoyDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const cuenta = (f: (m: typeof msgs[0]) => boolean) => msgs.filter(f).length

const g6Antes = cuenta((m) => G.detectDatosSinRespaldo({ agentText: m.content, hechos: undefined, hoyCOT: hoyDe(m.created_at) }).blocked)
const g8Nuevo = msgs.filter((m) => /no (encontr[éeoó]|encontramos|hall[éeoó]|logr[éeoó] (encontrar|ubicar))[^.]{0,30}(cita|programad|agendad|registrad)/i.test(m.content))
console.log(`  guard 6 · disparos del chequeo 1 (sin hechos de tool): ${g6Antes}  →  ${(g6Antes / 30).toFixed(2)}/día`)
console.log(`  guard 8 · mensajes que SÓLO capturan las conjugaciones nuevas: ${g8Nuevo.length}  →  ${(g8Nuevo.length / 30).toFixed(2)}/día`)
for (const m of g8Nuevo.slice(0, 10)) console.log(`      · ${m.content.replace(/\s+/g, ' ').slice(0, 120)}`)

const conPrefijoTilde = msgs.filter(() => false).length   // guard 1 mira mensajes de la PACIENTE
const { data: pac } = await supabaseAdmin.from('messages').select('content').in('conversation_id', ids.slice(0, 50)).eq('role', 'patient').gte('created_at', desde).limit(1000)
void conPrefijoTilde; void pac

console.log(`\n${fallos === 0 ? '✅ TODAS LAS VERIFICACIONES OK' : `🔴 ${fallos} FALLOS`}\n`)
process.exit(fallos === 0 ? 0 : 1)
