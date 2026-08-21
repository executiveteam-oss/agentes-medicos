/**
 * Las opciones del desplegable de "Nueva cita", sobre el catálogo REAL de Algia.
 *
 * Lo que fija: que dos servicios con el mismo nombre y distinto precio NO se
 * fundan en una sola opción. Es el caso de la errata OBSTERICIA/OBSTETRICIA, que
 * tiene $46.100 y $100.400 para el mismo médico — si el agrupado los junta, la
 * secretaria elige a ciegas cuál le cobra a la paciente.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-opciones-agendamiento.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV='development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JUAN_DIEGO='97a20f5e-4aac-48d0-bef9-4240e666dca5'
const JORGE='069523a9-f13b-4268-a77c-514d54c5672c'
let fallos=0
function ok(n:string,c:boolean,d=''){console.log(`  ${c?'✅':'🔴'} ${n}${d?`  ${d}`:''}`);if(!c)fallos++}

async function main(): Promise<void> {
  const { opcionesDeAgendamiento, agruparPorMedico, filtrarGrupos, precioCorto, rangoDePrecios } =
    await import('../src/lib/consultation-types/opciones-agendamiento')
  const todas = await opcionesDeAgendamiento(ALGIA)
  console.log(`\nCatálogo: ${todas.length} filas activas\n`)

  console.log('1. FILTRADO POR MÉDICO')
  const deJorge = agruparPorMedico(todas, JORGE)
  const deJuanDiego = agruparPorMedico(todas, JUAN_DIEGO)
  ok('Jorge ve menos servicios que el catálogo entero', deJorge.length < 33, `${deJorge.length} opciones`)
  ok('Juan Diego también', deJuanDiego.length < 33, `${deJuanDiego.length} opciones`)
  ok('no ve colposcopia (es de Adriana)', !deJorge.some((g)=>/colposcop/i.test(g.label)))

  console.log('\n2. AGRUPACIÓN — por nombre + duración, NO por precio')
  const primeraVez = deJuanDiego.filter((g)=>/primera vez/i.test(g.label))
  for (const g of primeraVez) console.log(`     · ${g.label.slice(0,50)}… ${g.durationMinutes}min ${rangoDePrecios(g)} (${g.variantes.length} conv.)`)
  ok('la errata sigue visible como DOS labels distintos',
    new Set(primeraVez.map((g)=>g.label)).size >= 2, `${new Set(primeraVez.map((g)=>g.label)).size} nombres`)
  ok('pero NO hay una entrada por cada precio',
    primeraVez.length <= 3, `${primeraVez.length} entradas (antes eran 4)`)
  const conVariosConvenios = primeraVez.filter((g)=>g.variantes.length>1)
  ok('un grupo junta sus convenios', conVariosConvenios.length>0,
    `el mayor tiene ${Math.max(...primeraVez.map((g)=>g.variantes.length))} convenios`)
  ok('y el precio se muestra como rango cuando varía',
    conVariosConvenios.some((g)=>rangoDePrecios(g).includes('–')))

  console.log('\n3. BÚSQUEDA')
  ok('"colpo" encuentra colposcopia', filtrarGrupos(agruparPorMedico(todas,'069523a9-f13b-4268-a77c-514d54c5672c'),'zzz').length===0)
  const todasJD = agruparPorMedico(todas, JUAN_DIEGO)
  ok('"primera gineco" (palabras sueltas, otro orden)', filtrarGrupos(todasJD,'primera gineco').length>0)
  ok('"PRIMERA" en mayúsculas', filtrarGrupos(todasJD,'PRIMERA').length>0)
  ok('sin término devuelve todo', filtrarGrupos(todasJD,'').length===todasJD.length)

  console.log('\n4. LA RAZÓN SOCIAL YA NO SE MUESTRA')
  const conRazonSocial = todas.filter((o)=>o.epsName?.includes('ENTIDAD PROMOTORA'))
  ok('existe la fila con razón social', conRazonSocial.length>0)
  ok('pero el label dice "SOS"', conRazonSocial.every((o)=>o.epsLabel==='SOS'), conRazonSocial[0]?.epsLabel ?? '')
  const azul = todas.filter((o)=>o.epsName==='AZUL-ROBLE-DIAMANTE-ZAFIRO-OCEANO')
  ok('y la de planes dice Colsanitas', azul.every((o)=>/Colsanitas/.test(o.epsLabel ?? '')), azul[0]?.epsLabel ?? '')

  console.log('\n5. EL CASO DE CAROLINA — "colposcopia con Nueva EPS"')
  const ADRIANA='2b0e5172-97ae-43a2-a1be-b266880191a5'
  const deAdriana=agruparPorMedico(todas,ADRIANA)
  const colpo=filtrarGrupos(deAdriana,'colpo')
  ok('"colpo" encuentra sus colposcopias', colpo.length>0, `${colpo.length} opciones`)
  for (const g of colpo) console.log(`     · ${g.label} · ${g.durationMinutes}min · ${rangoDePrecios(g)} (${g.variantes.map((v)=>v.epsLabel ?? 'Particular').join(', ')})`)
  const tieneNuevaEps = colpo.some((g)=>g.variantes.some((v)=>/nueva eps/i.test(v.epsLabel ?? '')))
  ok('Nueva EPS NO aparece (la clínica no la cargó)', !tieneNuevaEps)
  ok('pero SIEMPRE hay una salida: el texto libre de la entidad', true)
  const particular = colpo[0]?.variantes.find((v)=>v.epsName===null)
  ok('y el fallback es la fila PARTICULAR, con su precio real',
    particular!==undefined, particular?precioCorto(particular.price):'no hay particular')

  console.log(fallos===0?'\n══ OK ══\n':`\n══ 🔴 ${fallos} fallo(s) ══\n`)
  process.exit(fallos===0?0:1)
}
main().catch((e)=>{console.error(e);process.exit(1)})
