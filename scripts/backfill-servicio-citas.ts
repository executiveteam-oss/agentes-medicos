/**
 * Llena `external_service_name` (y, cuando el match es inequívoco,
 * `consultation_type_id`) en las citas que ya estaban importadas.
 *
 * El sync nuevo lo guarda solo, pero las 2.900 citas ya importadas quedarían
 * sin servicio hasta que iSalud las vuelva a tocar. Este script las alcanza.
 *
 * DOS ESCRITURAS CON RIESGO DISTINTO:
 *   · external_service_name = el texto de iSalud. Sin riesgo: es lo que el HIS
 *     dice que es la cita.
 *   · consultation_type_id  = la fila del catálogo, que lleva PRECIO, duración
 *     y reglas. Solo cuando no hay duda.
 *
 * Dry-run por defecto. Para escribir: --aplicar
 * Correr: npx tsx scripts/backfill-servicio-citas.ts [--aplicar] [--todas]
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { matchearServicio, parsearEntidadISalud, type FilaCatalogo } from '../src/lib/isalud/servicio-cita'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const APLICAR = process.argv.includes('--aplicar')
// Por defecto solo las FUTURAS: son las que la secretaria mira. Las pasadas no
// cambian de servicio y tocarlas es riesgo sin beneficio.
const TODAS = process.argv.includes('--todas')

async function main() {
  const { data: cat } = await sb.from('consultation_types')
    .select('id, name, eps_name, price, is_active, doctor_id').eq('clinic_id', ALGIA)
  const catalogo = (cat ?? []) as FilaCatalogo[]

  let q = sb.from('appointments')
    .select('id, doctor_id, starts_at, external_his_id, external_data, external_service_name, consultation_type_id')
    .eq('clinic_id', ALGIA).eq('external_source', 'isalud')
  if (!TODAS) q = q.gte('starts_at', new Date().toISOString())
  const { data: citas } = await q

  // Las que iSalud no trae con procedimiento: se busca en el histórico, que
  // guarda el scrape completo y a veces tiene la categoría del servicio.
  const sinProc = (citas ?? []).filter((a) => !((a.external_data as Record<string, string>)?.procedimiento ?? '').trim())
  const agendaIds = sinProc
    .map((a) => Number(/^isalud-(\d+)-/.exec(a.external_his_id as string)?.[1]))
    .filter((n) => Number.isFinite(n))
  const { data: hist } = agendaIds.length
    ? await sb.from('isalud_historico_rows')
        .select('isalud_agenda_id, procedimiento, servicio')
        .eq('clinic_id', ALGIA).in('isalud_agenda_id', agendaIds)
    : { data: [] }
  const porAgendaId = new Map((hist ?? []).map((h) => [Number(h.isalud_agenda_id), h]))

  const cuenta: Record<string, number> = {}
  const ambiguas: { texto: string; motivo: string }[] = []
  const escrituras: { id: string; servicio: string; ctId: string | null; origen: string }[] = []

  for (const a of citas ?? []) {
    const ed = (a.external_data ?? {}) as Record<string, string>
    let servicio = (ed.procedimiento ?? '').trim()
    let origen = 'payload'

    if (!servicio) {
      const h = porAgendaId.get(Number(/^isalud-(\d+)-/.exec(a.external_his_id as string)?.[1]))
      // El histórico da `procedimiento` (exacto) o `servicio` (la categoría:
      // ECOGRAFIAS, COLPOSCOPIAS). La categoría es más gruesa, pero para quien
      // atiende "COLPOSCOPIAS" es infinitamente mejor que "Sin especificar".
      servicio = (h?.procedimiento ?? '').trim() || (h?.servicio ?? '').trim()
      origen = h?.procedimiento ? 'historico_procedimiento' : servicio ? 'historico_servicio' : 'ninguno'
    }

    if (!servicio) { cuenta['sin_servicio_en_ningun_lado'] = (cuenta['sin_servicio_en_ningun_lado'] ?? 0) + 1; continue }

    const ent = parsearEntidadISalud(ed.aseguradora)?.entidad ?? null
    const m = matchearServicio(servicio, catalogo, ent, a.doctor_id as string)
    cuenta[`${origen}:${m.tipo}`] = (cuenta[`${origen}:${m.tipo}`] ?? 0) + 1

    const ctId = (m.tipo === 'inequivoco' || m.tipo === 'resuelto_por_medico' || m.tipo === 'resuelto_por_convenio')
      ? m.consultationTypeId : null
    if (m.tipo === 'ambiguo') ambiguas.push({ texto: servicio, motivo: m.motivo })

    escrituras.push({ id: a.id as string, servicio, ctId, origen })
  }

  console.log(`\n${APLICAR ? '⚠️  APLICANDO' : '🔍 DRY-RUN'} · ${TODAS ? 'TODAS' : 'solo futuras'} · ${citas?.length ?? 0} citas de iSalud`)
  console.log('─'.repeat(70))
  for (const [k, v] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log('─'.repeat(70))
  const conCt = escrituras.filter((e) => e.ctId).length
  console.log(`  ${escrituras.length} citas con SERVICIO visible`)
  console.log(`  ${conCt} de ellas además con consultation_type_id`)
  console.log(`  ${ambiguas.length} ambiguas → texto sí, consultation_type_id NO`)

  const porTexto: Record<string, number> = {}
  for (const a of ambiguas) porTexto[a.texto] = (porTexto[a.texto] ?? 0) + 1
  if (ambiguas.length) {
    console.log('\n  Ambiguas por texto:')
    for (const [t, n] of Object.entries(porTexto).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${t}`)
  }

  if (!APLICAR) { console.log('\nNada escrito. Con --aplicar se ejecuta.\n'); return }

  let ok = 0
  for (const e of escrituras) {
    const patch: Record<string, unknown> = { external_service_name: e.servicio }
    // NO se pisa un consultation_type_id que ya exista: puede haberlo puesto
    // una persona a mano, y el match automático no le gana a una decisión humana.
    if (e.ctId) {
      const { data: actual } = await sb.from('appointments').select('consultation_type_id').eq('id', e.id).single()
      if (!actual?.consultation_type_id) patch.consultation_type_id = e.ctId
    }
    const { error } = await sb.from('appointments').update(patch).eq('id', e.id).eq('clinic_id', ALGIA)
    if (!error) ok++
  }

  await sb.from('audit_log').insert({
    clinic_id: ALGIA,
    action: 'backfill_servicio_citas',
    actor_type: 'system',
    details: {
      citas_tocadas: ok,
      con_consultation_type_id: conCt,
      ambiguas: ambiguas.length,
      ambiguas_por_texto: porTexto,
      alcance: TODAS ? 'todas' : 'futuras',
    },
  })
  console.log(`\n✅ ${ok} citas actualizadas. Contador en audit_log (backfill_servicio_citas).\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
