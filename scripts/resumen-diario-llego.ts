// ============================================================
// ¿LE LLEGÓ EL RESUMEN A LOS MÉDICOS?
//
//   npx tsx --env-file=.env.production.local scripts/resumen-diario-llego.ts [YYYY-MM-DD]
//
// Sin fecha usa hoy (COT). Cruza lo que el cron registró al enviar con el estado
// de entrega que Meta devolvió por webhook.
//
// LA DISTINCIÓN QUE ESTE SCRIPT EXISTE PARA HACER: "enviado" significa que Meta
// aceptó el POST. NO significa que el médico lo haya recibido. El 14/08 un
// resumen quedó "enviado" y nunca llegó al teléfono. La columna que importa es
// ENTREGA.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

const fecha = process.argv[2] ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

type Fila = { details: Record<string, unknown>; created_at: string }

async function main() {
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select('details, created_at')
    .eq('action', 'morning_report_sent')
    .order('created_at', { ascending: true })

  const delDia = ((data ?? []) as Fila[]).filter((r) => r.details?.fecha === fecha)

  if (delDia.length === 0) {
    console.log(`\n❌ NO HAY NINGÚN REGISTRO PARA ${fecha}.`)
    console.log('   El cron no corrió, o corrió antes de que existiera el registro.')
    console.log('   Ojo: esto NO significa "no se envió" — significa "no sabemos".\n')
    process.exit(1)
  }

  // Estados de entrega de los wamid de ese día
  const wamids = delDia.map((r) => r.details.wamid as string | undefined).filter(Boolean) as string[]
  const estados = new Map<string, { status: string; error_code: number | null; error_title: string | null }>()
  if (wamids.length > 0) {
    const { data: st } = await supabaseAdmin
      .from('whatsapp_message_status')
      .select('wamid, status, error_code, error_title')
      .in('wamid', wamids)
    for (const s of st ?? []) {
      estados.set(s.wamid as string, {
        status: s.status as string,
        error_code: s.error_code as number | null,
        error_title: s.error_title as string | null,
      })
    }
  }

  console.log(`\n📋 RESUMEN DIARIO — ${fecha}\n`)
  console.log('MÉDICO                        CITAS  CRON       ENTREGA')
  console.log('─'.repeat(78))

  let llegaron = 0, fallaron = 0, sinDato = 0, sinCitas = 0

  for (const r of delDia) {
    const d = r.details
    const resultado = d.resultado as string
    const medico = String(d.doctor_name ?? '?').slice(0, 28).padEnd(30)
    const citas = String(d.citas ?? 0).padStart(3)

    if (resultado === 'sin_citas') {
      sinCitas++
      console.log(`${medico}${citas}    —          (no tenía citas)`)
      continue
    }
    if (resultado === 'fallo' || resultado === 'prueba_fallo') {
      fallaron++
      console.log(`${medico}${citas}    ✗ falló    code ${d.meta_code ?? '?'}`)
      continue
    }

    const wamid = d.wamid as string | undefined
    if (!wamid) {
      sinDato++
      console.log(`${medico}${citas}    ✓ enviado  ⚠ sin wamid — no se puede saber si llegó`)
      continue
    }
    const e = estados.get(wamid)
    if (!e) {
      sinDato++
      console.log(`${medico}${citas}    ✓ enviado  ⏳ sin estado todavía (Meta no lo reportó)`)
    } else if (e.status === 'failed') {
      fallaron++
      console.log(`${medico}${citas}    ✓ enviado  ❌ FAILED — code ${e.error_code ?? '?'} ${e.error_title ?? ''}`)
    } else if (e.status === 'delivered' || e.status === 'read') {
      llegaron++
      console.log(`${medico}${citas}    ✓ enviado  ✅ ${e.status.toUpperCase()}`)
    } else {
      sinDato++
      console.log(`${medico}${citas}    ✓ enviado  ⏳ ${e.status} (aceptado, sin confirmar entrega)`)
    }
  }

  console.log('─'.repeat(78))
  console.log(`\n✅ Entregados: ${llegaron}   ❌ Fallidos: ${fallaron}   ⏳ Sin confirmar: ${sinDato}   — Sin citas: ${sinCitas}\n`)

  if (fallaron > 0 || sinDato > 0) {
    console.log('⚠️  "Enviado" ≠ "llegó". Solo DELIVERED y READ confirman que el médico lo tiene.\n')
  }
}

main().then(() => process.exit(0))

export {}
