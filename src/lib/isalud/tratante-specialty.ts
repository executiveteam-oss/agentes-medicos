// ============================================================
// Tratante por (paciente, ESPECIALIDAD). Módulo PURO.
// - normalizeSpecialtyKey: MISMA función en escritura (derivación) y lectura
//   (resolución para el prompt) → un rename/acento no apaga la feature en silencio.
// - precedencia: el derive de iSalud NUNCA pisa una entrada 'paciente'/'secretaria'.
// - resolveActiveTratantes: descarta médicos inactivos/agenda cerrada (esperado) y
//   detecta DRIFT (clave guardada ≠ especialidad actual del médico) como miss visible.
// ============================================================
import { classifyServicio, type DerivRow } from './entidad-tratante-derivation'

export interface TratanteEntry {
  doctor_id: string
  source: 'isalud' | 'paciente' | 'secretaria'
  updated_at: string
}
export type TratantesMap = Record<string, TratanteEntry>

/** Clave de especialidad normalizada — usar SIEMPRE esta (escritura y lectura). */
export function normalizeSpecialtyKey(s: string | null | undefined): string {
  if (!s) return ''
  return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

function recencyKey(r: DerivRow): string {
  return `${r.fecha ?? '0000-00-00'} ${r.inicio ?? '00:00:00'} ${String(r.isalud_agenda_id).padStart(12, '0')}`
}

/**
 * Tratante por especialidad: la CONSULTA más reciente de médico ACTIVO, agrupada
 * por la especialidad del médico. resolveDoctor devuelve {id, specialty} del
 * médico activo o null. Todas las entradas quedan source='isalud'.
 */
export function deriveTratantesBySpecialty(
  rows: DerivRow[],
  resolveDoctor: (profesional: string) => { id: string; specialty: string | null } | null,
  nowIso: string,
  catalogConsultaServices?: Set<string>,
): TratantesMap {
  const sorted = [...rows].sort((a, b) => (recencyKey(a) < recencyKey(b) ? 1 : recencyKey(a) > recencyKey(b) ? -1 : 0))
  const out: TratantesMap = {}
  for (const r of sorted) {
    if (classifyServicio(r.servicio, r.procedimiento, catalogConsultaServices) !== 'consulta') continue
    if (!r.profesional) continue
    const doc = resolveDoctor(r.profesional)
    if (!doc) continue
    const key = normalizeSpecialtyKey(doc.specialty)
    if (!key || key in out) continue // sorted desc → la primera por especialidad es la más reciente
    out[key] = { doctor_id: doc.id, source: 'isalud', updated_at: nowIso }
  }
  return out
}

/** Mergea preservando lo humano: entradas 'paciente'/'secretaria' de `existing`
 *  NO se pisan; las 'isalud'/ausentes se toman de `derived`. */
export function mergeTratantesRespectingSource(existing: TratantesMap | null | undefined, derived: TratantesMap): TratantesMap {
  const merged: TratantesMap = { ...(existing ?? {}) }
  for (const [key, entry] of Object.entries(derived)) {
    const cur = merged[key]
    if (cur && (cur.source === 'paciente' || cur.source === 'secretaria')) continue // no pisar humano
    merged[key] = entry
  }
  return merged
}

export interface DoctorInfo { id: string; name: string; specialty: string | null; is_active: boolean; agenda_closed: boolean }
export interface ResolvedTratante { specialty: string; doctor_name: string; doctor_id: string }
export interface TratanteMiss { key: string; reason: 'doctor_no_existe' | 'key_drift'; doctor_specialty?: string }

/**
 * Lectura: resuelve a médicos ACTIVOS y agendables (label = especialidad actual
 * del médico, autoritativa). Inactivo/agenda cerrada → se descarta (esperado, no
 * es miss). DRIFT (la clave guardada ya no coincide con normalizeSpecialtyKey de
 * la especialidad actual del médico) → miss, para que un desajuste sea visible.
 */
export function resolveActiveTratantes(
  tratantes: TratantesMap | null | undefined,
  doctorsById: Map<string, DoctorInfo>,
): { active: ResolvedTratante[]; misses: TratanteMiss[] } {
  const active: ResolvedTratante[] = []
  const misses: TratanteMiss[] = []
  for (const [key, entry] of Object.entries(tratantes ?? {})) {
    const doc = doctorsById.get(entry.doctor_id)
    if (!doc) { misses.push({ key, reason: 'doctor_no_existe' }); continue }
    if (!doc.is_active || doc.agenda_closed) continue
    const expected = normalizeSpecialtyKey(doc.specialty)
    if (key !== expected) misses.push({ key, reason: 'key_drift', doctor_specialty: doc.specialty ?? '' })
    active.push({ specialty: doc.specialty ?? '', doctor_name: doc.name, doctor_id: entry.doctor_id })
  }
  return { active, misses }
}
