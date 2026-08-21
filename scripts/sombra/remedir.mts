/**
 * Re-mide el diff sobre las vueltas YA guardadas por el replay. Sin llamar al
 * modelo: mismas vueltas, contrato recompilado. Sirve para iterar el contrato
 * sin re-correr 1.020 turnos y sin que cambie el input debajo.
 */
import { readFileSync, writeFileSync } from 'fs'
const { armarSalida } = await import('@/lib/agent/contrato-de-salida')
const { stripInternalMonologue, esMonologoInterno } = await import('@/lib/whatsapp/strip-internal-monologue')
const { stripTimestampMarkers } = await import('@/lib/whatsapp/strip-timestamp-markers')

const FB = { end_turn: 'Lo siento, tuve un problema. Escribe "hablar con humano" para asistencia.',
             raro: 'Disculpa, tuve un problema técnico. Intenta de nuevo o escribe "hablar con humano".',
             agotado: 'Disculpa, estoy teniendo dificultades. Escribe "hablar con humano" y alguien del consultorio te ayudará.' }
const limpiar = (t: string) => stripTimestampMarkers(stripInternalMonologue(
  t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1')
   .replace(/^[•●]\s*/gm, '- ').replace(/^#{1,3}\s*/gm, '').replace(/`(.*?)`/g, '$1')).text).text

const d = JSON.parse(readFileSync('scripts/sombra/salida/diff-7d.json', 'utf-8'))
const T = d.turnos as Array<Record<string, unknown>>
const TSSOLO = /^\s*\[\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\]\s*$/
const PREG = /[?¿]/
const clases: Record<string, number> = {}, origenes: Record<string, number> = {}
let perdidosTot = 0, conPerdida = 0, preguntasHuerfanas = 0, monoNuevo = 0, ecoNuevo = 0
const salida: Array<Record<string, unknown>> = []

for (const t of T) {
  const vueltas = (t.detalleVueltas as Array<{ textos: string[]; cierre: 'end_turn'|'tool_use'|'otro'; tools: string[] }>) ?? []
  const cierre = t.cierre as string
  let viejoTxt: string, nuevoTxt: string, origen: string, perdidos: string[]
  if (cierre === 'determinista' || cierre === 'agotado') {
    viejoTxt = t.viejo as string; nuevoTxt = t.viejo as string; origen = cierre; perdidos = []
  } else {
    const bv: string[] = []; let esc = false
    for (const v of vueltas) { if (!esc) bv.push(...v.textos); if (v.tools.includes('escalate_to_human')) esc = true }
    const fb = cierre === 'end_turn' ? FB.end_turn : FB.raro
    const s = armarSalida(vueltas, fb)
    viejoTxt = limpiar(bv.length ? bv.join('\n\n') : fb)
    nuevoTxt = limpiar(s.text)
    origen = s.origen
    const usados = new Set(s.usados.map((x) => x.trim()))
    perdidos = bv.map((x) => x.trim()).filter((x) => !usados.has(x))
    if (s.usados.some(esMonologoInterno)) monoNuevo++
    if (s.usados.some((x) => TSSOLO.test(x))) ecoNuevo++
  }
  const clase = !nuevoTxt.trim() ? 'SILENCIO' : viejoTxt.trim() === nuevoTxt.trim() ? 'IGUAL' : 'DESAPARECE'
  clases[clase] = (clases[clase] ?? 0) + 1
  origenes[origen] = (origenes[origen] ?? 0) + 1
  if (perdidos.length) { conPerdida++; perdidosTot += perdidos.length }
  for (const p of perdidos) if ((PREG.test(p)) && !PREG.test(nuevoTxt)) preguntasHuerfanas++
  salida.push({ i: t.i, clase, origen, perdidos, viejo: viejoTxt, nuevo: nuevoTxt, real: t.real, tools: t.tools })
}
console.log(`\n═══ RE-MEDICIÓN · ${T.length} turnos (mismas vueltas, contrato recompilado) ═══`)
console.log('clases:', JSON.stringify(clases))
console.log('origen:', JSON.stringify(origenes))
console.log(`turnos con bloque perdido: ${conPerdida} · bloques perdidos: ${perdidosTot}`)
console.log(`🔴 preguntas huérfanas (bloque perdido preguntaba y el nuevo no pregunta nada): ${preguntasHuerfanas}`)
console.log(`monólogo remanente en el texto nuevo: ${monoNuevo} turnos · eco [fecha hora]: ${ecoNuevo} turnos`)
writeFileSync('scripts/sombra/salida/remedido.json', JSON.stringify(salida, null, 2))
