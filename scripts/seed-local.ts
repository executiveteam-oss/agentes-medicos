// ============================================================
// Seed local Supabase DB for chatbot testing
// Usage: npx tsx scripts/seed-local.ts
// Only runs against local DB (127.0.0.1 / localhost)
// ============================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Parse .env.local manually (no dotenv dependency needed)
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

const TEST_EMAIL = 'test@omuwan.local'
const TEST_PASSWORD = 'test123456'
const CLINIC_NAME = 'Clinica de Pruebas'
const ROLE_NAME = 'Admin de prueba'

async function main() {
  // 1. Safety check — only local DB
  if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
    console.error('❌ Este script solo corre contra DB local. Tu .env.local apunta a:', SUPABASE_URL)
    process.exit(1)
  }

  if (!SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY no encontrada en .env.local')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('🔧 Seeding local DB at', SUPABASE_URL)
  console.log('')

  // 2. Create auth user
  let authUserId: string

  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  const existing = existingUsers?.users?.find((u) => u.email === TEST_EMAIL)

  if (existing) {
    authUserId = existing.id
    console.log(`⏭️  Usuario ${TEST_EMAIL} ya existe (${authUserId})`)
  } else {
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (error) {
      console.error('❌ Error creando usuario:', error.message)
      process.exit(1)
    }
    authUserId = newUser.user.id
    console.log(`✓ Usuario creado: ${TEST_EMAIL} (${authUserId})`)
  }

  // 3. Create clinic
  let clinicId: string

  const { data: existingClinic } = await supabase
    .from('clinics')
    .select('id')
    .eq('name', CLINIC_NAME)
    .maybeSingle()

  if (existingClinic) {
    clinicId = existingClinic.id
    console.log(`⏭️  Clinica "${CLINIC_NAME}" ya existe (${clinicId})`)
  } else {
    const slug = 'pruebas-' + Date.now()
    const { data: newClinic, error } = await supabase
      .from('clinics')
      .insert({
        name: CLINIC_NAME,
        slug,
        phone: '+573001234567',
        specialty: ['ginecología'],
        agent_name: 'Asistente de prueba',
        agent_personality: 'profesional y amable',
        city: 'Pereira',
        department: 'Risaralda',
        subscription_status: 'trial',
        subscription_plan: 'core',
        onboarded_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.error('❌ Error creando clinica:', error.message)
      process.exit(1)
    }
    clinicId = newClinic.id
    console.log(`✓ Clinica creada: "${CLINIC_NAME}" (${clinicId})`)
  }

  // 4. Create role with all permissions
  let roleId: string

  const { data: existingRole } = await supabase
    .from('clinic_roles')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('name', ROLE_NAME)
    .maybeSingle()

  if (existingRole) {
    roleId = existingRole.id
    console.log(`⏭️  Rol "${ROLE_NAME}" ya existe (${roleId})`)
  } else {
    const allPerms: Record<string, { read: boolean; write: boolean }> = {}
    for (const mod of ['agenda', 'noshow', 'espera', 'patients', 'conversations', 'analytics', 'whatsapp', 'settings', 'onboarding', 'user_management']) {
      allPerms[mod] = { read: true, write: true }
    }

    const { data: newRole, error } = await supabase
      .from('clinic_roles')
      .insert({
        clinic_id: clinicId,
        name: ROLE_NAME,
        description: 'Admin con todos los permisos (seed local)',
        permissions: allPerms,
        is_default: false,
      })
      .select('id')
      .single()

    if (error) {
      console.error('❌ Error creando rol:', error.message)
      process.exit(1)
    }
    roleId = newRole.id
    console.log(`✓ Rol creado: "${ROLE_NAME}" (${roleId})`)
  }

  // 5. Create clinic_user link
  const { data: existingLink } = await supabase
    .from('clinic_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (existingLink) {
    console.log(`⏭️  clinic_user ya existe (${existingLink.id})`)
  } else {
    const { error } = await supabase
      .from('clinic_users')
      .insert({
        auth_user_id: authUserId,
        clinic_id: clinicId,
        role_id: roleId,
        full_name: 'Tester Omuwan',
        is_active: true,
      })

    if (error) {
      console.error('❌ Error creando clinic_user:', error.message)
      process.exit(1)
    }
    console.log(`✓ clinic_user vinculado`)
  }

  // 6. Print summary
  console.log('')
  console.log('✓ Seed completado')
  console.log('─────────────────────────────────────')
  console.log('Login con:')
  console.log(`  Email:    ${TEST_EMAIL}`)
  console.log(`  Password: ${TEST_PASSWORD}`)
  console.log(`  URL:      http://localhost:3000/login`)
  console.log('')
}

main().catch((err) => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
