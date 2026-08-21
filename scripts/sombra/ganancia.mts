import { readFileSync } from 'fs'
const { esMonologoInterno } = await import('@/lib/whatsapp/strip-internal-monologue')
const d = JSON.parse(readFileSync('scripts/sombra/salida/diff-7d.json', 'utf-8'))
const T = d.turnos as Array<Record<string, unknown>>
const TS = /^\s*\[\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\]\s*$/

let monoViejo = 0, monoNuevo = 0, ecoViejo = 0, ecoNuevo = 0
let largoViejo = 0, largoNuevo = 0, multiViejo = 0, multiNuevo = 0
for (const t of T) {
  const vueltas = (t.detalleVueltas as Array<{ textos: string[]; tools: string[] }>) ?? []
  // bloques del contrato viejo (con el corte por escalate)
  const bv: string[] = []; let esc = false
  for (const v of vueltas) { if (!esc) bv.push(...v.textos); if (v.tools.includes('escalate_to_human')) esc = true }
  const bn = bv.filter((b) => !(t.perdidos as string[]).includes(b.trim()))
  if (bv.some(esMonologoInterno)) monoViejo++
  if (bn.some(esMonologoInterno)) monoNuevo++
  if (bv.some((b) => TS.test(b))) ecoViejo++
  if (bn.some((b) => TS.test(b))) ecoNuevo++
  if (bv.length > 1) multiViejo++
  if (bn.length > 1) multiNuevo++
  largoViejo += (t.viejo as string).length
  largoNuevo += (t.nuevo as string).length
}
const n = T.length
console.log(`\nsobre ${n} turnos:`)
console.log(`  turnos con al menos un bloque que strip-internal-monologue marca:   viejo ${monoViejo}  →  nuevo ${monoNuevo}`)
console.log(`  turnos que arrastran el eco del marcador [fecha hora] como bloque:  viejo ${ecoViejo}  →  nuevo ${ecoNuevo}`)
console.log(`  turnos armados con MÁS DE UNA fuente (donde el orden puede fallar): viejo ${multiViejo}  →  nuevo ${multiNuevo}`)
console.log(`  largo promedio del mensaje enviado:  viejo ${Math.round(largoViejo / n)} car.  →  nuevo ${Math.round(largoNuevo / n)} car.`)
