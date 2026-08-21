/** Espera a que haya N turnos del agente después del deploy. Corte duro. */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const a=(n:string,d:number)=>{const i=process.argv.indexOf(n);return i>0?Number(process.argv[i+1]):d}
const META=a('--n',6), TOPE_MIN=a('--minutos',50), DESDE=new Date(a('--desde',1787337206492)).toISOString()
const t0=Date.now()
const { data: convs } = await db.from('conversations').select('id').eq('clinic_id',ALGIA)
const ids=(convs??[]).map(c=>c.id as string)
for(;;){
  const { count } = await db.from('messages').select('id',{count:'exact',head:true})
    .in('conversation_id',ids).eq('role','agent').gte('created_at',DESDE)
  const min=Math.round((Date.now()-t0)/60000)
  if((count??0)>=META){ console.log(`✅ ${count} turnos del agente tras el deploy (${min} min)`); process.exit(0) }
  if(min>=TOPE_MIN){ console.log(`⏱ CORTE DURO a los ${min} min — sólo ${count??0} turnos. No hay tráfico suficiente.`); process.exit(2) }
  await new Promise(r=>setTimeout(r,60_000))
}
