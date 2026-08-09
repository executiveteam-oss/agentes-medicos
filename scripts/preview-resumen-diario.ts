/**
 * Vista previa del RESUMEN DIARIO tal como va a llegar al teléfono del médico.
 * Solo lectura — no envía nada.
 *
 * Replica el armado de `morning-report/route.ts` (misma query, mismo orden,
 * mismo fallback de nombre, misma pluralización) y mete los parámetros en el
 * body APROBADO por Meta. Lo que imprime es, carácter por carácter, lo que
 * WhatsApp va a renderizar.
 *
 * Run: TZ=America/Bogota npx tsx scripts/preview-resumen-diario.ts [YYYY-MM-DD]
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { formatTimeForPatient } from '../src/lib/utils/dates'
import { RESUMEN_TEMPLATE_BODY } from '../src/lib/whatsapp/appointment-templates'
import { toTitleCase } from '../src/lib/utils/normalize-name'
import { esCupoCompartido } from '../src/components/dashboard/calendar/types'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DIA = process.argv[2] ?? '2026-08-10'

async function main() {
  const { data: doctors } = await sb.from('doctors')
    .select('id, name, phone, daily_summary_enabled')
    .eq('clinic_id', ALGIA).eq('is_active', true).eq('daily_summary_enabled', true)

  for (const d of (doctors ?? []).filter(x => (x.phone as string ?? '').trim() !== '')) {
    const { data: appts } = await sb.from('appointments')
      .select('starts_at, status, reason, external_data, patients(name)')
      .eq('clinic_id', ALGIA).eq('doctor_id', d.id as string)
      .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
      .gte('starts_at', `${DIA}T00:00:00-05:00`)
      .lte('starts_at', `${DIA}T23:59:59-05:00`)
      .order('starts_at', { ascending: true })

    const rows = (appts ?? []).filter(
      a => a.status !== 'blocked_external' || esCupoCompartido(a.status as string, a.reason as string | null))
    if (rows.length === 0) continue

    // — copia exacta de morning-report/route.ts —
    const listItems = rows.map(a => {
      const time = formatTimeForPatient(a.starts_at as string)
      const linkedName = (a.patients as unknown as { name: string } | null)?.name
      const externalName = ((a.external_data as { nombre_paciente?: string } | null)?.nombre_paciente ?? '').trim()
      return `*${time}* ${toTitleCase(linkedName || externalName || 'Paciente')}`
    })
    const count = rows.length
    const countLabel = count === 1 ? '1 cita' : `${count} citas`
    const secondVar = `${countLabel} — ${listItems.join('  ·  ')}`

    const mensaje = RESUMEN_TEMPLATE_BODY
      .replaceAll('{{1}}', toTitleCase(d.name as string))
      .replaceAll('{{2}}', secondVar)

    console.log('\n' + '━'.repeat(72))
    console.log(`PARA: ${d.name}  ·  ${d.phone}  ·  ${count} citas`)
    console.log('━'.repeat(72))
    console.log(mensaje)
    console.log('─'.repeat(72))
    console.log(`caracteres: ${mensaje.length}   ·   {{2}} solo: ${secondVar.length}`)
    // WhatsApp corta el body del template en 1024 caracteres.
    if (mensaje.length > 1024) console.log(`⚠️  PASA EL LÍMITE DE 1024 — WhatsApp lo rechaza o lo trunca`)
    // Un parámetro no puede traer saltos de línea ni tabs: por eso todo va seguido.
    if (/[\n\t]/.test(secondVar)) console.log(`⚠️  el parámetro trae \\n o \\t — Meta lo rechaza (132000)`)
  }
  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) })
