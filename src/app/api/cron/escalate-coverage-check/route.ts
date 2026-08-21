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
import { clinicasVivas } from '@/lib/clinic/clinicas-vivas'

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── POR CLÍNICA, NO GLOBAL (2026-08-21) ──────────────────────────
  //
  // Esto leía consultation_type_rules de TODAS las clínicas de un saque y
  // auditaba con clinic_id: null. Dos consecuencias:
  //   · una regla de una clínica DEMO hacía fallar con 500 el cron del cliente
  //     real, por un servicio que nadie usa
  //   · el hallazgo no decía de quién era, así que no se podía accionar
  // Ahora se recorre clínica por clínica y cada gap se audita con SU clinic_id.
  // La lista de keywords sigue siendo una sola y global — eso es correcto: es
  // código nuestro, no configuración del cliente.
  const clinicas = await clinicasVivas<{ id: string; name: string }>('id, name')
  console.log(`[EscalateCoverage] clínicas a revisar: ${clinicas.length}`)

  const gaps: Array<{ clinic_id: string; clinica: string; uncovered: string[] }> = []
  let ruledTotal = 0

  for (const clinica of clinicas) {
    const { data: rules, error: rulesErr } = await supabaseAdmin
      .from('consultation_type_rules')
      .select('consultation_type_id')
      .eq('clinic_id', clinica.id)
      .eq('rule_type', 'escalate_human')
      .eq('active', true)
    if (rulesErr) {
      console.error(`[EscalateCoverage] ${clinica.name}: error leyendo reglas:`, rulesErr.message)
      return NextResponse.json({ error: 'query_failed', clinic: clinica.id }, { status: 500 })
    }
    const ctIds = [...new Set((rules ?? []).map((r) => r.consultation_type_id as string))]
    if (ctIds.length === 0) continue

    const { data: cts } = await supabaseAdmin
      .from('consultation_types')
      .select('name, is_active')
      .eq('clinic_id', clinica.id)
      .in('id', ctIds)
    const activeNames = (cts ?? []).filter((c) => c.is_active).map((c) => c.name as string)
    ruledTotal += activeNames.length
    const uncovered = findUncoveredEscalateServices(activeNames)
    if (uncovered.length > 0) {
      gaps.push({ clinic_id: clinica.id, clinica: clinica.name, uncovered })
      try {
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinica.id, action: 'escalate_coverage_gap', actor_type: 'system',
          details: { uncovered_services: uncovered, count: uncovered.length },
        })
      } catch { /* no crítico */ }
    }
  }

  console.log(`[EscalateCoverage] servicios ruleados activos=${ruledTotal} · clínicas con hueco=${gaps.length}`)

  if (gaps.length > 0) {
    for (const g of gaps) {
      console.error(`[EscalateCoverage] ⚠️ ${g.clinica}: ${g.uncovered.length} servicio(s) con regla escalate_human SIN keyword en el detector → la paciente que los pida recibirá la promesa equivocada. Agregar keyword en escalate-service-matcher.ts: ${g.uncovered.join(' | ')}`)
    }
    // El cron FALLA a propósito → Vercel lo marca en el dashboard = alerta.
    return NextResponse.json({ status: 'coverage_gap', gaps }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok', clinicas: clinicas.length, ruled: ruledTotal, uncovered: 0 })
}
