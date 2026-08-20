/**
 * Las tres piezas del cierre de la causa B, contra producción.
 *
 * 1. IDEMPOTENCIA — un reintento de la MISMA cita devuelve la existente como
 *    éxito, no un choque. Es la clase del 17/08: el agente creó la cita y doce
 *    segundos después le dijo a la paciente que había fallado.
 * 2. GRILLA — una hora fuera de :00/:15/:30/:45 se rechaza como inexistente,
 *    no como ocupada. (08:15 SÍ es válida: la grilla es de 15 min.)
 * 3. EL TEXTO DEL CHOQUE — sin "se acaba de ocupar", con los cupos reales.
 *
 * Crea su propia ficha y sus propias citas, y borra todo en un finally.
 *
 * ⚠️ create_appointment dispara notifyStaffAppointmentCreated: INTENTA un
 * WhatsApp al teléfono interno de la clínica (hoy falla con 131047, ventana
 * vencida). Es el mismo efecto que ya tuvo el e2e de reagendamiento.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-causa-b.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p: string): void {
  if (!existsSync(p)) return
  for (const l of readFileSync(p,'utf-8').split('\n')) {
    const t=l.trim(); if(!t||t.startsWith('#'))continue
    const e=t.indexOf('='); if(e<0)continue
    const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim()
    if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1)
    if(!process.env[k])process.env[k]=v
  }
}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE='069523a9-f13b-4268-a77c-514d54c5672c'
const CT='8b0aebca-6a1f-43b7-8a04-55f8feba5aa0'      // sin reglas
const TEL='+570000000002', NOMBRE='PRUEBA CAUSA B NO CONTACTAR'
const EN_GRILLA = '2026-09-25T13:15:00.000Z'   // 08:15 COT, viernes — cupo válido y libre
const FUERA     = '2026-09-25T13:07:00.000Z'   // 08:07 COT — no existe en la grilla

let fallos=0
function ok(n:string,c:boolean,d=''){console.log(`  ${c?'✅':'🔴'} ${n}${d?`  ${d}`:''}`);if(!c)fallos++}

async function main(): Promise<void> {
  const supa=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const {executeTool}=await import('../src/agents/tools/executor')
  const {puedeEscribirseLaCita}=await import('../src/lib/calendar/appointment-write-check')
  const {isHardBookingFailure}=await import('../src/agents/booking-failure')
  const {data:clinic}=await supa.from('clinics').select('*').eq('id',ALGIA).single()
  const {data:doctor}=await supa.from('doctors').select('*').eq('id',JORGE).single()

  const base=await supa.from('appointments').select('id',{count:'exact',head:true}).eq('clinic_id',ALGIA)
  let pid:string|null=null; const creadas:string[]=[]
  try {
    const {data:pac,error:ep}=await supa.from('patients')
      .insert({clinic_id:ALGIA,name:NOMBRE,phone:TEL,proactive_contact_opt_in:false}).select('id').single()
    if(ep) throw new Error(ep.message)
    pid=pac!.id

    console.log('\n1. IDEMPOTENCIA — crear la misma cita DOS veces')
    const r1=await executeTool('create_appointment',
      {doctor_id:JORGE,patient_name:NOMBRE,patient_phone:TEL,starts_at:EN_GRILLA,consultation_type_id:CT},
      ALGIA,clinic as never,doctor as never,null,pid)
    ok('primer intento: éxito',r1.success===true,(r1 as {error?:string}).error??'')
    const id1=((r1.data??{}) as {appointmentData?:{id:string}}).appointmentData?.id
    if(id1) creadas.push(id1)

    const r2=await executeTool('create_appointment',
      {doctor_id:JORGE,patient_name:NOMBRE,patient_phone:TEL,starts_at:EN_GRILLA,consultation_type_id:CT},
      ALGIA,clinic as never,doctor as never,null,pid)
    const id2=((r2.data??{}) as {appointmentData?:{id:string}}).appointmentData?.id
    ok('segundo intento: TAMBIÉN éxito (no choque)',r2.success===true,(r2 as {error?:string}).error??'')
    ok('devuelve LA MISMA cita',id1!==undefined&&id1===id2,`${id1?.slice(0,8)} vs ${id2?.slice(0,8)}`)
    const dup=await supa.from('appointments').select('id',{count:'exact',head:true})
      .eq('clinic_id',ALGIA).eq('doctor_id',JORGE).eq('starts_at',EN_GRILLA).eq('status','confirmed')
    ok('quedó UNA sola fila, no dos',dup.count===1,`filas=${dup.count}`)

    console.log('\n2. GRILLA — 08:07 no existe como cupo')
    const g=await puedeEscribirseLaCita({clinic:clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
      doctorId:JORGE,startsAt:FUERA,consultationTypeId:CT,now:new Date()})
    ok('bloqueada',!g.ok,g.ok?'':`outcome=${g.outcome}`)
    ok('el motivo es fuera_de_grilla, NO "ocupada"',!g.ok&&g.outcome==='fuera_de_grilla')
    if(!g.ok) console.log(`     → "${g.messageForPatient}"`)

    console.log('\n3. EL TEXTO DEL CHOQUE')
    const c=await puedeEscribirseLaCita({clinic:clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
      doctorId:JORGE,startsAt:EN_GRILLA,consultationTypeId:CT,now:new Date()})
    ok('el cupo ya tomado se detecta',!c.ok&&c.outcome==='slot_taken')
    if(!c.ok){
      console.log(`     → "${c.messageForPatient}"`)
      ok('NO dice "se acaba de ocupar"',!/acaba de ocupar/i.test(c.messageForPatient))
      ok('NO dice "mientras hablábamos"',!/mientras habl/i.test(c.messageForPatient))
    }
    ok('el choque ya NO escala',!isHardBookingFailure('create_appointment','SLOT_JUST_TAKEN'))
    ok('fecha pasada / agenda cerrada SÍ escalan',isHardBookingFailure('create_appointment','BLOCKED_BY_SCHEDULE'))

    console.log('\n   Lo que recibiría la paciente, por el executor real:')
    const r3=await executeTool('create_appointment',
      {doctor_id:JORGE,patient_name:'OTRA PRUEBA',patient_phone:'+570000000003',starts_at:EN_GRILLA,consultation_type_id:CT},
      ALGIA,clinic as never,doctor as never)
    const d3=(r3.data??{}) as {message_for_patient?:string;cupos_disponibles?:unknown[]}
    console.log(`     "${d3.message_for_patient}"`)
    ok('trae cupos concretos',(d3.cupos_disponibles?.length??0)>0,`${d3.cupos_disponibles?.length??0} cupos`)
  } finally {
    console.log('\n4. LIMPIEZA')
    for(const id of creadas) await supa.from('appointments').delete().eq('id',id).eq('clinic_id',ALGIA)
    await supa.from('appointments').delete().eq('clinic_id',ALGIA).eq('starts_at',EN_GRILLA).eq('doctor_id',JORGE).eq('source','whatsapp_agent')
    if(pid) await supa.from('patients').delete().eq('id',pid).eq('clinic_id',ALGIA)
    await supa.from('patients').delete().eq('clinic_id',ALGIA).in('phone',[TEL,'+570000000003'])
    const fin=await supa.from('appointments').select('id',{count:'exact',head:true}).eq('clinic_id',ALGIA)
    ok(`citas de vuelta en ${base.count}`,fin.count===base.count,`ahora ${fin.count}`)
  }
  console.log(fallos===0?'\n══ CAUSA B CERRADA ══\n':`\n══ 🔴 ${fallos} fallo(s) ══\n`)
  process.exit(fallos===0?0:1)
}
main().catch(e=>{console.error('\n🔴',e.message);process.exit(1)})
