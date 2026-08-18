// ============================================================
// MIGRACIÓN ALGIA (un solo uso). Re-scrape dirigido de los documentos con
// cita futura que NO están en isalud_clientes ni en patients — para
// recuperar su teléfono desde /cliente (POST /cliente/filter/action, filtro
// por cliente_filters[nroid][text]). Inserta en isalud_clientes (idempotente).
// NO escribe patients. NO abre ningún canal de envío.
// Uso: TZ=America/Bogota npx tsx scripts/rescrape-missing-clientes.ts [--apply]
// ============================================================
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){ if(!existsSync(p))return; for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const APPLY = process.argv.includes('--apply')
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const norm = (s:string|null|undefined) => (s??'').replace(/\D/g,'')
const mask = (s:string|null|undefined) => s ? '***'+s.slice(-3) : '(vacío)'

async function main(){
  const { createClient } = await import('@supabase/supabase-js')
  const { launchBrowserAndContext, loginAndInjectCookies } = await import('../src/lib/isalud/adapter')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // ---- 1. Computar el set sin-match internamente (sin exponer cédulas) ----
  const { data: fut } = await supa.from('appointments').select('external_data')
    .eq('clinic_id', ALGIA).eq('source','isalud').gte('starts_at', new Date().toISOString())
  const futDocs = new Map<string,string>() // doc → nombre (de la cita)
  for(const r of (fut??[]) as any[]){ const d = norm(r.external_data?.identificacion); if(d) futDocs.set(d, r.external_data?.nombre_paciente ?? '') }

  const { data: pats } = await supa.from('patients').select('document_number').eq('clinic_id', ALGIA)
  const patSet = new Set((pats??[]).map((p:any)=>norm(p.document_number)).filter(Boolean))

  const cliSet = new Set<string>()
  for(let from=0;;from+=1000){
    const { data: cli } = await supa.from('isalud_clientes').select('documento').eq('clinic_id', ALGIA).range(from, from+999)
    if(!cli || cli.length===0) break
    for(const c of cli as any[]){ const d = norm(c.documento); if(d) cliSet.add(d) }
    if(cli.length < 1000) break
  }

  const missing = [...futDocs.keys()].filter(d => !patSet.has(d) && !cliSet.has(d))
  console.log(`futuros distintos=${futDocs.size} | patients=${patSet.size} | clientes=${cliSet.size}`)
  console.log(`SIN MATCH a scrapear: ${missing.length}`)
  if(missing.length === 0){ console.log('Nada que hacer.'); return }
  if(missing.length > 200){ console.log('ABORT: más de 200 sin-match, algo cambió — revisar antes.'); return }

  // ---- 2. Login + scrape dirigido por documento ----
  const { data: integ } = await supa.from('sync_integrations').select('credentials')
    .eq('clinic_id', ALGIA).eq('provider','isalud').neq('sync_status','disabled').limit(1).maybeSingle()
  const c = (integ as any).credentials
  const creds = { subdomain: c.subdomain, username: c.username, password: c.password }
  const base = `https://${creds.subdomain}.isalud.co`
  const { browser, context } = await launchBrowserAndContext()

  const found: Array<{documento:string; nombre:string; telefono:string}> = []
  const notFound: string[] = []
  try {
    const page = await loginAndInjectCookies(context, creds)
    let i = 0
    for(const doc of missing){
      i++
      try {
        await page.goto(`${base}/cliente`, { waitUntil:'domcontentloaded', timeout:30000 })
        const csrf = await page.evaluate(() => (document.querySelector('input[name="cliente_filters[_csrf_token]"]') as HTMLInputElement)?.value ?? '')
        await page.request.post(`${base}/cliente/filter/action`, { form: {
          'cliente_filters[_csrf_token]': csrf, 'cliente_filters[tipoidentificacion_id]': '',
          'cliente_filters[nroid][text]': doc, 'cliente_filters[primernombre][text]': '',
          'cliente_filters[segundonombre][text]': '', 'cliente_filters[primerapellido][text]': '',
          'cliente_filters[segundoapellido][text]': '', 'cliente_filters[acudiente][text]': '', 'cliente_filters[vip]': '',
        }, maxRedirects: 5 })
        await page.goto(`${base}/cliente`, { waitUntil:'domcontentloaded', timeout:30000 })
        const row = await page.evaluate((d) => {
          for(const tr of Array.from(document.querySelectorAll('table tbody tr'))){
            const cells = tr.querySelectorAll('td')
            const docu = (cells[2]?.textContent?.trim()??'').replace(/[^\d]/g,'')
            if(docu===d) return { nombre:(cells[3]?.textContent?.trim()??'').toUpperCase(), telefono:(cells[5]?.textContent?.trim()??'').replace(/[^\d+]/g,'') }
          }
          return null
        }, doc)
        if(row && (row.nombre || row.telefono)){
          const rec = { documento: doc, nombre: row.nombre || futDocs.get(doc) || '', telefono: row.telefono }
          found.push(rec)
          if(APPLY){ // inserción INCREMENTAL (resumible): missing ya excluye clientes existentes
            const { error } = await supa.from('isalud_clientes').insert({ clinic_id: ALGIA, documento: rec.documento, nombre: rec.nombre, telefono: rec.telefono || null, loaded_at: new Date().toISOString() })
            if(error) console.log(`  INSERT err ${mask(doc)}: ${error.message}`)
          }
        }
        else notFound.push(doc)
      } catch(e:any){ notFound.push(doc); console.log(`  err ${mask(doc)}: ${e?.message?.slice(0,60)}`) }
      if(i % 20 === 0) console.log(`  ...${i}/${missing.length} (found ${found.length})`)
      await page.waitForTimeout(1000) // rate limit
    }
  } finally { await browser.close() }

  const conTel = found.filter(f => f.telefono).length
  console.log(`\nRESULTADO scrape: encontrados=${found.length} (con tel=${conTel}) | no encontrados=${notFound.length}`)

  if(!APPLY) console.log('\nDRY-RUN. Agregá --apply para insertar en isalud_clientes.')
  else console.log(`\nInsertados en isalud_clientes (incremental): ${found.filter(f=>f.telefono||f.nombre).length} (con tel=${conTel})`)
}
main().catch(e=>console.log('FATAL: '+(e?.message??e)))
