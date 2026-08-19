/**
 * Genera la agenda diaria REAL de cada médico y verifica el contenido antes de
 * que la impriman. SOLO LECTURA: no escribe en la DB y no envía nada.
 *
 * Deja los PDF en el scratchpad para abrirlos y mirarlos.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-agenda-diaria-pdf.ts [YYYY-MM-DD]
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
import { existsSync, readFileSync, writeFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const FECHA = process.argv[2] ?? '2026-08-20'
const SALIDA = '/private/tmp/claude-501/-Users-juanlondono-Documents-agentes-medicos/f23fd6bc-3b8d-4110-a3e8-a36a9a4c2b14/scratchpad'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { buildAgendaDiariaPdf, SIN_DATO } = await import('@/lib/reports/agenda-diaria/build-pdf')
  const { armarFilasAgenda } = await import('@/lib/reports/agenda-diaria/armar-filas')
  const { format, parseISO } = await import('date-fns')
  const { es } = await import('date-fns/locale')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: citas } = await admin.from('appointments')
    .select(`starts_at, reason, eps_name, payment_type, external_service_name, external_data, doctor_id,
             doctors(name, specialty), patients(name, document_type, document_number), consultation_types(name)`)
    .eq('clinic_id', ALGIA).in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', `${FECHA}T00:00:00-05:00`).lte('starts_at', `${FECHA}T23:59:59-05:00`)
    .order('starts_at')

  if (!citas?.length) { console.log(`Sin citas el ${FECHA}`); return }
  const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  const porMedico = new Map<string, typeof citas>()
  for (const c of citas) {
    const k = c.doctor_id as string
    porMedico.set(k, [...(porMedico.get(k) ?? []), c])
  }

  console.log(`═══ ${FECHA} · ${citas.length} citas · ${porMedico.size} médicos ═══\n`)
  let vacios = 0, total = 0
  const conteo: Record<string, number> = {}

  for (const [, delMedico] of porMedico) {
    const norm = delMedico.map((c) => ({
      starts_at: c.starts_at as string, reason: c.reason as string | null,
      eps_name: c.eps_name as string | null, payment_type: c.payment_type as string | null,
      external_service_name: c.external_service_name as string | null,
      external_data: c.external_data as Record<string, unknown> | null,
      doctor: uno(c.doctors as never), patient: uno(c.patients as never),
      consultation_type: uno(c.consultation_types as never),
    }))
    const filas = armarFilasAgenda(norm as never)
    const nombre = (uno(delMedico[0].doctors as never) as { name: string } | null)?.name ?? '?'

    for (const f of filas) {
      total += Object.keys(f).length
      for (const [k, v] of Object.entries(f)) {
        if (v === SIN_DATO) { vacios++; conteo[k] = (conteo[k] ?? 0) + 1 }
      }
    }

    const pdf = await buildAgendaDiariaPdf({
      doctorName: nombre,
      fechaLarga: format(parseISO(`${FECHA}T12:00:00-05:00`), "EEEE d 'de' MMMM 'de' yyyy", { locale: es }),
      clinicName: 'ALGIA', filas,
    })
    const slug = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    writeFileSync(`${SALIDA}/agenda-${slug}.pdf`, pdf)
    console.log(`  ${nombre.padEnd(34)} ${String(filas.length).padStart(2)} citas → ${(pdf.length / 1024).toFixed(1)} KB`)
    // Primera fila, para ver que el contenido salió bien.
    if (filas[0]) {
      const f = filas[0]
      console.log(`     ${f.horaInicia} · ${f.especialidad} · ${f.aseguradora} · ${f.tipoId} ${f.nroId} · ${f.producto}`)
    }
  }

  console.log(`\n═══ Celdas sin dato: ${vacios} de ${total} ═══`)
  for (const [col, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) console.log(`  ${col}: ${n}`)
  console.log(`\nPDFs en ${SALIDA}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
