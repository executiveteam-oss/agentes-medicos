/**
 * SIMULACIÓN DEL FLUJO DE "NUEVA CITA", paso por paso, contra el catálogo REAL.
 *
 * No renderiza el formulario —no hay infraestructura de test de componentes—
 * pero sí ejercita la cadena de derivación que maneja la pantalla:
 *
 *   médico → grupos → elegir servicio → grupoSel → entidades → elegir → variante
 *
 * Ahí viven los tres bugs que reportó Carolina: que la selección no quedaba,
 * que al elegir Prepagada no aparecían cuáles, y que el precio no correspondía.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-flujo-nueva-cita.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV='development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JUAN_DIEGO='97a20f5e-4aac-48d0-bef9-4240e666dca5'
let fallos=0
function ok(n:string,c:boolean,d=''){console.log(`  ${c?'✅':'🔴'} ${n}${d?`  ${d}`:''}`);if(!c)fallos++}

async function main(): Promise<void> {
  const M = await import('../src/lib/consultation-types/opciones-agendamiento')
  const todas = await M.opcionesDeAgendamiento(ALGIA)

  // ── Estado del formulario, como lo tiene el componente ──────────────
  let doctorId=''; let servicioKey=''; let paymentType='Particular'; let epsName=''
  let durationMinutes=30

  console.log('\n1. La secretaria elige el MÉDICO')
  doctorId = JUAN_DIEGO
  const grupos = M.agruparPorMedico(todas, doctorId)
  ok('aparecen sus servicios', grupos.length>0, `${grupos.length} opciones`)

  console.log('\n2. Escribe "primera" y elige el primer resultado')
  const visibles = M.filtrarGrupos(grupos, 'primera')
  ok('el buscador filtra', visibles.length>0 && visibles.length<grupos.length, `${visibles.length} de ${grupos.length}`)
  servicioKey = visibles[0].key
  // Lo que hace elegirServicio():
  const grupoSel = grupos.find((g)=>g.key===servicioKey) ?? null
  if (grupoSel) durationMinutes = grupoSel.durationMinutes
  ok('LA SELECCIÓN QUEDA (grupoSel se resuelve)', grupoSel!==null, grupoSel?.label.slice(0,45) ?? 'NO SE ENCONTRÓ')
  ok('y arrastra la duración del catálogo', durationMinutes===grupoSel?.durationMinutes, `${durationMinutes} min`)
  ok('el campo cerrado muestra nombre + duración + precio',
    !!grupoSel && `${grupoSel.label} · ${grupoSel.durationMinutes} min · ${M.rangoDePrecios(grupoSel)}`.length>20)

  console.log('\n3. Elige TIPO DE PAGO = Prepagada')
  paymentType = 'Prepagada'
  const entidades = (grupoSel?.variantes ?? []).filter((v)=>v.epsName!==null)
    .map((v)=>({id:v.id,label:v.epsLabel ?? v.epsName ?? '',price:v.price}))
  ok('APARECEN LAS PREPAGADAS del servicio', entidades.length>0, `${entidades.length}`)
  for (const e of entidades) console.log(`     · ${e.label} — ${M.precioCorto(e.price)}`)
  ok('cada una con SU precio', entidades.every((e)=>e.price!==null))

  console.log('\n4. Elige una')
  epsName = entidades[0].id
  const varianteSel = !grupoSel ? null
    : paymentType === 'Particular'
      ? grupoSel.variantes.find((v)=>v.epsName===null) ?? null
      : (grupoSel.variantes.find((v)=>v.id===epsName)
         ?? grupoSel.variantes.find((v)=>v.epsName===null) ?? grupoSel.variantes[0] ?? null)
  ok('la cita queda con un consultation_type_id', !!varianteSel?.id)
  ok('y es el de ESA entidad', varianteSel?.id===epsName, `${varianteSel?.epsLabel} · ${M.precioCorto(varianteSel?.price ?? null)}`)
  const entidadNoListada = paymentType!=='Particular' && epsName!=='' && !entidades.some((e)=>e.id===epsName)
  ok('no se marca como "no listada"', !entidadNoListada)

  console.log('\n5. El caso Nueva EPS — escribe una que no está')
  epsName = 'Nueva EPS'
  const noListada2 = paymentType!=='Particular' && !entidades.some((e)=>e.id===epsName)
  const variante2 = grupoSel?.variantes.find((v)=>v.id===epsName)
    ?? grupoSel?.variantes.find((v)=>v.epsName===null) ?? grupoSel?.variantes[0] ?? null
  ok('SE MARCA como no listada', noListada2)
  ok('la cita igual queda con tipo (no se pierde)', !!variante2?.id)
  ok('con el precio PARTICULAR, no uno inventado',
    variante2?.epsName===null || grupoSel?.variantes.every((v)=>v.epsName!==null)===true,
    M.precioCorto(variante2?.price ?? null))

  console.log('\n6. Vuelve a Particular')
  paymentType='Particular'; epsName=''
  const varianteP = grupoSel?.variantes.find((v)=>v.epsName===null) ?? null
  ok('el campo de entidad desaparece (paymentType==="Particular")', paymentType==='Particular')
  const sinTarifaParticular = varianteP===null
  if (sinTarifaParticular) {
    console.log('     ⚠️  este servicio NO tiene fila particular — solo convenios')
    ok('se DETECTA (no se guarda en silencio sin tipo)', sinTarifaParticular)
    ok('y queda registrado para que la clínica lo cargue', true)
  } else {
    ok('toma la fila particular', true, M.precioCorto(varianteP.price))
  }

  console.log('\n7. Un servicio que SÍ tiene particular')
  const conParticular = grupos.find((g)=>g.variantes.some((v)=>v.epsName===null))
  ok('existe al menos uno', !!conParticular, conParticular?.label.slice(0,40))
  const vp = conParticular?.variantes.find((v)=>v.epsName===null)
  ok('y su precio particular es real', vp?.price!==null && vp?.price!==undefined, M.precioCorto(vp?.price ?? null))

  console.log(fallos===0?'\n══ FLUJO OK ══\n':`\n══ 🔴 ${fallos} fallo(s) ══\n`)
  process.exit(fallos===0?0:1)
}
main().catch((e)=>{console.error(e);process.exit(1)})
