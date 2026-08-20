/**
 * LA CADENA COMPLETA DE UN REAGENDAMIENTO, CONTRA PRODUCCIÓN.
 *
 * Se crea una cita, se mueve, y se verifica que:
 *   1. la cita nueva existe, confirmada y DENTRO del horario del médico
 *   2. la cita vieja quedó en 'cancelled' (no en 'rescheduled')
 *   3. su cancellation_reason tiene el motivo escrito, CON AÑO
 *   4. el cupo viejo quedó LIBRE para otra paciente  ← lo que se arregló
 *   5. la pantalla muestra el badge "Reagendada", no "Cancelada"
 *
 * 🔒 NO TOCA A NINGUNA PACIENTE REAL.
 * Crea su propia ficha con un teléfono imposible (+57 000 000 0000) y
 * proactive_contact_opt_in en false, y borra todo en un `finally` — incluso si
 * algo falla a la mitad.
 *
 * Efectos hacia afuera verificados como inocuos ANTES de correr esto:
 *   · notifyWaitlist  → 0 entradas en 'waiting' para este médico
 *   · sync al HIS     → clinics.integrations.his es null (no hay conector)
 *   · Google Sheets   → la clínica no tiene google_sheet_id
 *
 * Run: TZ=America/Bogota npx tsx scripts/e2e-reagendamiento-legitimo.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p: string): void {
  if (!existsSync(p)) return
  for (const l of readFileSync(p, 'utf-8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const e = t.indexOf('='); if (e < 0) continue
    const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE = '069523a9-f13b-4268-a77c-514d54c5672c'
const CT_SIN_REGLAS = '8b0aebca-6a1f-43b7-8a04-55f8feba5aa0'  // ECOGRAFÍA DINÁMICA DE PISO PELVICO
const TEL_PRUEBA = '+570000000000'
const NOMBRE_PRUEBA = 'PRUEBA OMUWAN NO CONTACTAR'

// Viernes 25/09/2026. Jorge atiende 07:30–11:00; ese día sólo está tomada la de 07:30.
const CITA_ORIGINAL = '2026-09-25T13:00:00.000Z'   // 08:00 COT
const CITA_MOVIDA   = '2026-09-25T14:30:00.000Z'   // 09:30 COT

/** Dos fechas ISO son el mismo momento aunque se escriban distinto. */
function mismoInstante(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b)
}

let fallos = 0
function chequear(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`  ${ok ? '✅' : '🔴'} ${nombre}${detalle ? `  ${detalle}` : ''}`)
  if (!ok) fallos++
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { executeTool } = await import('../src/agents/tools/executor')
  const { puedeEscribirseLaCita } = await import('../src/lib/calendar/appointment-write-check')
  const { etiquetaEstado } = await import('../src/components/dashboard/calendar/types')

  const { data: clinic } = await supa.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctor } = await supa.from('doctors').select('*').eq('id', JORGE).single()

  const base = await supa.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  console.log(`\nBaseline: ${base.count} citas · médico: ${doctor!.name}`)
  console.log(`Viernes 25/09/2026, franja 07:30–11:00 · original 08:00 → movida 09:30\n`)

  let patientId: string | null = null
  const creadas: string[] = []

  try {
    // ── Ficha de prueba, aislada de todo cron ────────────────────────────
    const { data: pac, error: ePac } = await supa.from('patients').insert({
      clinic_id: ALGIA, name: NOMBRE_PRUEBA, phone: TEL_PRUEBA,
      proactive_contact_opt_in: false,   // que ningún cron proactivo la alcance
    }).select('id').single()
    if (ePac) throw new Error(`No se pudo crear la ficha de prueba: ${ePac.message}`)
    patientId = pac!.id
    console.log(`Ficha de prueba creada: ${patientId!.slice(0, 8)}\n`)

    // ── 1. CREAR ─────────────────────────────────────────────────────────
    console.log('1. CREAR la cita')
    const rCrear = await executeTool('create_appointment', {
      doctor_id: JORGE, patient_name: NOMBRE_PRUEBA, patient_phone: TEL_PRUEBA,
      starts_at: CITA_ORIGINAL, consultation_type_id: CT_SIN_REGLAS,
    }, ALGIA, clinic as never, doctor as never, null, patientId)
    chequear('create_appointment respondió success', rCrear.success === true,
      rCrear.success ? '' : `error=${(rCrear as { error?: string }).error}`)
    if (!rCrear.success) throw new Error('No se pudo crear la cita de prueba')

    const idOriginal = ((rCrear.data ?? {}) as { appointmentData?: { id: string } }).appointmentData!.id
    creadas.push(idOriginal)
    const { data: original } = await supa.from('appointments').select('*').eq('id', idOriginal).single()
    chequear('quedó confirmada', original!.status === 'confirmed', `status=${original!.status}`)
    // Comparar por INSTANTE, no por string: PostgREST devuelve "…+00:00" y el
    // literal es "…000Z". Es EXACTAMENTE el bug que documenta
    // slot-availability.ts —"nunca matcheaban"— y lo repetí en el test.
    chequear('a las 08:00 COT', mismoInstante(original!.starts_at, CITA_ORIGINAL),
      original!.starts_at)

    // ── 2. EL CUPO QUEDA OCUPADO ─────────────────────────────────────────
    console.log('\n2. El cupo original queda OCUPADO')
    const ocupado = await puedeEscribirseLaCita({
      clinic: clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
      doctorId: JORGE, startsAt: CITA_ORIGINAL, consultationTypeId: CT_SIN_REGLAS, now: new Date(),
    })
    chequear('otra paciente NO puede tomar ese cupo',
      !ocupado.ok && ocupado.outcome === 'slot_taken',
      ocupado.ok ? '(quedó libre, mal)' : `outcome=${ocupado.outcome}`)

    // ── 3. MOVER ─────────────────────────────────────────────────────────
    console.log('\n3. MOVER la cita a las 09:30')
    const rMover = await executeTool('reschedule_appointment', {
      appointment_id: idOriginal, new_starts_at: CITA_MOVIDA,
    }, ALGIA, clinic as never, doctor as never, null, patientId)
    chequear('reschedule_appointment respondió success', rMover.success === true,
      rMover.success ? '' : `error=${(rMover as { error?: string }).error}`)
    if (!rMover.success) throw new Error('No se pudo mover la cita')
    const idNueva = ((rMover.data ?? {}) as { new_appointment_id: string }).new_appointment_id
    creadas.push(idNueva)

    // ── 4. LA CITA VIEJA ─────────────────────────────────────────────────
    console.log('\n4. La cita VIEJA')
    const { data: vieja } = await supa.from('appointments').select('*').eq('id', idOriginal).single()
    chequear('quedó en cancelled, NO en rescheduled', vieja!.status === 'cancelled', `status=${vieja!.status}`)
    chequear('tiene cancelled_at', !!vieja!.cancelled_at)
    chequear('tiene el motivo escrito', !!vieja!.cancellation_reason)
    chequear('el motivo lleva el AÑO en las dos fechas',
      ((vieja!.cancellation_reason as string) ?? '').match(/\/20\d\d/g)?.length === 2)
    console.log(`     → "${vieja!.cancellation_reason}"`)
    chequear('la pantalla la muestra como "Reagendada"',
      etiquetaEstado(vieja!.status, vieja!.reason, vieja!.source, vieja!.cancellation_reason) === 'Reagendada')

    // ── 5. EL CUPO VIEJO QUEDA LIBRE ─────────────────────────────────────
    console.log('\n5. El cupo viejo (08:00) queda LIBRE  ← lo que se arregló')
    const liberado = await puedeEscribirseLaCita({
      clinic: clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
      doctorId: JORGE, startsAt: CITA_ORIGINAL, consultationTypeId: CT_SIN_REGLAS, now: new Date(),
    })
    chequear('otra paciente YA PUEDE tomar ese cupo', liberado.ok,
      liberado.ok ? '' : `sigue bloqueado: ${liberado.outcome}`)

    // ── 6. LA CITA NUEVA ─────────────────────────────────────────────────
    console.log('\n6. La cita NUEVA')
    const { data: nueva } = await supa.from('appointments').select('*').eq('id', idNueva).single()
    chequear('existe y está confirmada', nueva!.status === 'confirmed', `status=${nueva!.status}`)
    chequear('a las 09:30 COT', mismoInstante(nueva!.starts_at, CITA_MOVIDA), nueva!.starts_at)
    chequear('conserva al MISMO médico', nueva!.doctor_id === JORGE)
    chequear('conserva el tipo de consulta', nueva!.consultation_type_id === CT_SIN_REGLAS)
    chequear('su hora está DENTRO del horario del médico',
      !(await puedeEscribirseLaCita({
        clinic: clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
        doctorId: JORGE, startsAt: CITA_MOVIDA, consultationTypeId: CT_SIN_REGLAS,
        now: new Date(), excluirAppointmentId: idNueva,
      }).then((r) => !r.ok && r.outcome === 'out_of_schedule')))

  } finally {
    // ── LIMPIEZA — corre pase lo que pase ────────────────────────────────
    console.log('\n7. LIMPIEZA')
    for (const id of creadas) await supa.from('appointments').delete().eq('id', id).eq('clinic_id', ALGIA)
    if (patientId) await supa.from('patients').delete().eq('id', patientId).eq('clinic_id', ALGIA)
    const fin = await supa.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
    const finPac = await supa.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
    const quedan = await supa.from('patients').select('id').eq('clinic_id', ALGIA).eq('phone', TEL_PRUEBA)
    chequear(`citas de vuelta en ${base.count}`, fin.count === base.count, `ahora ${fin.count}`)
    chequear('la ficha de prueba ya no existe', (quedan.data ?? []).length === 0, `pacientes: ${finPac.count}`)
  }

  console.log(fallos === 0 ? '\n══ CADENA COMPLETA VERIFICADA ══\n' : `\n══ 🔴 ${fallos} fallo(s) ══\n`)
  process.exit(fallos === 0 ? 0 : 1)
}
main().catch((e) => { console.error('\n🔴', e.message); process.exit(1) })
