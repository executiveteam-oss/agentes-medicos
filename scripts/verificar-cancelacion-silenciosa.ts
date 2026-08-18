/**
 * Verifica la cancelación SIN aviso contra datos reales.
 *
 * Crea una cita de PRUEBA (paciente de prueba, horario libre y lejano), la
 * cancela en silencio por el camino real, y comprueba contra la DB —no contra
 * el código— que no salió ningún mensaje.
 *
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/verificar-cancelacion-silenciosa.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { cancelAndNotifyPatient } from '@/lib/cancel-notify'
import { ESTADOS_TERMINALES } from '@/lib/isalud/sync-agent'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const PACIENTE_PRUEBA = 'ff302300-6e7c-4fda-892f-ca4cd6171264'   // Pepita Pérez
const JUAN_DIEGO = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const CT = 'cdb57967-5fc3-433e-b909-8dc6d20d382b'

let ok = 0, fail = 0
const check = (l: string, c: boolean, extra = '') => {
  if (c) { console.log(`  ✅ ${l}`); ok++ } else { console.log(`  ❌ ${l} ${extra}`); fail++ }
}

async function main() {
  // Horario lejano y en punto raro, para no chocar con el índice único
  const inicio = new Date(Date.now() + 60 * 24 * 3600_000)
  inicio.setUTCHours(22, 37, 0, 0)
  const fin = new Date(inicio.getTime() + 20 * 60_000)

  console.log('1) Creando cita de PRUEBA…')
  const { data: cita, error } = await supabaseAdmin.from('appointments').insert({
    clinic_id: ALGIA, doctor_id: JUAN_DIEGO, patient_id: PACIENTE_PRUEBA,
    starts_at: inicio.toISOString(), ends_at: fin.toISOString(),
    status: 'confirmed', source: 'dashboard', consultation_type_id: CT,
    reason: 'PRUEBA INTERNA — cancelación silenciosa',
  }).select('id, starts_at, status').single()
  if (error || !cita) { console.error('No se pudo crear:', error?.message); process.exit(1) }
  console.log(`   cita ${cita.id} · ${cita.starts_at} · ${cita.status}`)

  // Línea de base ANTES de cancelar
  const { count: msgsAntes } = await supabaseAdmin
    .from('whatsapp_message_status').select('*', { count: 'exact', head: true })
  const { count: auditAntes } = await supabaseAdmin
    .from('audit_log').select('*', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  const t0 = new Date().toISOString()
  console.log(`   baseline → whatsapp_message_status: ${msgsAntes} filas`)

  console.log('\n2) Cancelando SIN avisar (camino real)…')
  const r = await cancelAndNotifyPatient(cita.id, ALGIA, 'PRUEBA: cita duplicada creada por error', null,
    { notificar: false, actorId: null })
  console.log(`   resultado: ${JSON.stringify(r)}`)
  check('la función reporta ok', r.ok === true)
  check('whatsappSent = false', r.whatsappSent === false)

  console.log('\n3) Estado en la base:')
  const { data: post } = await supabaseAdmin
    .from('appointments').select('status, cancelled_at, cancellation_reason, patient_cancellation_reason')
    .eq('id', cita.id).single()
  check("status = 'cancelled'", post?.status === 'cancelled', `es ${post?.status}`)
  check('cancelled_at seteado', !!post?.cancelled_at)
  check('motivo interno guardado', !!post?.cancellation_reason, JSON.stringify(post?.cancellation_reason))
  check('sin motivo para la paciente', post?.patient_cancellation_reason === null)

  console.log('\n4) ¿Salió algún mensaje? (contra whatsapp_message_status, no contra el código)')
  await new Promise((r) => setTimeout(r, 6000))   // margen para el webhook de Meta
  const { count: msgsDespues } = await supabaseAdmin
    .from('whatsapp_message_status').select('*', { count: 'exact', head: true })
  const { data: nuevos } = await supabaseAdmin
    .from('whatsapp_message_status').select('recipient_tail, status, updated_at')
    .gte('updated_at', t0)
  check(`whatsapp_message_status sin filas nuevas (${msgsAntes} → ${msgsDespues})`, msgsAntes === msgsDespues)
  check('ningún status posterior al corte', (nuevos ?? []).length === 0, JSON.stringify(nuevos))

  const { data: pend } = await supabaseAdmin
    .from('pending_contacts').select('id').eq('appointment_id', cita.id)
  check('no se creó pending_contact', (pend ?? []).length === 0)

  console.log('\n5) audit_log:')
  const { data: aud } = await supabaseAdmin
    .from('audit_log').select('action, actor_type, details, created_at')
    .eq('target_id', cita.id).order('created_at')
  for (const a of aud ?? []) console.log(`   ${a.action} · actor=${a.actor_type} · ${JSON.stringify(a.details)}`)
  const silenciosa = (aud ?? []).find((a) => a.action === 'appointment_cancelled_silently')
  check("acción 'appointment_cancelled_silently'", !!silenciosa)
  check('la acción con aviso NO se registró', !(aud ?? []).some((a) => a.action === 'appointment_cancelled_with_notification'))
  check('el motivo quedó en el audit', !!(silenciosa?.details as { internalReason?: string })?.internalReason)
  check('queda marcada como no notificada', (silenciosa?.details as { notificada?: boolean })?.notificada === false)
  console.log(`   (audit de la clínica: ${auditAntes} → +${(aud ?? []).length} de esta cita)`)

  console.log('\n6) Guard del sync (estados terminales):')
  check("'cancelled' está en ESTADOS_TERMINALES", ESTADOS_TERMINALES.has('cancelled'))
  console.log(`   ESTADOS_TERMINALES = ${JSON.stringify([...ESTADOS_TERMINALES])}`)
  console.log('   → el guard mira el status, no cómo se llegó a él: cubre las dos cancelaciones igual.')

  console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
  console.log(`\nLa cita de prueba ${cita.id} queda CANCELADA en la base (no se borra: sirve de rastro).`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
