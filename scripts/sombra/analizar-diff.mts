/**
 * Lee el JSON del replay y arma los tres grupos del diff.
 * El primer tamiz es automático; la clasificación final la hago leyendo los
 * bloques marcados REVISAR — que son los únicos que pueden invalidar el contrato.
 */
import { readFileSync, writeFileSync } from 'fs'
const { esMonologoInterno } = await import('@/lib/whatsapp/strip-internal-monologue')

const ruta = process.argv[2] ?? 'scripts/sombra/salida/diff-7d.json'
const d = JSON.parse(readFileSync(ruta, 'utf-8'))
const T = d.turnos as Array<Record<string, unknown>>

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, ' ').trim()
const CON_DATO = /\d{1,2}[:.]\d{2}|\$\s?\d|\d{1,3}\.\d{3}|\b(lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b|\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i

type Clase = 'vacio' | 'monologo' | 'duplicado' | 'preambulo' | 'REVISAR'
function clasificar(bloque: string, nuevo: string): Clase {
  const b = bloque.trim()
  if (!b) return 'vacio'
  if (esMonologoInterno(b)) return 'monologo'
  const n = norm(nuevo)
  if (n.includes(norm(b))) return 'duplicado'
  // Preámbulo: corto, sin ningún dato duro que la paciente pueda necesitar.
  if (b.length <= 140 && !CON_DATO.test(b)) return 'preambulo'
  return 'REVISAR'
}

const cuentaClase: Record<string, number> = {}
const cuentaPerdida: Record<string, number> = {}
const revisar: Array<Record<string, unknown>> = []
const silencios: Array<Record<string, unknown>> = []
const cambios: Array<Record<string, unknown>> = []
const origenes: Record<string, number> = {}
let conPerdida = 0, bloquesPerdidos = 0, parecidoReal = 0

for (const t of T) {
  const clase = t.clase as string
  cuentaClase[clase] = (cuentaClase[clase] ?? 0) + 1
  origenes[t.origen as string] = (origenes[t.origen as string] ?? 0) + 1
  const perdidos = (t.perdidos as string[]) ?? []
  if (perdidos.length) { conPerdida++; bloquesPerdidos += perdidos.length }
  for (const p of perdidos) {
    const c = clasificar(p, t.nuevo as string)
    cuentaPerdida[c] = (cuentaPerdida[c] ?? 0) + 1
    if (c === 'REVISAR') revisar.push({ i: t.i, fecha: t.fecha, tools: t.tools, bloque: p, nuevo: t.nuevo })
  }
  if (clase === 'SILENCIO') silencios.push(t)
  if (clase === 'CAMBIA') cambios.push({ i: t.i, origen: t.origen, perdidos: t.perdidos, agregados: t.agregados, viejo: t.viejo, nuevo: t.nuevo })
  // Parecido del replay con lo que salió de verdad (control de fidelidad).
  const a = norm(t.viejo as string), b = norm(t.real as string)
  if (a && b) {
    const pa = new Set(a.split(' ')), pb = new Set(b.split(' '))
    const inter = [...pa].filter((w) => pb.has(w)).length
    if (inter / Math.max(pa.size, pb.size) >= 0.5) parecidoReal++
  }
}

console.log(`\n═══ DIFF · ${T.length} turnos ═══`)
console.log('clases:', JSON.stringify(cuentaClase))
console.log('origen del texto nuevo:', JSON.stringify(origenes))
console.log(`\nturnos con al menos un bloque perdido: ${conPerdida}  ·  bloques perdidos totales: ${bloquesPerdidos}`)
console.log('qué eran esos bloques:', JSON.stringify(cuentaPerdida))
console.log(`\nfidelidad del replay (viejo≈real, ≥50% de palabras en común): ${parecidoReal}/${T.length}`)
console.log(`\nSILENCIOS: ${silencios.length}`)
console.log(`CAMBIA (no es pura resta): ${cambios.length}`)
console.log(`bloques a revisar a mano: ${revisar.length}`)

writeFileSync('scripts/sombra/salida/revisar.json', JSON.stringify({ revisar, silencios, cambios }, null, 2))
console.log('\n→ scripts/sombra/salida/revisar.json\n')
