import { existsSync, readFileSync, writeFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: rows } = await db.from('conversation_media').select('storage_path, created_at')
  .eq('conversation_id','fc58224a-ff17-41c3-b092-43e43d49c37f').order('created_at')
const buckets = ['whatsapp-media']
let bucketOk = ''
for (const b of buckets) {
  const { error } = await db.storage.from(b).download((rows![0] as {storage_path:string}).storage_path)
  if (!error) { bucketOk = b; break }
}
console.log('bucket:', bucketOk || '(no encontrado)')
if (!bucketOk) { const { data: bs } = await db.storage.listBuckets(); console.log('buckets:', (bs??[]).map(b=>b.name).join(' · ')); process.exit(1) }
let i = 0
for (const r of (rows ?? []) as Array<{storage_path:string}>) {
  const { data } = await db.storage.from(bucketOk).download(r.storage_path)
  if (!data) continue
  const buf = Buffer.from(await data.arrayBuffer())
  const out = `/tmp/auth_${++i}.jpg`
  writeFileSync(out, buf)
  console.log(`  ${out}  (${Math.round(buf.length/1024)} KB)`)
}
