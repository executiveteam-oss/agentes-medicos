/**
 * Test del criterio ÚNICO de reconocimiento de convenios
 * (convenio-aliases.convenioCoincide), que usan el executor y la pantalla de
 * salud de configuración.
 *
 * Además del set fijo, corre una REGRESIÓN sobre los convenios reales de todas
 * las clínicas: el criterio nuevo no puede dejar de reconocer nada que el
 * viejo reconocía. Un convenio que se deja de reconocer manda a una paciente a
 * colgar y no deja rastro, porque no es un error: es una respuesta.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-convenio-coincide.ts
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

async function main() {
  const { convenioCoincide, mismoConvenioPorAlias } = await import('@/lib/rules/convenio-aliases')

  /** El criterio ANTERIOR, tal cual estaba, para medir la regresión. */
  const criterioViejo = (dicho: string, cargado: string): boolean => {
    const d = (dicho ?? '').trim().toLowerCase()
    const c = (cargado ?? '').toLowerCase()
    if (!d || !c) return false
    if (c.includes(d) || d.includes(c.replace(/[.\s]+/g, ''))) return true
    return mismoConvenioPorAlias(dicho, cargado)
  }

  let mal = 0
  const cargadosFijo = ['COLMEDICA', 'COLSANITAS', 'SURAMERICANA',
    'ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A', 'MEDPLUS', 'SEGUROS BOLIVAR']
  const casos: Array<[string, boolean, string]> = [
    ['SOS', true, 'alias a la razón social'],
    ['sos', true, 'alias en minúsculas'],
    ['Colmedica', true, 'sin tilde, como está cargado'],
    ['COLMÉDICA', true, '🔴 el caso del bug: con tilde'],
    ['Colmédica Medicina Prepagada', true, 'con tilde y razón social'],
    ['Suramericana', true, 'exacto'],
    ['Medplus', true, 'exacto'],
    ['Seguros Bolívar', true, 'tilde en Bolívar'],
    ['Coomeva', false, 'no está cargado'],
    ['Sanitas', true, 'contenido en colsanitas'],
    ['', false, 'vacío'],
    ['   ', false, 'sólo espacios'],
  ]
  console.log('── casos fijos ──')
  for (const [dicho, esperado, porque] of casos) {
    const r = cargadosFijo.some((c) => convenioCoincide(dicho, c))
    const ok = r === esperado
    if (!ok) mal++
    console.log(`${ok ? '✅' : '🔴'} "${dicho}" → ${r}  (${porque})`)
  }

  // ── Regresión sobre los convenios REALES de todas las clínicas ──
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const { data } = await supabaseAdmin.from('consultation_types')
    .select('eps_name, available_conventions').eq('is_active', true)
  const nombres = new Set<string>()
  for (const row of (data ?? []) as Array<{ eps_name: string | null; available_conventions: string[] | null }>) {
    if (row.eps_name?.trim()) nombres.add(row.eps_name.trim())
    for (const c of row.available_conventions ?? []) if (c?.trim()) nombres.add(c.trim())
  }
  const lista = [...nombres]
  let perdidos = 0, nuevos = 0, pares = 0
  for (const dicho of lista) {
    for (const cargado of lista) {
      pares++
      const antes = criterioViejo(dicho, cargado)
      const ahora = convenioCoincide(dicho, cargado)
      if (antes && !ahora) { perdidos++; console.log(`🔴 REGRESIÓN: "${dicho}" ya no matchea "${cargado}"`) }
      if (!antes && ahora) { nuevos++; if (nuevos <= 8) console.log(`   ✚ nuevo: "${dicho}" ahora matchea "${cargado}"`) }
    }
  }
  console.log(`\n── regresión sobre ${lista.length} convenios reales (${pares} pares) ──`)
  console.log(`   reconocimientos PERDIDOS: ${perdidos}   ${perdidos === 0 ? '✅' : '🔴'}`)
  console.log(`   reconocimientos NUEVOS:   ${nuevos}`)
  if (perdidos > 0) mal++
  console.log(`\n${mal === 0 ? '✅ todo bien' : `🔴 ${mal} fallas`}`)
  process.exit(mal ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
