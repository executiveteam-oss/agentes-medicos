// ============================================================
// EL TITULAR — lo que se lee sin abrir el informe.
//
// Tres números y una causa. Con eso se decide si vale la pena leer el detalle,
// que es la mitad de las semanas en las que no va a pasar nada.
//
// Y la parte que importa de verdad: la COMPARACIÓN. Un informe suelto dice
// cómo estuvo la semana; la serie dice si el producto está mejorando. Por eso
// los informes se guardan fechados y por eso este script lee todos los que hay.
//
// Correr:
//   npx tsx .claude/skills/analizar-escalaciones/titular.ts          # último + delta
//   npx tsx .claude/skills/analizar-escalaciones/titular.ts --serie  # la serie entera
//
// No toca la base. Lee solo docs/analisis-escalaciones/*.md.
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const DIR = 'docs/analisis-escalaciones'
const SERIE = process.argv.includes('--serie')

interface Grupo { clave: string; casos: number; evitables: number }
interface Informe {
  archivo: string
  periodo_desde: string
  periodo_hasta: string
  total: number
  evitables: number
  suficiencia: string
  motivo_inferido: number
  sin_clasificar: number
  grupos: Grupo[]
}

/**
 * Parser del frontmatter. Deliberadamente mínimo: entiende exactamente la forma
 * que la skill escribe y nada más. Meter una dependencia de YAML para leer diez
 * claves planas es peor negocio que veinte líneas que se leen de una sentada.
 */
function parseFrontmatter(texto: string, archivo: string): Informe | null {
  const m = texto.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null

  const plano: Record<string, string> = {}
  const grupos: Grupo[] = []
  let enGrupos = false

  for (const linea of m[1].split('\n')) {
    if (/^grupos:\s*$/.test(linea)) { enGrupos = true; continue }

    if (enGrupos) {
      // - clave: friccion_del_agente | casos: 12 | evitables: 12
      const g = linea.match(/^\s*-\s*clave:\s*(\S+)\s*\|\s*casos:\s*(\d+)\s*\|\s*evitables:\s*(\d+)/)
      if (g) { grupos.push({ clave: g[1], casos: +g[2], evitables: +g[3] }); continue }
      if (/^\S/.test(linea)) enGrupos = false   // volvió al nivel de arriba
    }

    const kv = linea.match(/^([a-z_]+):\s*(.*)$/)
    if (kv) plano[kv[1]] = kv[2].trim()
  }

  if (!plano.periodo_desde || !plano.total) return null
  return {
    archivo,
    periodo_desde: plano.periodo_desde,
    periodo_hasta: plano.periodo_hasta ?? plano.periodo_desde,
    total: +plano.total,
    evitables: +(plano.evitables ?? 0),
    suficiencia: plano.suficiencia ?? 'DESCONOCIDA',
    motivo_inferido: +(plano.motivo_inferido ?? 0),
    sin_clasificar: +(plano.sin_clasificar ?? 0),
    grupos: grupos.sort((a, b) => b.casos - a.casos),
  }
}

function pct(parte: number, total: number, suficiencia: string): string {
  // Con muestra insuficiente el porcentaje miente con cara de dato:
  // "2 de 5 = 40%" no es 40% de nada.
  if (total === 0) return '—'
  if (suficiencia === 'INSUFICIENTE') return 'muestra insuficiente para %'
  return `${Math.round((parte / total) * 100)}%`
}

function flecha(actual: number, previo: number): string {
  const d = actual - previo
  if (d === 0) return '  =  igual que el período anterior'
  const signo = d > 0 ? '▲' : '▼'
  return `  ${signo}  ${d > 0 ? '+' : ''}${d} vs. el período anterior`
}

function main() {
  if (!existsSync(DIR)) {
    console.log(`No hay informes todavía (falta ${DIR}/).`)
    return
  }

  const informes = readdirSync(DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => parseFrontmatter(readFileSync(join(DIR, f), 'utf8'), f))
    .filter((i): i is Informe => i !== null)
    .sort((a, b) => a.periodo_desde.localeCompare(b.periodo_desde))

  if (informes.length === 0) {
    console.log(`No hay informes con frontmatter válido en ${DIR}/.`)
    return
  }

  if (SERIE) {
    console.log('\nSERIE — ¿está mejorando?\n')
    console.log('  período                    total  evitables         causa que más pesa')
    console.log('  ' + '─'.repeat(74))
    for (const i of informes) {
      const top = i.grupos[0]
      const ev = `${i.evitables}/${i.total}`.padEnd(9)
      const marca = i.suficiencia === 'INSUFICIENTE' ? ' ⚠' : '  '
      console.log(`  ${(i.periodo_desde + '→' + i.periodo_hasta).padEnd(25)} ${String(i.total).padStart(4)}${marca} ${ev} ${(top?.clave ?? '—').slice(0, 38)}`)
    }
    console.log('\n  ⚠ = muestra insuficiente, el número no se compara.\n')
    return
  }

  const ult = informes[informes.length - 1]
  const prev = informes.length > 1 ? informes[informes.length - 2] : null
  const top = ult.grupos[0]

  console.log('')
  console.log('━'.repeat(62))
  console.log(`ESCALACIONES · ${ult.periodo_desde} → ${ult.periodo_hasta}`)
  console.log('━'.repeat(62))
  console.log(`  Total:      ${ult.total}${prev ? flecha(ult.total, prev.total) : ''}`)
  console.log(`  Evitables:  ${ult.evitables} de ${ult.total}   (${pct(ult.evitables, ult.total, ult.suficiencia)})`)
  if (top) {
    console.log(`  Pesa más:   ${top.clave} — ${top.casos} caso${top.casos === 1 ? '' : 's'}` +
                `${top.evitables === top.casos ? ' (todos evitables)' : `, ${top.evitables} evitable${top.evitables === 1 ? '' : 's'}`}`)
  }

  if (ult.suficiencia === 'INSUFICIENTE') {
    console.log('')
    console.log('  ⚠️  MUESTRA INSUFICIENTE — los números describen, no concluyen.')
  } else if (ult.suficiencia === 'PRELIMINAR') {
    console.log('')
    console.log('  ⚠️  Muestra preliminar — señal, no medición.')
  }
  if (ult.motivo_inferido > 0) {
    console.log(`  ⚠️  ${ult.motivo_inferido} de ${ult.total} con motivo INFERIDO (deducido del texto, no leído del campo).`)
  }
  if (ult.sin_clasificar > 0) {
    console.log(`  ⚠️  ${ult.sin_clasificar} sin clasificar — la taxonomía se quedó corta.`)
  }

  console.log('')
  console.log(`  Detalle: ${DIR}/${ult.archivo}`)
  if (informes.length > 1) console.log(`  Serie:   --serie  (${informes.length} informes)`)
  console.log('━'.repeat(62))
  console.log('')
}

main()
