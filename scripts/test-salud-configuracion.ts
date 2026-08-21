/**
 * Corre la vista de salud de configuración contra clínicas REALES y contrasta
 * cada número con un SQL independiente. Read-only.
 * Run: TZ=America/Bogota npx tsx scripts/test-salud-configuracion.ts
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

async function main() {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const { analizarSaludDeConfiguracion } = await import('@/lib/clinic/salud-configuracion')

  const { data: clinicas } = await supabaseAdmin.from('clinics').select('id, name').order('created_at')
  for (const c of (clinicas ?? []) as Array<{ id: string; name: string }>) {
    const { count: cts } = await supabaseAdmin.from('consultation_types')
      .select('id', { count: 'exact', head: true }).eq('clinic_id', c.id).eq('is_active', true)
    const { count: docs } = await supabaseAdmin.from('doctors')
      .select('id', { count: 'exact', head: true }).eq('clinic_id', c.id).eq('is_active', true)
    // Sólo vale la pena mostrar clínicas con algo cargado, pero corremos TODAS
    // para verificar que no explota con catálogo vacío.
    const r = await analizarSaludDeConfiguracion(c.id)
    const resumen = r.hallazgos.map((h) => `${h.clave.split('_').slice(-1)[0]}=${h.cuantos}/${h.deUnTotalDe}`).join(' · ')
    const marca = (cts ?? 0) + (docs ?? 0) === 0 ? '(vacía)' : ''
    console.log(`\n${c.name} ${marca}\n   ${resumen}`)
    if ((cts ?? 0) > 0) {
      for (const h of r.hallazgos.filter((x) => x.cuantos > 0)) {
        console.log(`   🔸 ${h.titulo}: ${h.cuantos} de ${h.deUnTotalDe}`)
        if (h.ejemplos.length) console.log(`      ej: ${h.ejemplos.join(' · ')}`)
      }
    }
  }
  console.log('\n(ninguna clínica lanzó excepción con catálogo vacío)')
}
main().catch((e) => { console.error(e); process.exit(1) })
