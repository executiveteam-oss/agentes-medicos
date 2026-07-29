// ============================================================
// Cron: CHECK DE COBERTURA de la escalación determinista (escalate_human).
//
// PROBLEMA: la lista curada de keywords en escalate-service-matcher.ts se
// desincroniza EN SILENCIO. Si alguien agrega una regla escalate_human a un
// servicio nuevo desde el dashboard (pasó con el DIU de Jorge), el detector no
// lo cubre y NADIE se entera → la paciente que pida ese servicio recibe la
// promesa equivocada que la escalación determinista debía prevenir.
//
// Este cron corre DIARIO contra la DB viva y compara los servicios con regla
// escalate_human ACTIVA contra la cobertura de keywords. Si alguno queda sin
// cubrir → alerta (audit_log + log prominente + el cron FALLA con 500, que
// Vercel marca en el dashboard de crons). No depende de que nadie se acuerde.
//
// Por qué cron y no test de CI: el drift es de DATOS (regla agregada en prod,
// sin commit). Un test de CI solo corre en cambios de código → no lo atraparía.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'
import { findUncoveredEscalateServices } from '@/lib/safety/escalate-service-matcher'

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Reglas escalate_human activas → consultation_type_ids.
  const { data: rules, error: rulesErr } = await supabaseAdmin
    .from('consultation_type_rules')
    .select('consultation_type_id')
    .eq('rule_type', 'escalate_human')
    .eq('active', true)
  if (rulesErr) {
    console.error('[EscalateCoverage] error leyendo reglas:', rulesErr.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  const ctIds = [...new Set((rules ?? []).map((r) => r.consultation_type_id as string))]
  if (ctIds.length === 0) {
    console.log('[EscalateCoverage] 0 reglas escalate_human activas — nada que cubrir.')
    return NextResponse.json({ status: 'ok', ruled: 0, uncovered: 0 })
  }

  // 2. Nombres + clínica de esos CTs activos (2 queries, no embed frágil).
  const { data: cts } = await supabaseAdmin
    .from('consultation_types')
    .select('clinic_id, name, is_active')
    .in('id', ctIds)
  const activeNames = (cts ?? []).filter((c) => c.is_active).map((c) => c.name as string)

  // 3. Cobertura.
  const uncovered = findUncoveredEscalateServices(activeNames)

  console.log(`[EscalateCoverage] servicios ruleados activos=${activeNames.length} · sin cubrir=${uncovered.length}`)

  if (uncovered.length > 0) {
    console.error(`[EscalateCoverage] ⚠️ ${uncovered.length} servicio(s) con regla escalate_human SIN keyword en el detector determinista → la paciente que los pida recibirá la promesa equivocada. Agregar keyword en escalate-service-matcher.ts: ${uncovered.join(' | ')}`)
    try {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: null, action: 'escalate_coverage_gap', actor_type: 'system',
        details: { uncovered_services: uncovered, count: uncovered.length },
      })
    } catch { /* no crítico */ }
    // El cron FALLA a propósito → Vercel lo marca en el dashboard de crons = alerta.
    return NextResponse.json({ status: 'coverage_gap', uncovered }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok', ruled: activeNames.length, uncovered: 0 })
}
