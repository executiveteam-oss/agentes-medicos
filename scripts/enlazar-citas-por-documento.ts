/**
 * Enlaza citas FUTURAS sin ficha a su paciente, por DOCUMENTO exacto
 * normalizado. Nunca por nombre.
 *
 * El documento de la cita vive en `external_data.identificacion` ("CC 31422694").
 * DRY_RUN=1 para ver los números sin escribir.
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/enlazar-citas-por-documento.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DRY = process.env.DRY_RUN === '1'
const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

async function main() {
  const { data: citas } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, external_data, status')
    .eq('clinic_id', ALGIA).neq('status', 'cancelled')
    .is('patient_id', null).gte('starts_at', new Date().toISOString())
    .order('starts_at')

  const filas = (citas ?? []) as { id: string; starts_at: string; external_data: Record<string, unknown> | null; status: string }[]
  console.log(`citas futuras sin ficha: ${filas.length}`)

  const docs = [...new Set(filas.map((c) => soloDigitos(c.external_data?.identificacion as string)).filter(Boolean))]
  console.log(`documentos distintos    : ${docs.length}`)

  // Padrón indexado por documento
  const porDoc = new Map<string, string>()
  for (let i = 0; i < docs.length; i += 200) {
    const { data } = await supabaseAdmin.from('patients')
      .select('id, document_number').eq('clinic_id', ALGIA).in('document_number', docs.slice(i, i + 200))
    for (const p of (data ?? []) as { id: string; document_number: string | null }[]) {
      const d = soloDigitos(p.document_number)
      if (d && !porDoc.has(d)) porDoc.set(d, p.id)
    }
  }
  console.log(`documentos con ficha    : ${porDoc.size}\n`)

  let enlazadas = 0, sinMatch = 0, sinDoc = 0
  for (const c of filas) {
    const d = soloDigitos(c.external_data?.identificacion as string)
    if (!d) { sinDoc++; continue }
    const pid = porDoc.get(d)
    if (!pid) { sinMatch++; continue }
    if (!DRY) {
      const { error } = await supabaseAdmin.from('appointments')
        .update({ patient_id: pid, updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) { console.error(`  ❌ ${c.id}: ${error.message}`); continue }
    }
    enlazadas++
  }
  console.log(`${DRY ? '[DRY] ' : ''}enlazadas          : ${enlazadas}`)
  console.log(`sin ficha (doc no está en el padrón): ${sinMatch}`)
  console.log(`sin documento en el payload        : ${sinDoc}`)
  if (DRY) console.log('\nDRY RUN — nada escrito.')
}
main().catch((e) => { console.error(e); process.exit(1) })
