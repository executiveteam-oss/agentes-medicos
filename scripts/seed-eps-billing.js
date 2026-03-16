#!/usr/bin/env node

// ============================================================
// Seed: 8 citas EPS con escenarios de facturación realistas
// Clínica de jlondonoechavarria@gmail.com
//
// Uso: node scripts/seed-eps-billing.js
// ============================================================

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')
const crypto = require('crypto')

// --- Cargar .env.local ---
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const uuid = () => crypto.randomUUID()

/** Fecha UTC desde COT. daysOffset desde hoy, hour en hora colombiana */
function cotDate(daysOffset, hour, minute = 0) {
  const now = new Date()
  const cot = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const base = new Date(cot.getFullYear(), cot.getMonth(), cot.getDate())
  base.setDate(base.getDate() + daysOffset)
  base.setHours(hour, minute, 0, 0)
  return new Date(base.getTime() + 5 * 60 * 60 * 1000).toISOString()
}

/** Fecha YYYY-MM-DD offset desde hoy */
function dateOnly(daysOffset) {
  const now = new Date()
  const cot = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  cot.setDate(cot.getDate() + daysOffset)
  return cot.toISOString().slice(0, 10)
}

function authCode() {
  return 'AUTH-' + String(Math.floor(10000000 + Math.random() * 90000000))
}

function formatCOP(n) {
  return '$' + n.toLocaleString('es-CO') + ' COP'
}

async function main() {
  console.log('Buscando clínica para jlondonoechavarria@gmail.com...\n')

  // Buscar usuario → clínica
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const authUser = users.find((u) => u.email === 'jlondonoechavarria@gmail.com')
  if (!authUser) { console.error('Usuario no encontrado'); process.exit(1) }

  const { data: clinicUser } = await supabase
    .from('clinic_users')
    .select('clinic_id')
    .eq('auth_user_id', authUser.id)
    .single()
  const clinicId = clinicUser.clinic_id
  console.log(`  Clinic ID: ${clinicId}`)

  // Buscar doctor
  const { data: doctors } = await supabase
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .limit(1)
  const doctorId = doctors[0].id
  console.log(`  Doctor: ${doctors[0].name}`)

  // Buscar pacientes con EPS
  const { data: patients } = await supabase
    .from('patients')
    .select('id, name, eps')
    .eq('clinic_id', clinicId)
    .neq('eps', 'Particular')
    .limit(8)

  if (!patients || patients.length < 4) {
    console.error('Se necesitan al menos 4 pacientes con EPS')
    process.exit(1)
  }
  console.log(`  Pacientes EPS: ${patients.length}\n`)

  // ============================================================
  // 8 CITAS EPS con diferentes escenarios de facturación
  // ============================================================

  const epsAppointments = [
    // --- 1. PAGADA — Sura, pagó a los 35 días ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[0].id,
      starts_at: cotDate(-50, 9, 0),
      ends_at: cotDate(-50, 9, 30),
      status: 'completed',
      reason: 'Consulta general',
      source: 'whatsapp_agent',
      payment_type: 'EPS',
      eps_name: 'Sura',
      authorization_code: authCode(),
      clinic_value: 85000,
      eps_value: 72250,      // 85% de 85.000
      patient_copago: 12750,  // cuota moderadora categoría B
      invoice_status: 'pagada',
      invoice_radication_date: dateOnly(-50 + 2), // radicó 2 días después
      outstanding_balance: 0,
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 2. PAGADA — Nueva EPS, pagó a los 42 días ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[1].id,
      starts_at: cotDate(-60, 10, 30),
      ends_at: cotDate(-60, 11, 0),
      status: 'completed',
      reason: 'Control prenatal',
      source: 'dashboard',
      payment_type: 'EPS',
      eps_name: 'Nueva EPS',
      authorization_code: authCode(),
      clinic_value: 95000,
      eps_value: 85500,      // 90% de 95.000
      patient_copago: 9500,   // cuota moderadora categoría A
      invoice_status: 'pagada',
      invoice_radication_date: dateOnly(-60 + 3),
      outstanding_balance: 0,
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 3. GLOSADA — Compensar, tarifa superior ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[2].id,
      starts_at: cotDate(-40, 14, 0),
      ends_at: cotDate(-40, 14, 30),
      status: 'completed',
      reason: 'Revisión ginecológica',
      source: 'whatsapp_agent',
      payment_type: 'EPS',
      eps_name: 'Compensar',
      authorization_code: authCode(),
      clinic_value: 120000,
      eps_value: 102000,     // 85% de 120.000
      patient_copago: 18000,  // cuota moderadora categoría C
      invoice_status: 'glosada',
      invoice_radication_date: dateOnly(-40 + 1),
      outstanding_balance: 35000, // lo que la EPS no reconoció
      glosa_value: 35000,
      glosa_reason: 'Tarifa superior a la pactada en contrato',
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 4. GLOSADA — Sanitas, falta autorización ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[3].id,
      starts_at: cotDate(-35, 8, 30),
      ends_at: cotDate(-35, 9, 0),
      status: 'completed',
      reason: 'Ecografía obstétrica',
      source: 'whatsapp_agent',
      payment_type: 'EPS',
      eps_name: 'Sanitas',
      authorization_code: authCode(),
      clinic_value: 150000,
      eps_value: 127500,     // 85%
      patient_copago: 22500,
      invoice_status: 'glosada',
      invoice_radication_date: dateOnly(-35 + 2),
      outstanding_balance: 40000,
      glosa_value: 40000,
      glosa_reason: 'Falta autorización previa para procedimiento complementario',
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 5. EN TRÁMITE — Sura, radicada hace 10 días ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[0].id,
      starts_at: cotDate(-15, 15, 0),
      ends_at: cotDate(-15, 15, 30),
      status: 'completed',
      reason: 'Chequeo pediátrico',
      source: 'dashboard',
      payment_type: 'EPS',
      eps_name: 'Sura',
      authorization_code: authCode(),
      clinic_value: 85000,
      eps_value: 76500,      // 90%
      patient_copago: 8500,   // cuota moderadora categoría A
      invoice_status: 'en_tramite',
      invoice_radication_date: dateOnly(-10),
      outstanding_balance: 76500, // esperando pago EPS
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 6. EN TRÁMITE — Nueva EPS, radicada hace 5 días ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[1].id,
      starts_at: cotDate(-8, 11, 0),
      ends_at: cotDate(-8, 11, 30),
      status: 'completed',
      reason: 'Control de presión',
      source: 'whatsapp_agent',
      payment_type: 'EPS',
      eps_name: 'Nueva EPS',
      authorization_code: authCode(),
      clinic_value: 85000,
      eps_value: 72250,      // 85%
      patient_copago: 12750,
      invoice_status: 'en_tramite',
      invoice_radication_date: dateOnly(-5),
      outstanding_balance: 72250,
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 7. VENCIDA — Compensar, >60 días sin pago ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[2].id,
      starts_at: cotDate(-80, 9, 30),
      ends_at: cotDate(-80, 10, 0),
      status: 'completed',
      reason: 'Citología',
      source: 'manual',
      payment_type: 'EPS',
      eps_name: 'Compensar',
      authorization_code: authCode(),
      clinic_value: 110000,
      eps_value: 93500,      // 85%
      patient_copago: 16500,
      invoice_status: 'vencida',
      invoice_radication_date: dateOnly(-78),
      outstanding_balance: 93500, // EPS nunca pagó
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },

    // --- 8. VENCIDA — Sanitas, >65 días, incumplió término legal ---
    {
      id: uuid(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patients[3 % patients.length].id,
      starts_at: cotDate(-75, 16, 0),
      ends_at: cotDate(-75, 16, 30),
      status: 'completed',
      reason: 'Exámenes de laboratorio',
      source: 'whatsapp_agent',
      payment_type: 'EPS',
      eps_name: 'Sanitas',
      authorization_code: authCode(),
      clinic_value: 180000,
      eps_value: 153000,     // 85%
      patient_copago: 26700,  // cuota moderadora categoría C alta
      invoice_status: 'vencida',
      invoice_radication_date: dateOnly(-73),
      outstanding_balance: 153000,
      glosa_value: 0,
      glosa_reason: null,
      reminder_24h_sent: true,
      reminder_2h_sent: true,
      confirmation_received: true,
    },
  ]

  console.log('Insertando 8 citas EPS...')
  const { error: apptErr } = await supabase.from('appointments').insert(epsAppointments)
  if (apptErr) throw apptErr

  // Resumen
  const byStatus = {}
  const totalEpsOwed = { en_tramite: 0, glosada: 0, vencida: 0 }
  for (const a of epsAppointments) {
    byStatus[a.invoice_status] = (byStatus[a.invoice_status] || 0) + 1
    if (a.invoice_status in totalEpsOwed) {
      totalEpsOwed[a.invoice_status] += a.outstanding_balance
    }
  }

  console.log('\n========================================')
  console.log('  SEED EPS COMPLETADO')
  console.log('========================================')
  console.log(`  Citas EPS:     8`)
  console.log(`    - Pagadas:    ${byStatus.pagada}`)
  console.log(`    - Glosadas:   ${byStatus.glosada}`)
  console.log(`    - En trámite: ${byStatus.en_tramite}`)
  console.log(`    - Vencidas:   ${byStatus.vencida}`)
  console.log('')
  console.log(`  Deuda EPS en trámite: ${formatCOP(totalEpsOwed.en_tramite)}`)
  console.log(`  Deuda EPS glosada:    ${formatCOP(totalEpsOwed.glosada)}`)
  console.log(`  Deuda EPS vencida:    ${formatCOP(totalEpsOwed.vencida)}`)
  console.log(`  Total por cobrar:     ${formatCOP(totalEpsOwed.en_tramite + totalEpsOwed.glosada + totalEpsOwed.vencida)}`)
  console.log('========================================\n')
}

main().catch((err) => {
  console.error('\nError:', err.message || err)
  process.exit(1)
})
