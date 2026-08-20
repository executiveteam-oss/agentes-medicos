/**
 * SYNC COMPLETO DE iSALUD + COMPARACIÓN CONTRA OMUWAN.
 *
 * Kelly reporta que algunas citas que agenda en iSalud aparecen en Omuwan y
 * otras no. Este script corre el scrape completo (los mismos 60 días que corre
 * el cron cada hora — no hay modo incremental) y después contrasta:
 *
 *   ¿cuántas citas futuras tiene iSalud?  vs  ¿cuántas quedaron en Omuwan?
 *
 * Si no coinciden, lista las que faltan con el motivo, que es lo que el cron
 * tira a un log que nadie lee.
 *
 * Solo lectura sobre iSalud. La escritura en Omuwan es la misma que hace el
 * cron cada hora (upsert por external_his_id); no borra ni notifica a nadie.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sync-isalud-completo-y-comparar.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p: string): void {
  if (!existsSync(p)) return
  for (const l of readFileSync(p, 'utf-8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const e = t.indexOf('='); if (e < 0) continue
    const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

function hoyCOT(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { scrapeISalud } = await import('../src/lib/isalud/adapter')
  const { ingestISaludData } = await import('../src/lib/isalud/sync-agent')

  const { data: integ } = await supa
    .from('sync_integrations')
    .select('credentials, config')
    .eq('clinic_id', ALGIA).eq('provider', 'isalud').single()
  if (!integ) throw new Error('No hay integración iSalud para Algia')

  const dias = (integ.config as { dias_adelante?: number })?.dias_adelante ?? 60
  const hoy = hoyCOT()
  console.log(`\n═══ SYNC COMPLETO — ${dias} días desde ${hoy} ═══\n`)

  const antes = await supa.from('appointments').select('id', { count: 'exact', head: true })
    .eq('clinic_id', ALGIA).eq('source', 'isalud').gte('starts_at', `${hoyCOT()}T00:00:00-05:00`)
  console.log(`Omuwan ANTES: ${antes.count} citas futuras de iSalud\n`)

  const t0 = Date.now()
  const result = await scrapeISalud(integ.credentials as never, { diasAdelante: dias })
  const segundos = Math.round((Date.now() - t0) / 1000)

  const futuras = result.admisiones.filter((a) => a.fecha >= hoy)
  console.log(`\n─── SCRAPE (${segundos}s) ───`)
  console.log(`  profesionales:        ${result.profesionales.length}`)
  console.log(`  admisiones totales:   ${result.admisiones.length}`)
  console.log(`  admisiones FUTURAS:   ${futuras.length}`)
  console.log(`  errores del scrape:   ${result.errors.length}`)
  if (result.errors.length) result.errors.slice(0, 10).forEach((e) => console.log(`     · ${e}`))

  // ¿Hasta qué día llegó de verdad?
  const fechas = [...new Set(futuras.map((a) => a.fecha))].sort()
  console.log(`  rango cubierto:       ${fechas[0] ?? '—'} → ${fechas[fechas.length - 1] ?? '—'} (${fechas.length} días con citas)`)

  console.log(`\n─── INGESTA ───`)
  const ing = await ingestISaludData(ALGIA, result.profesionales, result.admisiones, result.errors)
  console.log(`  ${JSON.stringify(ing)}`)

  const despues = await supa.from('appointments').select('id', { count: 'exact', head: true })
    .eq('clinic_id', ALGIA).eq('source', 'isalud').gte('starts_at', `${hoy}T00:00:00-05:00`)

  // ── LA COMPARACIÓN ──
  console.log(`\n═══ iSALUD  vs  OMUWAN ═══`)
  console.log(`  iSalud, de hoy en adelante:   ${futuras.length}`)
  console.log(`  Omuwan, de hoy en adelante:   ${despues.count}   (antes: ${antes.count})`)

  const { data: enOmuwan } = await supa.from('appointments')
    .select('external_his_id').eq('clinic_id', ALGIA).eq('source', 'isalud')
    .gte('starts_at', `${hoy}T00:00:00-05:00`)
  const ids = new Set((enOmuwan ?? []).map((a) => a.external_his_id as string))

  const faltan = futuras.filter((a) => !ids.has(`isalud-${a.id}-${a.fecha}`))
  if (faltan.length === 0) {
    console.log(`\n  ✅ Todas las citas futuras de iSalud están en Omuwan.\n`)
  } else {
    console.log(`\n  🔴 FALTAN ${faltan.length}:\n`)
    for (const f of faltan) {
      console.log(`     ${f.fecha} ${f.hora_inicial}  ${f.profesional_nombre}`)
      console.log(`        fase="${f.fase}" ubicación="${f.ubicacion}" proc="${f.procedimiento}" paciente="${f.nombre_paciente ? 'sí' : 'SIN NOMBRE'}"`)
    }
    const porMedico = new Map<string, number>()
    const porFase = new Map<string, number>()
    const porUbic = new Map<string, number>()
    for (const f of faltan) {
      porMedico.set(f.profesional_nombre, (porMedico.get(f.profesional_nombre) ?? 0) + 1)
      porFase.set(f.fase, (porFase.get(f.fase) ?? 0) + 1)
      porUbic.set(f.ubicacion, (porUbic.get(f.ubicacion) ?? 0) + 1)
    }
    console.log(`\n  Por médico:    ${[...porMedico].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
    console.log(`  Por fase:      ${[...porFase].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
    console.log(`  Por ubicación: ${[...porUbic].map(([k, v]) => `${k}=${v}`).join(' · ')}\n`)
  }
}
main().catch((e) => { console.error('\n🔴', e); process.exit(1) })
