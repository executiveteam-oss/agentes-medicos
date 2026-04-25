#!/usr/bin/env node

// ============================================================
// SEED DEMO RICO — citas 2 semanas + conversaciones + no-shows
// 100% ADITIVO. ON CONFLICT DO NOTHING.
// ============================================================

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')
const crypto = require('crypto')

const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i)] = t.slice(i + 1)
}

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const C = 'a1b2c3d4-0000-0000-0000-000000000001'
const ANA = 'b1b2c3d4-0000-0000-0000-000000000001'
const CARLOS = 'b1b2c3d4-0000-0000-0000-000000000002'
const VALE = 'b1b2c3d4-0000-0000-0000-000000000003'
const DOCS = [ANA, CARLOS, VALE]

function pid(n) { return `c0000001-0000-0000-0000-${String(n).padStart(12, '0')}` }
const PATIENTS = Array.from({ length: 15 }, (_, i) => pid(i + 1))
const PAYMENT_TYPES = ['Particular', 'Sura', 'Coomeva', 'Nueva EPS', 'Famisanar']

// COT date helper (hour in Colombia time)
function cotISO(year, month, day, hour, minute = 0) {
  // COT = UTC-5
  const d = new Date(Date.UTC(year, month - 1, day, hour + 5, minute, 0))
  return d.toISOString()
}

async function main() {
  console.log('=== SEED DEMO RICO ===\n')

  // ======================================================
  // PARTE 1: CITAS — semanas 13-19 y 20-26 abril 2026
  // ======================================================
  console.log('1/3 Citas...')

  const appts = []

  // Slots por doctor (Colombia time)
  // Ana: 8:30-11:45 y 13:15-16:15 (L-V)
  // Carlos: 7:00-13:00 (L,Ma,J,V,S)
  // Valentina: 9:00-18:00 (L-V)
  const anaSlots = [
    [8,30],[9,0],[9,30],[10,0],[10,30],[11,0],
    [13,15],[13,45],[14,15],[14,45],[15,15],[15,45]
  ]
  const carlosSlots = [
    [7,0],[7,40],[8,20],[9,0],[9,40],[10,20],[11,0],[11,40],[12,20]
  ]
  const valeSlots = [
    [9,0],[9,30],[10,0],[10,30],[11,0],[11,30],
    [14,0],[14,30],[15,0],[15,30],[16,0],[16,30]
  ]

  let patIdx = 0
  function nextPat() { const p = PATIENTS[patIdx % PATIENTS.length]; patIdx++; return p }
  function randPay() { return PAYMENT_TYPES[Math.floor(Math.random() * PAYMENT_TYPES.length)] }
  function randPrice() { return [80000, 90000, 120000][Math.floor(Math.random() * 3)] }

  // Generate for April 13 (Sun) through April 26 (Sat)
  for (let day = 13; day <= 26; day++) {
    const dow = new Date(2026, 3, day).getDay() // 0=Sun
    if (dow === 0) continue // domingo cerrado

    // Ana: L-V (dow 1-5)
    if (dow >= 1 && dow <= 5) {
      const slots = anaSlots.slice(0, 4 + Math.floor(Math.random() * 4)) // 4-8 por día
      for (const [h, m] of slots) {
        const starts = cotISO(2026, 4, day, h, m)
        const ends = cotISO(2026, 4, day, h, m + 30)
        const isPast = new Date(starts) < new Date()
        appts.push({
          clinic_id: C, doctor_id: ANA, patient_id: nextPat(),
          starts_at: starts, ends_at: ends,
          status: isPast ? (Math.random() < 0.12 ? 'no_show' : 'completed') : 'confirmed',
          source: Math.random() < 0.7 ? 'whatsapp_agent' : 'dashboard',
          payment_type: randPay(), clinic_value: randPrice(), invoice_status: isPast ? 'pagada' : 'pendiente',
        })
      }
    }

    // Carlos: L,Ma,J,V (dow 1,2,4,5) + S (dow 6)
    if ([1,2,4,5,6].includes(dow)) {
      const maxSlots = dow === 6 ? 4 : 3 + Math.floor(Math.random() * 3)
      const slots = carlosSlots.slice(0, maxSlots)
      for (const [h, m] of slots) {
        const starts = cotISO(2026, 4, day, h, m)
        const ends = cotISO(2026, 4, day, h, m + 40)
        const isPast = new Date(starts) < new Date()
        appts.push({
          clinic_id: C, doctor_id: CARLOS, patient_id: nextPat(),
          starts_at: starts, ends_at: ends,
          status: isPast ? (Math.random() < 0.1 ? 'no_show' : 'completed') : 'confirmed',
          source: Math.random() < 0.6 ? 'whatsapp_agent' : 'dashboard',
          payment_type: randPay(), clinic_value: 120000, invoice_status: isPast ? 'pagada' : 'pendiente',
        })
      }
    }

    // Valentina: L-V (dow 1-5)
    if (dow >= 1 && dow <= 5) {
      const slots = valeSlots.slice(0, 3 + Math.floor(Math.random() * 3))
      for (const [h, m] of slots) {
        const starts = cotISO(2026, 4, day, h, m)
        const ends = cotISO(2026, 4, day, h, m + 30)
        const isPast = new Date(starts) < new Date()
        appts.push({
          clinic_id: C, doctor_id: VALE, patient_id: nextPat(),
          starts_at: starts, ends_at: ends,
          status: isPast ? (Math.random() < 0.1 ? 'no_show' : 'completed') : 'confirmed',
          source: Math.random() < 0.65 ? 'whatsapp_agent' : 'dashboard',
          payment_type: randPay(), clinic_value: 90000, invoice_status: isPast ? 'pagada' : 'pendiente',
        })
      }
    }
  }

  // Extra no-shows en las últimas 4 semanas (para que el panel muestre datos)
  for (let daysAgo = 5; daysAgo <= 28; daysAgo += 3) {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    if (d.getDay() === 0) continue
    const day = d.getDate()
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    appts.push({
      clinic_id: C, doctor_id: DOCS[daysAgo % 3], patient_id: nextPat(),
      starts_at: cotISO(year, month, day, 10, 0),
      ends_at: cotISO(year, month, day, 10, 30),
      status: 'no_show', source: 'whatsapp_agent',
      payment_type: 'Particular', clinic_value: 80000, invoice_status: 'pendiente',
    })
  }

  console.log(`  Generadas ${appts.length} citas. Insertando...`)
  const { error: aErr } = await supa.from('appointments').insert(appts)
  if (aErr) console.error('  ✗ appointments:', aErr.message)
  else console.log(`  ✓ ${appts.length} citas insertadas`)

  // ======================================================
  // PARTE 2: CONVERSACIONES
  // ======================================================
  console.log('\n2/3 Conversaciones...')

  const now = new Date()
  function hoursAgo(h) { return new Date(now.getTime() - h * 3600000).toISOString() }
  function minsAgo(m) { return new Date(now.getTime() - m * 60000).toISOString() }

  const convos = [
    // 1. Agendamiento exitoso
    {
      id: 'c0c0c0c0-0001-0000-0000-000000000001',
      patient_id: pid(1), whatsapp_phone: '+573151111111', status: 'resolved',
      last_message_at: hoursAgo(2),
      msgs: [
        { role: 'patient', content: 'Hola, quisiera agendar una cita con ginecología', at: hoursAgo(3) },
        { role: 'agent', content: 'Hola Laura 👋 Soy Sofía, asistente del Consultorio Médico Demo. Con gusto te ayudo a agendar con el Dr. Carlos Mejía (Ginecología). ¿Para qué fecha te gustaría?', at: hoursAgo(2.9) },
        { role: 'patient', content: 'Para el viernes de esta semana, en la mañana si es posible', at: hoursAgo(2.8) },
        { role: 'agent', content: 'Tengo disponibilidad el viernes:\n\n🕐 7:00 AM\n🕐 7:40 AM\n🕐 8:20 AM\n🕐 9:00 AM\n\n¿Cuál prefieres?', at: hoursAgo(2.7) },
        { role: 'patient', content: '9 de la mañana', at: hoursAgo(2.6) },
        { role: 'agent', content: '¡Perfecto! Para completar tu cita necesito tu nombre completo y número de cédula (sin puntos).', at: hoursAgo(2.5) },
        { role: 'patient', content: 'Laura Gómez Restrepo, CC 1090123456', at: hoursAgo(2.4) },
        { role: 'agent', content: '✅ Cita agendada:\n📅 Viernes 18 de abril\n🕐 9:00 AM\n👨‍⚕️ Dr. Carlos Mejía — Ginecología\n📍 Calle 19 # 6-48, Centro, Pereira\n\nSi necesitas cambiar algo, escríbeme. ¡Que tengas buen día!', at: hoursAgo(2.3) },
        { role: 'patient', content: 'Muchas gracias! 😊', at: hoursAgo(2) },
      ]
    },
    // 2. Agendamiento con consulta de precio
    {
      id: 'c0c0c0c0-0002-0000-0000-000000000001',
      patient_id: pid(3), whatsapp_phone: '+573153333333', status: 'resolved',
      last_message_at: hoursAgo(5),
      msgs: [
        { role: 'patient', content: 'Buenos días, cuánto cuesta la consulta de pediatría?', at: hoursAgo(6) },
        { role: 'agent', content: 'Hola María Isabela 👋 La consulta pediátrica con la Dra. Valentina Torres tiene un valor de $90.000 COP y dura 30 minutos. ¿Te gustaría agendar una cita?', at: hoursAgo(5.9) },
        { role: 'patient', content: 'Sí por favor, para el lunes', at: hoursAgo(5.8) },
        { role: 'agent', content: 'El lunes tengo estos horarios:\n\n🕐 9:00 AM\n🕐 9:30 AM\n🕐 10:00 AM\n🕐 2:00 PM\n🕐 2:30 PM\n\n¿Cuál te sirve?', at: hoursAgo(5.7) },
        { role: 'patient', content: '2 de la tarde', at: hoursAgo(5.5) },
        { role: 'agent', content: '✅ Cita agendada:\n📅 Lunes 21 de abril\n🕐 2:00 PM\n👩‍⚕️ Dra. Valentina Torres — Pediatría\n📍 Calle 19 # 6-48, Centro, Pereira\n💰 $90.000 COP\n\n¡Te esperamos!', at: hoursAgo(5.4) },
        { role: 'patient', content: 'Gracias Sofía', at: hoursAgo(5) },
      ]
    },
    // 3. Pregunta de EPS
    {
      id: 'c0c0c0c0-0003-0000-0000-000000000001',
      patient_id: pid(5), whatsapp_phone: '+573155555555', status: 'resolved',
      last_message_at: hoursAgo(8),
      msgs: [
        { role: 'patient', content: 'Buenas, atienden con Sura?', at: hoursAgo(9) },
        { role: 'agent', content: 'Hola Sofía 👋 Sí, atendemos pacientes de Sura. También atendemos Coomeva, Nueva EPS, Famisanar y Particular.\n\n¿Te gustaría agendar una cita?', at: hoursAgo(8.9) },
        { role: 'patient', content: 'Ah perfecto, y dónde queda el consultorio?', at: hoursAgo(8.7) },
        { role: 'agent', content: '📍 Estamos en Calle 19 # 6-48, Centro, Pereira.\n\nNuestro horario:\n  Lunes a Viernes: 7:00 AM - 5:00 PM\n  Sábado: 8:00 AM - 12:00 PM\n\n¿Necesitas algo más?', at: hoursAgo(8.6) },
        { role: 'patient', content: 'No, eso era todo. Gracias!', at: hoursAgo(8) },
      ]
    },
    // 4. Escalamiento - urgencia
    {
      id: 'c0c0c0c0-0004-0000-0000-000000000001',
      patient_id: pid(8), whatsapp_phone: '+573158888888', status: 'escalated',
      escalated_at: hoursAgo(1),
      last_message_at: hoursAgo(1),
      msgs: [
        { role: 'patient', content: 'Necesito una cita urgente, tengo un dolor muy fuerte', at: hoursAgo(1.5) },
        { role: 'agent', content: 'Hola Miguel Ángel. Entiendo que tienes un dolor fuerte. ¿Puedes describir dónde es el dolor y hace cuánto lo tienes?', at: hoursAgo(1.4) },
        { role: 'patient', content: 'Es un dolor abdominal muy intenso, desde anoche no puedo dormir', at: hoursAgo(1.3) },
        { role: 'agent', content: '⚠️ Por tu seguridad, si el dolor es muy intenso o tienes fiebre, te recomiendo ir a urgencias (llama al 123).\n\nSi prefieres atención con nosotros, voy a comunicarte con nuestro equipo para que te atiendan lo antes posible.', at: hoursAgo(1.2) },
        { role: 'patient', content: 'Si, por favor comuníqueme con alguien', at: hoursAgo(1) },
        { role: 'agent', content: 'Listo Miguel Ángel. Tu caso ha sido escalado a nuestro equipo. Te contactaremos por este mismo chat lo antes posible. 🙏', at: hoursAgo(1) },
      ]
    },
    // 5. Cancelación y reagendamiento
    {
      id: 'c0c0c0c0-0005-0000-0000-000000000001',
      patient_id: pid(9), whatsapp_phone: '+573159999999', status: 'resolved',
      last_message_at: hoursAgo(12),
      msgs: [
        { role: 'patient', content: 'Hola, necesito cancelar mi cita de mañana', at: hoursAgo(13) },
        { role: 'agent', content: 'Hola Natalia 👋 Claro, puedo ayudarte. Veo que tienes una cita mañana. ¿Deseas cancelarla o prefieres reagendarla para otra fecha?', at: hoursAgo(12.9) },
        { role: 'patient', content: 'Reagendar mejor, para la próxima semana', at: hoursAgo(12.7) },
        { role: 'agent', content: 'La próxima semana tengo disponibilidad:\n\n📅 Lunes 21: 9:00 AM, 10:30 AM\n📅 Martes 22: 8:30 AM, 2:00 PM\n📅 Miércoles 23: 9:00 AM\n\n¿Cuál te funciona?', at: hoursAgo(12.5) },
        { role: 'patient', content: 'El martes a las 2', at: hoursAgo(12.3) },
        { role: 'agent', content: '✅ Listo! Tu cita fue reagendada:\n📅 Martes 22 de abril\n🕐 2:00 PM\n👩‍⚕️ Dra. Ana María Ríos\n\nCancelé la cita de mañana. ¡Nos vemos el martes!', at: hoursAgo(12) },
      ]
    },
    // 6. Recordatorio confirmado
    {
      id: 'c0c0c0c0-0006-0000-0000-000000000001',
      patient_id: pid(12), whatsapp_phone: '+573162222222', status: 'active',
      last_message_at: hoursAgo(4),
      msgs: [
        { role: 'agent', content: 'Hola Valentina, te recordamos tu cita mañana viernes 18 de abril a las 10:00 AM con la Dra. Ana María Ríos.\n\n📍 Calle 19 # 6-48, Centro, Pereira\n\n¿Confirmas? ✅ Sí | ❌ No puedo | 📅 Reagendar', at: hoursAgo(5) },
        { role: 'patient', content: 'Sí, confirmo', at: hoursAgo(4) },
        { role: 'agent', content: '¡Perfecto! Quedas confirmada para mañana a las 10:00 AM. ¡Te esperamos! 😊', at: hoursAgo(3.9) },
      ]
    },
    // 7. Paciente nuevo pregunta servicios
    {
      id: 'c0c0c0c0-0007-0000-0000-000000000001',
      patient_id: pid(14), whatsapp_phone: '+573164444444', status: 'active',
      last_message_at: hoursAgo(0.5),
      msgs: [
        { role: 'patient', content: 'Hola, qué servicios ofrecen?', at: hoursAgo(1) },
        { role: 'agent', content: 'Hola Isabella 👋 Soy Sofía, asistente virtual del Consultorio Médico Demo. Contamos con:\n\n👩‍⚕️ Dra. Ana María Ríos — Medicina General\n  • Consulta General (30 min — $80.000)\n  • Control de Hipertensión (20 min — $60.000)\n\n👨‍⚕️ Dr. Carlos Mejía — Ginecología\n  • Consulta Ginecológica (40 min — $120.000)\n  • Control Prenatal (30 min — $100.000)\n\n👩‍⚕️ Dra. Valentina Torres — Pediatría\n  • Consulta Pediátrica (30 min — $90.000)\n  • Vacunación (15 min — gratis)\n\n¿Te gustaría agendar con alguno?', at: hoursAgo(0.9) },
        { role: 'patient', content: 'Con la pediatra, mi hija tiene 3 años', at: hoursAgo(0.5) },
      ]
    },
    // 8. Post-consulta NPS
    {
      id: 'c0c0c0c0-0008-0000-0000-000000000001',
      patient_id: pid(4), whatsapp_phone: '+573154444444', status: 'resolved',
      last_message_at: hoursAgo(20),
      msgs: [
        { role: 'agent', content: 'Hola Jorge 👋\n\nEsperamos que tu consulta con la Dra. Ana María Ríos haya ido muy bien.\n\n¿Cómo te has sentido desde entonces?\n\nDel 1 al 10, ¿cómo calificarías tu experiencia con nosotros? (responde solo con el número)', at: hoursAgo(22) },
        { role: 'patient', content: '9', at: hoursAgo(21) },
        { role: 'agent', content: '¡Genial! Nos alegra mucho que hayas tenido una buena experiencia. Tu opinión nos ayuda a mejorar. ¡Gracias Jorge! 🙏', at: hoursAgo(20.9) },
        { role: 'patient', content: 'Excelente atención de verdad, muchas gracias', at: hoursAgo(20) },
      ]
    },
  ]

  for (const c of convos) {
    const { error: cErr } = await supa.from('conversations').insert({
      id: c.id,
      clinic_id: C,
      patient_id: c.patient_id,
      whatsapp_phone: c.whatsapp_phone,
      status: c.status,
      last_message_at: c.last_message_at,
      escalated_at: c.escalated_at ?? null,
      created_at: c.msgs[0].at,
    })
    if (cErr && !cErr.message.includes('duplicate')) {
      console.error(`  ✗ conv ${c.id}: ${cErr.message}`)
      continue
    }

    const msgs = c.msgs.map((m, i) => ({
      conversation_id: c.id,
      role: m.role,
      content: m.content,
      message_type: 'text',
      created_at: m.at,
    }))
    const { error: mErr } = await supa.from('messages').insert(msgs)
    if (mErr) console.error(`  ✗ msgs for ${c.id}: ${mErr.message}`)
  }
  console.log(`  ✓ ${convos.length} conversaciones + ${convos.reduce((s, c) => s + c.msgs.length, 0)} mensajes`)

  // ======================================================
  // PARTE 3: VERIFICACIÓN
  // ======================================================
  console.log('\n3/3 Verificación...')

  const [aFinal, cFinal] = await Promise.all([
    supa.from('appointments').select('status', { count: 'exact' }).eq('clinic_id', C),
    supa.from('conversations').select('status', { count: 'exact' }).eq('clinic_id', C),
  ])

  const convIds = (await supa.from('conversations').select('id').eq('clinic_id', C)).data?.map(r => r.id) ?? []
  const mFinal = convIds.length > 0
    ? await supa.from('messages').select('id', { count: 'exact', head: true }).in('conversation_id', convIds)
    : { count: 0 }

  console.log(`\n=== DESPUÉS ===`)
  console.log(`  appointments: ${aFinal.count}`)
  console.log(`  conversations: ${cFinal.count}`)
  console.log(`  messages: ${mFinal.count}`)

  // Status breakdown
  const statusCounts = {}
  for (const a of aFinal.data ?? []) {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1
  }
  console.log(`  appointment status: ${JSON.stringify(statusCounts)}`)

  // No-show stats (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000).toISOString()
  const { data: recent } = await supa.from('appointments').select('status')
    .eq('clinic_id', C).gte('starts_at', thirtyDaysAgo)
    .in('status', ['completed', 'no_show'])
  const completed30 = recent?.filter(a => a.status === 'completed').length ?? 0
  const noshow30 = recent?.filter(a => a.status === 'no_show').length ?? 0
  const total30 = completed30 + noshow30
  const rate = total30 > 0 ? Math.round((noshow30 / total30) * 100) : 0
  console.log(`\n  No-show últimos 30 días:`)
  console.log(`    total completadas+no_show: ${total30}`)
  console.log(`    no-shows: ${noshow30}`)
  console.log(`    tasa: ${rate}%`)
  console.log(`    costo estimado: $${(noshow30 * 80000).toLocaleString('es-CO')} COP`)

  console.log('\n✅ DONE')
}

main().catch(e => { console.error(e); process.exit(1) })
