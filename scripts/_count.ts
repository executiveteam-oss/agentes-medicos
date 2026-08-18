if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){ if(!existsSync(p))return; for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
async function main(){
  const { createClient } = await import('@supabase/supabase-js')
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { count } = await s.from('patients').select('*',{count:'exact',head:true}).eq('clinic_id','dac775fe-6ebd-47e3-89b4-eeb1a821facb')
  console.log('patients:', count)
}
main()
