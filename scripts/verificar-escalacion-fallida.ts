/**
 * ¿La escalación falla RUIDOSA o silenciosa?
 *
 * 1. Escalación NORMAL end-to-end contra producción: tiene que seguir andando.
 * 2. Escalación con el UPDATE FORZADO A FALLAR: tiene que reintentar, dejar
 *    audit_log 'escalation_failed' y devolver ok:false para que la paciente
 *    reciba la verdad en vez de "ya te pasé con una persona".
 *
 * El fallo se simula apuntando a un conversation_id que NO existe: el UPDATE de
 * Supabase con .eq() sobre una fila inexistente no da error, así que se usa un
 * clinic_id inválido para que el filtro de FK/RLS lo rechace de verdad.
 *
 * Usa una conversación de PRUEBA que crea y borra. No toca a ninguna paciente.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-escalacion-fallida.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p: string): void {
  if (!existsSync(p)) return
  for (const l of readFileSync(p,'utf-8').split('\n')) {
    const t=l.trim(); if(!t||t.startsWith('#'))continue
    const e=t.indexOf('='); if(e<0)continue
    const k=t.slice(0,e).trim(); let v=t.slice(e+1).trim()
    if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1)
    if(!process.env[k])process.env[k]=v
  }
}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const CLINIC_INEXISTENTE = '00000000-0000-0000-0000-000000000000'

let fallos = 0
function chequear(n: string, ok: boolean, d = ''): void {
  console.log(`  ${ok ? '✅' : '🔴'} ${n}${d ? `  ${d}` : ''}`); if (!ok) fallos++
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { escalarConversacion, mensajeEscalacionFallida } = await import('../src/lib/conversations/escalar')
  const { ESCALATION_REASONS } = await import('../src/lib/conversations/escalation-reasons')

  const { data: clinic } = await supa.from('clinics').select('phone').eq('id', ALGIA).single()

  // Conversación de prueba, sin paciente.
  const { data: conv, error: eConv } = await supa.from('conversations')
    .insert({ clinic_id: ALGIA, whatsapp_phone: '+570000000001', status: 'active' })
    .select('id, context, status').single()
  if (eConv) throw new Error(`No se pudo crear la conversación de prueba: ${eConv.message}`)
  console.log(`\nConversación de prueba: ${conv!.id.slice(0,8)}\n`)

  const auditAntes = await supa.from('audit_log').select('id', { count: 'exact', head: true })
    .eq('clinic_id', ALGIA).eq('action', 'escalation_failed')

  try {
    // ── 1. ESCALACIÓN NORMAL ──────────────────────────────────────────
    console.log('1. ESCALACIÓN NORMAL')
    let notificada = false
    const ok = await escalarConversacion({
      conversationId: conv!.id, clinicId: ALGIA,
      motivo: ESCALATION_REASONS.HUMAN_REQUEST, contextPrevio: conv!.context as Record<string, unknown>,
      notificar: async () => { notificada = true },
    })
    chequear('devuelve ok:true', ok.ok === true)
    chequear('corrió la notificación', notificada)
    const { data: tras } = await supa.from('conversations').select('status, escalated_at, context').eq('id', conv!.id).single()
    chequear('la conversación quedó escalada', tras!.status === 'escalated', `status=${tras!.status}`)
    chequear('tiene escalated_at', !!tras!.escalated_at)
    chequear('guardó el motivo', (tras!.context as Record<string,string>)?.escalation_reason === ESCALATION_REASONS.HUMAN_REQUEST)

    // ── 2. NOTIFICACIÓN QUE REVIENTA ──────────────────────────────────
    console.log('\n2. LA NOTIFICACIÓN LANZA (la escalación SÍ entró)')
    const okNotif = await escalarConversacion({
      conversationId: conv!.id, clinicId: ALGIA,
      motivo: ESCALATION_REASONS.HUMAN_REQUEST, contextPrevio: conv!.context as Record<string, unknown>,
      notificar: async () => { throw new Error('alerta caída — simulado') },
    })
    chequear('sigue devolviendo ok:true (la escalación existe)', okNotif.ok === true)

    // ── 3. EL UPDATE FALLA ────────────────────────────────────────────
    console.log('\n3. EL UPDATE FALLA (clinic_id que no existe)')
    const okFail = await escalarConversacion({
      conversationId: conv!.id, clinicId: CLINIC_INEXISTENTE,
      motivo: ESCALATION_REASONS.HUMAN_REQUEST, contextPrevio: null,
      notificar: async () => { chequear('NO debería notificar', false) },
    })
    chequear('devuelve ok:false', okFail.ok === false, okFail.error ?? '')

    // ── 4. LO QUE LEE LA PACIENTE ─────────────────────────────────────
    console.log('\n4. LO QUE LEE LA PACIENTE')
    const texto = mensajeEscalacionFallida(clinic?.phone as string)
    console.log(`     "${texto}"`)
    chequear('NO promete una persona', !/persona del equipo|te contacte|ya avisé/i.test(texto))
    chequear('incluye el teléfono de la clínica', texto.includes((clinic?.phone as string) ?? '@@'))
    chequear('está en tuteo', /escríbeme|puedes/i.test(texto) && !/escribime|podés/i.test(texto))
  } finally {
    await supa.from('conversations').delete().eq('id', conv!.id).eq('clinic_id', ALGIA)
    console.log('\n5. LIMPIEZA')
    const q = await supa.from('conversations').select('id').eq('id', conv!.id)
    chequear('la conversación de prueba ya no existe', (q.data ?? []).length === 0)
  }

  const auditDespues = await supa.from('audit_log').select('id', { count: 'exact', head: true })
    .eq('clinic_id', ALGIA).eq('action', 'escalation_failed')
  console.log(`\n   audit_log 'escalation_failed': ${auditAntes.count} → ${auditDespues.count}`)
  chequear('quedó registrado el fallo de la NOTIFICACIÓN', (auditDespues.count ?? 0) > (auditAntes.count ?? 0))

  console.log(fallos === 0 ? '\n══ VERIFICADO ══\n' : `\n══ 🔴 ${fallos} fallo(s) ══\n`)
  process.exit(fallos === 0 ? 0 : 1)
}
main().catch((e) => { console.error('\n🔴', e.message); process.exit(1) })
