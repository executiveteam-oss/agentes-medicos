/**
 * Enlaza citas de iSalud ya importadas con la ficha de su paciente.
 *
 * CORRIDA ÚNICA, no proceso recurrente: el enlace de las citas NUEVAS lo hace
 * el sync (sync-agent.ts). Este script alcanza a las que quedaron huérfanas
 * antes de ese arreglo.
 *
 * REGLA DURA — solo por DOCUMENTO exacto normalizado:
 *   · un documento → una ficha  → enlaza
 *   · un documento → dos fichas → NO enlaza (elegir sería adivinar quién es)
 *   · cita sin documento        → NO enlaza
 * Nunca por nombre, nunca fuzzy, nunca por teléfono. Enlazar mal es el
 * recordatorio de una paciente llegándole a otra.
 *
 * ⚠️ ENLAZAR ENCIENDE CAMINOS APAGADOS: una cita con patient_id entra al cron
 * de recordatorios y al de encuestas. Por eso el script REPORTA, antes de
 * escribir, cuántos mensajes podría disparar — y si son más de cero, se planta
 * salvo que se le pase --si-hay-mensajes.
 *
 * Dry-run por defecto. Para escribir: --aplicar
 * Correr: npx tsx scripts/backfill-enlazar-fichas.ts [--aplicar]
 */

import { readFileSync } from 'fs'
for (const l of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { decidirEnlace, indexarFichasPorDocumento } from '../src/lib/isalud/enlazar-ficha'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const APLICAR = process.argv.includes('--aplicar')
const IGNORAR_AVISO = process.argv.includes('--si-hay-mensajes')

async function main() {
  // 1. El padrón, indexado por documento.
  const filas: { id: string; document_number: string | null; proactive_contact_opt_in: boolean | null; name: string }[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data } = await sb.from('patients')
      .select('id, document_number, proactive_contact_opt_in, name')
      .eq('clinic_id', ALGIA).range(desde, desde + 999)
    if (!data || data.length === 0) break
    filas.push(...(data as typeof filas))
    if (data.length < 1000) break
  }
  const indice = indexarFichasPorDocumento(filas)
  const porId = new Map(filas.map((f) => [f.id, f]))

  // 2. Las citas huérfanas FUTURAS. Las pasadas no encienden nada y no las mira
  //    nadie: tocarlas es riesgo sin beneficio.
  const { data: citas } = await sb.from('appointments')
    .select('id, starts_at, external_data, reminder_24h_sent')
    .eq('clinic_id', ALGIA).eq('external_source', 'isalud')
    .is('patient_id', null).gte('starts_at', new Date().toISOString())
    .order('starts_at')

  const aEnlazar: { aptId: string; patientId: string; doc: string; starts: string }[] = []
  const razones: Record<string, number> = {}

  for (const c of citas ?? []) {
    const doc = ((c.external_data as Record<string, string>)?.identificacion ?? '')
    const d = decidirEnlace(doc, indice)
    if (d.enlazar) {
      aEnlazar.push({
        aptId: c.id as string, patientId: d.patientId,
        doc: doc.replace(/\D/g, ''), starts: c.starts_at as string,
      })
    } else {
      razones[d.razon] = (razones[d.razon] ?? 0) + 1
    }
  }

  // 3. ⚠️ ¿Qué se ENCIENDE? Los dos candados: opt-in y ventana del cron.
  const ahora = Date.now()
  const conOptIn = aEnlazar.filter((e) => porId.get(e.patientId)?.proactive_contact_opt_in === true)
  const enVentana24 = conOptIn.filter((e) => {
    const h = (new Date(e.starts).getTime() - ahora) / 3_600_000
    return h >= 23 && h <= 25
  })
  const enVentana72 = conOptIn.filter((e) => {
    const h = (new Date(e.starts).getTime() - ahora) / 3_600_000
    return h >= 71 && h <= 73
  })
  const mensajesPosibles = enVentana24.length + enVentana72.length

  console.log(`\n${APLICAR ? '⚠️  APLICANDO' : '🔍 DRY-RUN'} · ${citas?.length ?? 0} citas futuras SIN ficha`)
  console.log('─'.repeat(66))
  console.log(`  ✅ enlazables (1 documento → 1 ficha) : ${aEnlazar.length}`)
  for (const [r, n] of Object.entries(razones)) console.log(`  ⚪ ${r.padEnd(36)}: ${n}`)
  console.log('─'.repeat(66))
  console.log('  EFECTO SOBRE ENVÍOS PROACTIVOS:')
  console.log(`    con proactive_contact_opt_in = true : ${conOptIn.length}`)
  console.log(`    en ventana de recordatorio 24h      : ${enVentana24.length}`)
  console.log(`    en ventana de recordatorio 72h      : ${enVentana72.length}`)
  console.log(`    → mensajes que podrían salir        : ${mensajesPosibles}`)

  if (mensajesPosibles > 0 && !IGNORAR_AVISO) {
    console.log(`\n🔴 ${mensajesPosibles} mensajes de WhatsApp podrían salir a pacientes reales.`)
    console.log('   NO se escribe nada. Revisalo y, si es lo que querés, agregá --si-hay-mensajes.\n')
    return
  }

  if (!APLICAR) { console.log('\nNada escrito. Con --aplicar se ejecuta.\n'); return }

  let ok = 0
  for (const e of aEnlazar) {
    // Se re-verifica que siga huérfana: entre el dry-run y el apply pudo correr
    // el sync y enlazarla él.
    const { data: actual } = await sb.from('appointments')
      .select('patient_id').eq('id', e.aptId).single()
    if (actual?.patient_id) continue

    const { error } = await sb.from('appointments')
      .update({ patient_id: e.patientId }).eq('id', e.aptId).eq('clinic_id', ALGIA)
    if (error) continue
    ok++

    // Un audit por enlace, con el par completo: es lo que permite deshacerlo
    // uno por uno si alguno resultara mal.
    await sb.from('audit_log').insert({
      clinic_id: ALGIA,
      action: 'cita_enlazada_a_ficha',
      actor_type: 'system',
      target_type: 'appointment',
      target_id: e.aptId,
      details: {
        appointment_id: e.aptId,
        patient_id: e.patientId,
        documento: e.doc,
        paciente: porId.get(e.patientId)?.name ?? null,
        origen: 'backfill-enlazar-fichas',
      },
    })
  }

  console.log(`\n✅ ${ok} citas enlazadas. Cada una con su audit_log (cita_enlazada_a_ficha).\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
