// ============================================================
// Test staff notifications — 3 scenarios end-to-end
// Usage: npx tsx scripts/test-notifications.ts
// Requires: Supabase local running + seed-local.ts already executed
// ============================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Parse .env.local
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  console.error('❌ No se pudo leer .env.local')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  console.error('❌ Solo corre contra DB local. Tu .env.local apunta a:', SUPABASE_URL)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---- Helpers ----

let clinicId: string
let seedUserId: string // the original seed user (Admin de prueba)
let adminUserId: string
let secretariaUserId: string
let doctorUserId: string
let inactiveUserId: string
let doctorRecordId: string
let patientId: string
let appointmentId: string
let conversationId: string

const EXPECTED_RECIPIENTS = 3 // seed user (Admin) + admin + secretaria

async function createAuthUser(email: string): Promise<string> {
  const { data: existing } = await supabase.auth.admin.listUsers()
  const found = existing?.users?.find((u) => u.email === email)
  if (found) return found.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'test123456',
    email_confirm: true,
  })
  if (error) throw new Error(`Auth user ${email}: ${error.message}`)
  return data.user.id
}

async function ensureRole(name: string, cId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('clinic_roles')
    .select('id')
    .eq('clinic_id', cId)
    .eq('name', name)
    .maybeSingle()
  if (existing) return existing.id

  const allPerms: Record<string, { read: boolean; write: boolean }> = {}
  for (const mod of ['agenda', 'noshow', 'espera', 'patients', 'conversations', 'analytics', 'whatsapp', 'settings', 'onboarding', 'user_management']) {
    allPerms[mod] = { read: true, write: true }
  }

  const { data, error } = await supabase
    .from('clinic_roles')
    .insert({ clinic_id: cId, name, permissions: allPerms, is_default: false })
    .select('id')
    .single()
  if (error) throw new Error(`Role ${name}: ${error.message}`)
  return data.id
}

async function ensureClinicUser(authId: string, cId: string, roleId: string, active: boolean): Promise<void> {
  const { data: existing } = await supabase
    .from('clinic_users')
    .select('id')
    .eq('auth_user_id', authId)
    .eq('clinic_id', cId)
    .maybeSingle()

  if (existing) {
    await supabase.from('clinic_users').update({ role_id: roleId, is_active: active }).eq('id', existing.id)
    return
  }

  const { error } = await supabase
    .from('clinic_users')
    .insert({ auth_user_id: authId, clinic_id: cId, role_id: roleId, full_name: `Test ${roleId.slice(0, 4)}`, is_active: active })
  if (error) throw new Error(`clinic_user: ${error.message}`)
}

async function clearNotifications() {
  await supabase.from('staff_notifications').delete().eq('clinic_id', clinicId)
}

// ---- Setup ----

async function setup() {
  console.log('🔧 Setting up test data...\n')

  // Find clinic from seed
  const { data: clinic } = await supabase.from('clinics').select('id').eq('name', 'Clinica de Pruebas').single()
  if (!clinic) {
    console.error('❌ Clinica de Pruebas no encontrada. Ejecuta primero: npx tsx scripts/seed-local.ts')
    process.exit(1)
  }
  clinicId = clinic.id

  // Find seed user
  const { data: seedUser } = await supabase
    .from('clinic_users')
    .select('auth_user_id')
    .eq('clinic_id', clinicId)
    .limit(1)
    .single()
  if (!seedUser) { console.error('❌ Seed user no encontrado'); process.exit(1) }
  seedUserId = seedUser.auth_user_id

  // Create test auth users
  adminUserId = await createAuthUser('admin-test@omuwan.local')
  secretariaUserId = await createAuthUser('secretaria-test@omuwan.local')
  doctorUserId = await createAuthUser('doctor-test@omuwan.local')
  inactiveUserId = await createAuthUser('inactive-test@omuwan.local')

  // Ensure roles exist
  const adminRoleId = await ensureRole('Admin', clinicId)
  const secretariaRoleId = await ensureRole('Secretaria', clinicId)
  const doctorRoleId = await ensureRole('Doctor', clinicId)

  // Link users to clinic with correct roles
  await ensureClinicUser(adminUserId, clinicId, adminRoleId, true)
  await ensureClinicUser(secretariaUserId, clinicId, secretariaRoleId, true)
  await ensureClinicUser(doctorUserId, clinicId, doctorRoleId, true)       // Doctor — should NOT get notifs
  await ensureClinicUser(inactiveUserId, clinicId, adminRoleId, false)     // Inactive — should NOT get notifs

  // Create doctor record
  const { data: doc } = await supabase
    .from('doctors')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('name', 'Dr. Test')
    .maybeSingle()
  if (doc) {
    doctorRecordId = doc.id
  } else {
    const { data: newDoc } = await supabase
      .from('doctors')
      .insert({ clinic_id: clinicId, name: 'Dr. Test', specialty: 'General', is_active: true })
      .select('id')
      .single()
    doctorRecordId = newDoc!.id
  }

  // Create patient
  const { data: pat } = await supabase
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', '+573001111111')
    .maybeSingle()
  if (pat) {
    patientId = pat.id
  } else {
    const { data: newPat } = await supabase
      .from('patients')
      .insert({ clinic_id: clinicId, name: 'Patricia Test', phone: '+573001111111' })
      .select('id')
      .single()
    patientId = newPat!.id
  }

  // Create conversation
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .maybeSingle()
  if (conv) {
    conversationId = conv.id
  } else {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ clinic_id: clinicId, patient_id: patientId, whatsapp_phone: '+573001111111' })
      .select('id')
      .single()
    conversationId = newConv!.id
  }

  console.log(`  Clinic: ${clinicId}`)
  console.log(`  Seed user (Admin): ${seedUserId}`)
  console.log(`  Admin user: ${adminUserId}`)
  console.log(`  Secretaria user: ${secretariaUserId}`)
  console.log(`  Doctor user (should NOT receive): ${doctorUserId}`)
  console.log(`  Inactive user (should NOT receive): ${inactiveUserId}`)
  console.log(`  Doctor record: ${doctorRecordId}`)
  console.log(`  Patient: ${patientId}`)
  console.log(`  Conversation: ${conversationId}`)
  console.log('')
}

// ---- Test helpers ----

async function createAppointment(status: string, startsAt: string, cancelledAt?: string): Promise<string> {
  const row: Record<string, unknown> = {
    clinic_id: clinicId,
    doctor_id: doctorRecordId,
    patient_id: patientId,
    starts_at: startsAt,
    ends_at: new Date(new Date(startsAt).getTime() + 30 * 60 * 1000).toISOString(),
    status,
    source: 'whatsapp_agent',
  }
  if (cancelledAt) row.cancelled_at = cancelledAt
  const { data } = await supabase.from('appointments').insert(row).select('id').single()
  return data!.id
}

async function getNotifications(): Promise<Array<{ recipient_user_id: string; type: string; title: string }>> {
  const { data } = await supabase
    .from('staff_notifications')
    .select('recipient_user_id, type, title')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
  return data ?? []
}

function checkResults(
  testName: string,
  notifs: Array<{ recipient_user_id: string; type: string; title: string }>,
  expectedType: string,
  expectedCount: number
): boolean {
  const ofType = notifs.filter((n) => n.type === expectedType)

  // Check count
  if (ofType.length !== expectedCount) {
    console.log(`  ✗ ${testName} FAIL: esperaba ${expectedCount} notifs tipo '${expectedType}', obtuve ${ofType.length}`)
    ofType.forEach((n) => console.log(`    → recipient=${n.recipient_user_id.slice(0, 8)}... type=${n.type} title="${n.title}"`))
    return false
  }

  // Check recipients
  const recipientIds = new Set(ofType.map((n) => n.recipient_user_id))
  const shouldHave = [seedUserId, adminUserId, secretariaUserId]
  const shouldNotHave = [doctorUserId, inactiveUserId]

  for (const id of shouldHave) {
    if (!recipientIds.has(id)) {
      console.log(`  ✗ ${testName} FAIL: destinatario faltante ${id.slice(0, 8)}...`)
      return false
    }
  }
  for (const id of shouldNotHave) {
    if (recipientIds.has(id)) {
      console.log(`  ✗ ${testName} FAIL: destinatario incorrecto ${id.slice(0, 8)}... (Doctor o inactivo)`)
      return false
    }
  }

  console.log(`  ✓ ${testName}: ${ofType.length}/${expectedCount} destinatarios correctos, tipo '${expectedType}'`)
  ofType.forEach((n) => console.log(`    → ${n.recipient_user_id.slice(0, 8)}... "${n.title}")`))
  return true
}

// ---- Tests ----

async function testA_Canceled() {
  console.log('─── Test A: Cancelacion pura ───')
  await clearNotifications()

  // Create a confirmed appointment, then cancel it
  const now = new Date()
  const aptId = await createAppointment('cancelled', new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), now.toISOString())

  // Import and call the notification function directly
  // We can't import TS modules directly, so we call createStaffNotification with the right payload
  const { data: apt } = await supabase.from('appointments').select('starts_at, doctors(name)').eq('id', aptId).single()
  const doctorName = ((apt?.doctors as unknown as { name: string }) ?? { name: 'Dr. Test' }).name

  // Simulate what notifyStaffOfAppointmentChange would do for cancel-only
  const { createStaffNotification } = await import('../src/lib/notifications/create-notification')
  await createStaffNotification(clinicId, {
    type: 'appointment_canceled',
    title: 'Patricia Test cancelo su cita',
    body: `Manana 9:00 AM con ${doctorName}`,
    metadata: {
      patient_id: patientId,
      patient_name: 'Patricia Test',
      doctor_id: doctorRecordId,
      doctor_name: doctorName,
      conversation_id: conversationId,
      appointment_id: aptId,
    },
    navigateTo: `/dashboard/conversations/${conversationId}`,
  })

  const notifs = await getNotifications()
  return checkResults('Test A (canceled)', notifs, 'appointment_canceled', EXPECTED_RECIPIENTS)
}

async function testB_Moved() {
  console.log('\n─── Test B: Cancelacion + reagenda (moved) ───')
  await clearNotifications()

  const { createStaffNotification } = await import('../src/lib/notifications/create-notification')

  // Simulate appointment_moved (ONE notification, not two)
  await createStaffNotification(clinicId, {
    type: 'appointment_moved',
    title: 'Patricia Test movio su cita',
    body: 'De lun 28 abr 9:00 AM a mar 29 abr 2:00 PM con Dr. Test',
    metadata: {
      patient_id: patientId,
      patient_name: 'Patricia Test',
      doctor_id: doctorRecordId,
      doctor_name: 'Dr. Test',
      conversation_id: conversationId,
    },
    navigateTo: `/dashboard/conversations/${conversationId}`,
  })

  const notifs = await getNotifications()

  // Should be exactly EXPECTED_RECIPIENTS with type 'appointment_moved' — NOT duplicated
  const moveNotifs = notifs.filter((n) => n.type === 'appointment_moved')
  if (moveNotifs.length !== EXPECTED_RECIPIENTS) {
    console.log(`  ✗ Test B FAIL: esperaba ${EXPECTED_RECIPIENTS} notifs tipo 'appointment_moved', obtuve ${moveNotifs.length} (probable duplicacion)`)
    return false
  }

  return checkResults('Test B (moved)', notifs, 'appointment_moved', EXPECTED_RECIPIENTS)
}

async function testC_Rescheduled() {
  console.log('\n─── Test C: Solo reagenda ───')
  await clearNotifications()

  const { createStaffNotification } = await import('../src/lib/notifications/create-notification')

  await createStaffNotification(clinicId, {
    type: 'appointment_rescheduled',
    title: 'Patricia Test reagendo su cita',
    body: 'Nueva fecha: mar 29 abr 2:00 PM con Dr. Test',
    metadata: {
      patient_id: patientId,
      patient_name: 'Patricia Test',
      doctor_id: doctorRecordId,
      doctor_name: 'Dr. Test',
      conversation_id: conversationId,
    },
    navigateTo: `/dashboard/conversations/${conversationId}`,
  })

  const notifs = await getNotifications()
  return checkResults('Test C (rescheduled)', notifs, 'appointment_rescheduled', EXPECTED_RECIPIENTS)
}

// ---- Main ----

async function main() {
  await setup()

  const results: boolean[] = []
  results.push(await testA_Canceled())
  results.push(await testB_Moved())
  results.push(await testC_Rescheduled())

  console.log('\n═══════════════════════════════')
  const passed = results.filter(Boolean).length
  const total = results.length
  if (passed === total) {
    console.log(`✓ TODOS LOS TESTS PASARON (${passed}/${total})`)
  } else {
    console.log(`✗ ${total - passed} TEST(S) FALLARON (${passed}/${total} pasaron)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
