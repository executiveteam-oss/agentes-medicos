// scripts/smoke-escalation-notif.ts
// Smoke DB contra Algia. Crea una conversación escalada de prueba,
// dispara la notif dos veces (verifica idempotencia), luego resuelve.
// NO deja basura: borra la conversación de prueba al final.
//
// Run: TZ=America/Bogota npx tsx scripts/smoke-escalation-notif.ts
import { existsSync, readFileSync } from 'fs'
function loadEnv(p: string) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv('.env.production.local'); loadEnv('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main() {
  // Import dinámico DESPUÉS de loadEnv: supabaseAdmin captura la URL/keys al
  // evaluar su módulo. Con import estático, el hoisting lo evaluaría ANTES de
  // loadEnv y tomaría el placeholder. Va dentro de main() (no top-level)
  // porque el proyecto transpila a CJS y no soporta top-level await.
  const { supabaseAdmin } = await import('../src/lib/supabase/admin')
  const { notifyStaffOfEscalation, resolveEscalationNotifications } = await import('../src/lib/notifications/escalation-notify')

  // 1. Crear una conversación de prueba escalada
  const { data: conv, error: convErr } = await supabaseAdmin
    .from('conversations')
    .insert({ clinic_id: ALGIA, whatsapp_phone: '+570000000000', status: 'escalated', escalated_at: new Date().toISOString() })
    .select('id').single()
  if (convErr || !conv) { console.error('No pude crear conversación de prueba', convErr); process.exit(1) }
  const convId = (conv as { id: string }).id
  console.log('Conversación de prueba:', convId)

  // 2. Disparar la notif dos veces → idempotencia
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'prueba de escalación' })
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'segundo mensaje' })

  const { data: afterInsert } = await supabaseAdmin
    .from('staff_notifications').select('recipient_user_id, read_at')
    .eq('conversation_id', convId).eq('type', 'conversation_escalated')
  const staffCount = afterInsert?.length ?? 0
  const distinctUsers = new Set((afterInsert ?? []).map((r) => (r as { recipient_user_id: string }).recipient_user_id)).size
  console.log(`Filas tras 2 disparos: ${staffCount} (usuarios distintos: ${distinctUsers})`)
  console.log(staffCount === distinctUsers ? '✅ idempotente: 1 fila por usuario, no duplica' : '❌ duplicó filas')

  // 3. Resolver → todas read_at
  await resolveEscalationNotifications(convId)
  const { data: afterResolve } = await supabaseAdmin
    .from('staff_notifications').select('read_at')
    .eq('conversation_id', convId).eq('type', 'conversation_escalated')
  const allRead = (afterResolve ?? []).every((r) => (r as { read_at: string | null }).read_at !== null)
  console.log(allRead ? '✅ resolución: todas las filas quedaron read_at' : '❌ quedaron filas sin resolver')

  // 4. Re-disparar tras resolver → re-crea (5º camino)
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'repregunta' })
  const { data: afterReraise } = await supabaseAdmin
    .from('staff_notifications').select('id').eq('conversation_id', convId)
    .eq('type', 'conversation_escalated').is('read_at', null)
  console.log((afterReraise?.length ?? 0) > 0 ? '✅ re-alerta tras resolver: hay alerta viva de nuevo' : '❌ no re-alertó')

  // 5. Limpieza: borrar la conversación de prueba (CASCADE borra sus notifs)
  await supabaseAdmin.from('staff_notifications').delete().eq('conversation_id', convId)
  await supabaseAdmin.from('conversations').delete().eq('id', convId)
  console.log('🧹 conversación y notifs de prueba borradas')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
