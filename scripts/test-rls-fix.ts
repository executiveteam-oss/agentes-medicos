/**
 * Test RLS fixes from migration 00065
 * Run against LOCAL Supabase: npx tsx scripts/test-rls-fix.ts
 *
 * Tests:
 *   A. invitations accessible via supabaseAdmin (service_role)
 *   B. invitations invisible via authenticated client
 *   C. access_waitlist same pattern
 *   D. chatbot_conversations — user reads own, not others'
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const anon = createClient(SUPABASE_URL, ANON_KEY)

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

async function cleanup(ids: { invitationId?: string; waitlistId?: string; chatUserA?: string; chatUserB?: string; convA?: string; convB?: string }) {
  if (ids.convA) await admin.from('chatbot_conversations').delete().eq('id', ids.convA)
  if (ids.convB) await admin.from('chatbot_conversations').delete().eq('id', ids.convB)
  if (ids.invitationId) await admin.from('invitations').delete().eq('id', ids.invitationId)
  if (ids.waitlistId) await admin.from('access_waitlist').delete().eq('id', ids.waitlistId)
  // Clean up test auth users
  if (ids.chatUserA) await admin.auth.admin.deleteUser(ids.chatUserA)
  if (ids.chatUserB) await admin.auth.admin.deleteUser(ids.chatUserB)
}

async function main() {
  const ids: { invitationId?: string; waitlistId?: string; chatUserA?: string; chatUserB?: string; convA?: string; convB?: string } = {}

  try {
    // ============================================================
    // TEST A: invitations — service_role can INSERT + SELECT
    // ============================================================
    console.log('\n--- TEST A: invitations via supabaseAdmin ---')

    // Get a clinic_id and role_id for FK constraints
    const { data: clinic } = await admin.from('clinics').select('id').limit(1).single()
    const { data: role } = await admin.from('clinic_roles').select('id').limit(1).single()

    if (!clinic || !role) {
      console.log('  ⚠️  No clinic or role found in local DB. Seed first.')
      return
    }

    const testToken = 'test-rls-' + Date.now()
    const { data: inv, error: invInsertErr } = await admin
      .from('invitations')
      .insert({
        clinic_id: clinic.id,
        email: 'test-rls@example.com',
        full_name: 'Test RLS User',
        role_id: role.id,
        token: testToken,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select('id')
      .single()

    assert('INSERT via service_role succeeds', !invInsertErr && !!inv, invInsertErr?.message)
    ids.invitationId = inv?.id

    const { data: invRead, error: invReadErr } = await admin
      .from('invitations')
      .select('id, email, token')
      .eq('token', testToken)
      .single()

    assert('SELECT via service_role succeeds', !invReadErr && invRead?.token === testToken, invReadErr?.message)

    // ============================================================
    // TEST B: invitations — anon/authenticated CANNOT read
    // ============================================================
    console.log('\n--- TEST B: invitations via anon ---')

    const { data: invAnon, error: invAnonErr } = await anon
      .from('invitations')
      .select('id, email, token')
      .eq('token', testToken)

    assert('SELECT via anon returns 0 rows (RLS blocks)', !invAnonErr && (invAnon?.length ?? 0) === 0,
      invAnonErr ? invAnonErr.message : `got ${invAnon?.length} rows`)

    const { error: invAnonInsertErr } = await anon
      .from('invitations')
      .insert({
        clinic_id: clinic.id,
        email: 'hacker@evil.com',
        full_name: 'Hacker',
        role_id: role.id,
        token: 'hacked-token',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })

    assert('INSERT via anon fails (RLS blocks)', !!invAnonInsertErr, invAnonInsertErr ? '' : 'insert succeeded!')

    // ============================================================
    // TEST C: access_waitlist — same pattern
    // ============================================================
    console.log('\n--- TEST C: access_waitlist ---')

    const { data: aw, error: awInsertErr } = await admin
      .from('access_waitlist')
      .insert({
        full_name: 'Test Clinic',
        clinic_name: 'Clinica Test',
        city: 'Pereira',
        email: 'test@example.com',
        whatsapp: '+573001234567',
      })
      .select('id')
      .single()

    assert('INSERT via service_role succeeds', !awInsertErr && !!aw, awInsertErr?.message)
    ids.waitlistId = aw?.id

    const { data: awRead } = await admin
      .from('access_waitlist')
      .select('id')
      .eq('id', aw!.id)
      .single()

    assert('SELECT via service_role succeeds', !!awRead)

    const { data: awAnon } = await anon
      .from('access_waitlist')
      .select('id')

    assert('SELECT via anon returns 0 rows', (awAnon?.length ?? 0) === 0, `got ${awAnon?.length} rows`)

    const { error: awAnonInsertErr } = await anon
      .from('access_waitlist')
      .insert({
        full_name: 'Hacker',
        clinic_name: 'Evil Clinic',
        city: 'Nowhere',
        email: 'hacker@evil.com',
        whatsapp: '+570000000000',
      })

    assert('INSERT via anon fails (RLS blocks)', !!awAnonInsertErr, awAnonInsertErr ? '' : 'insert succeeded!')

    // ============================================================
    // TEST D: chatbot_conversations — user reads own, not others'
    // ============================================================
    console.log('\n--- TEST D: chatbot_conversations SELECT policy ---')

    // Create two test users
    const { data: userAData } = await admin.auth.admin.createUser({
      email: 'testA-rls@example.com',
      password: 'TestPass123!',
      email_confirm: true,
      user_metadata: { clinic_id: clinic.id },
    })
    const { data: userBData } = await admin.auth.admin.createUser({
      email: 'testB-rls@example.com',
      password: 'TestPass456!',
      email_confirm: true,
      user_metadata: { clinic_id: clinic.id },
    })

    const userA = userAData?.user
    const userB = userBData?.user

    if (!userA || !userB) {
      console.log('  ⚠️  Could not create test users')
      return
    }
    ids.chatUserA = userA.id
    ids.chatUserB = userB.id

    // Insert conversations for both users via service_role
    const { data: convA } = await admin
      .from('chatbot_conversations')
      .insert({ clinic_id: clinic.id, user_id: userA.id })
      .select('id')
      .single()

    const { data: convB } = await admin
      .from('chatbot_conversations')
      .insert({ clinic_id: clinic.id, user_id: userB.id })
      .select('id')
      .single()

    ids.convA = convA?.id
    ids.convB = convB?.id

    assert('Setup: 2 conversations created', !!convA && !!convB)

    // Sign in as User A
    const clientA = createClient(SUPABASE_URL, ANON_KEY)
    const { error: signInErr } = await clientA.auth.signInWithPassword({
      email: 'testA-rls@example.com',
      password: 'TestPass123!',
    })

    if (signInErr) {
      console.log('  ⚠️  Could not sign in as User A:', signInErr.message)
      return
    }

    // User A reads conversations — should see only their own
    const { data: aConvs, error: aConvsErr } = await clientA
      .from('chatbot_conversations')
      .select('id, user_id')

    assert('User A can read conversations', !aConvsErr, aConvsErr?.message)
    assert('User A sees exactly 1 conversation (own)', aConvs?.length === 1, `got ${aConvs?.length}`)
    assert('User A sees their own conversation', aConvs?.[0]?.user_id === userA.id,
      aConvs?.[0]?.user_id ? `saw user_id=${aConvs[0].user_id}` : 'no data')

    // Sign in as User B
    const clientB = createClient(SUPABASE_URL, ANON_KEY)
    await clientB.auth.signInWithPassword({
      email: 'testB-rls@example.com',
      password: 'TestPass456!',
    })

    const { data: bConvs } = await clientB
      .from('chatbot_conversations')
      .select('id, user_id')

    assert('User B sees exactly 1 conversation (own)', bConvs?.length === 1, `got ${bConvs?.length}`)
    assert('User B sees their own conversation (not A\'s)', bConvs?.[0]?.user_id === userB.id)

  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---')
    await cleanup(ids)
    console.log('  Done.')

    console.log(`\n========================================`)
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`)
    console.log(`========================================\n`)

    process.exit(failed > 0 ? 1 : 0)
  }
}

main()
