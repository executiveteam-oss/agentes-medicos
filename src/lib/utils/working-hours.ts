// ============================================================
// Helpers para working_hours (horarios de doctor/clínica)
//
// Soporta dos formatos:
// - Viejo: { monday: { start: "08:00", end: "17:00", active: true } }
// - Nuevo: { monday: { active: true, blocks: [{start, end}, ...] } }
//
// Toda lectura de working_hours debe pasar por `normalizeWorkingHours()`
// para obtener uniformemente el formato con `blocks[]`.
// ============================================================

import type {
  WorkingDay,
  WorkingHours,
  WorkingBlock,
  NormalizedWorkingDay,
  NormalizedWorkingHours,
} from '@/types/database'

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies ReadonlyArray<keyof WorkingHours>

/**
 * Normaliza un día. Si viene en formato viejo, lo convierte a `{active, blocks: [{start, end}]}`.
 * Si ya viene con `blocks`, los respeta.
 * Si no tiene ni blocks ni start/end válidos, retorna `{active: false, blocks: []}`.
 */
export function normalizeWorkingDay(day: WorkingDay | null | undefined): NormalizedWorkingDay {
  if (!day) return { active: false, blocks: [] }

  const active = day.active === true

  // Caso 1: ya tiene blocks (formato nuevo)
  if (Array.isArray(day.blocks)) {
    const blocks = day.blocks
      .filter((b): b is WorkingBlock => !!b && typeof b.start === 'string' && typeof b.end === 'string')
      .map((b) => ({ start: b.start, end: b.end }))
    return { active, blocks }
  }

  // Caso 2: formato viejo {start, end}
  if (typeof day.start === 'string' && typeof day.end === 'string') {
    return { active, blocks: [{ start: day.start, end: day.end }] }
  }

  // Caso 3: día sin info de horario
  return { active, blocks: [] }
}

/**
 * Normaliza el objeto completo de working_hours a `Record<dia, NormalizedWorkingDay>`.
 * Acepta el JSONB tal cual viene de Supabase (puede traer cualquiera de los dos formatos).
 */
export function normalizeWorkingHours(
  wh: WorkingHours | Record<string, unknown> | null | undefined
): NormalizedWorkingHours {
  const result = {} as NormalizedWorkingHours
  for (const key of DAY_KEYS) {
    const raw = (wh as Record<string, unknown> | null | undefined)?.[key] as WorkingDay | undefined
    result[key] = normalizeWorkingDay(raw)
  }
  return result
}

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Suma minutos de atención de un día (sumando todos los bloques).
 */
export function dayTotalMinutes(day: NormalizedWorkingDay): number {
  if (!day.active) return 0
  return day.blocks.reduce((sum, b) => sum + Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start)), 0)
}

/**
 * ¿Dos bloques se solapan? (mismo día)
 */
export function blocksOverlap(a: WorkingBlock, b: WorkingBlock): boolean {
  const aStart = timeToMinutes(a.start)
  const aEnd = timeToMinutes(a.end)
  const bStart = timeToMinutes(b.start)
  const bEnd = timeToMinutes(b.end)
  return aStart < bEnd && bStart < aEnd
}

/** Nombre del día en español, para los mensajes que lee una persona.
 *  El error decía "tuesday: Los bloques no pueden solaparse" — la clave interna
 *  cruda, en inglés, en la cara de la secretaria. */
export const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

/** ¿El bloque está completamente vacío? Es el que alguien agregó con "+" y
 *  todavía no llenó. No es un error: es un renglón en blanco. */
export function isBlockEmpty(b: WorkingBlock): boolean {
  return !b.start?.trim() && !b.end?.trim()
}

/**
 * Saca los bloques en blanco de un día.
 *
 * POR QUÉ EXISTE: un renglón vacío hacía fallar el guardado ENTERO del horario
 * —de todos los días, no solo del suyo— y dejaba a una secretaria sin poder
 * corregir un horario mal cargado. Un bloque que nadie llenó no es una decisión
 * que haya que respetar ni un error que haya que reportar: es ruido de la UI, y
 * se descarta antes de validar.
 *
 * Un bloque a MEDIO llenar (una sola de las dos horas) NO se descarta: ahí sí
 * hubo intención y hay que preguntar cuál era.
 */
export function stripEmptyBlocks(blocks: WorkingBlock[]): WorkingBlock[] {
  return blocks.filter((b) => !isBlockEmpty(b))
}

/**
 * Valida la lista de bloques de un día. Retorna mensaje de error o null.
 *
 * Los mensajes dicen QUÉ bloque y QUÉ hacer. El anterior ("Hora inválida",
 * "Los bloques no pueden solaparse") describía el estado sin decir cuál de los
 * tres renglones en pantalla era el culpable ni cómo salir del error.
 *
 * Asume que los bloques vacíos ya se sacaron con `stripEmptyBlocks`.
 */
export function validateBlocks(blocks: WorkingBlock[]): string | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const n = i + 1

    // Bloque a medio llenar: hubo intención, falta un dato.
    if (!b.start?.trim() || !b.end?.trim()) {
      const falta = !b.start?.trim() ? 'de inicio' : 'de fin'
      return `Al bloque ${n} le falta la hora ${falta}. Completala o borrá el bloque con la ✕.`
    }

    if (timeToMinutes(b.start) >= timeToMinutes(b.end)) {
      return `El bloque ${n} (${b.start}–${b.end}) termina antes de empezar. La hora de fin tiene que ser mayor que la de inicio.`
    }

    for (let j = i + 1; j < blocks.length; j++) {
      const otro = blocks[j]
      if (isBlockEmpty(otro) || !otro.start?.trim() || !otro.end?.trim()) continue
      if (blocksOverlap(b, otro)) {
        return `El bloque ${n} (${b.start}–${b.end}) se cruza con el bloque ${j + 1} (${otro.start}–${otro.end}). Ajustá las horas o borrá uno.`
      }
    }
  }
  return null
}

/** Minutos desde medianoche → "HH:MM". */
function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const BLOQUE_VACIO: WorkingBlock = { start: '', end: '' }

/**
 * Bloque a insertar cuando alguien toca "+ Agregar bloque".
 *
 * ANTES devolvía 08:00–17:00 SIEMPRE, incluso sobre un día que ya tenía
 * bloques. Sobre un martes 10:00–23:00 eso genera un solapamiento instantáneo:
 * la persona apretó "+" y el formulario quedó en estado inválido sin haber
 * escrito nada. Fue lo que dejó a la secretaria sin poder guardar.
 *
 * Ahora propone la hora siguiente al último bloque del día. Si no hay lugar
 * (el día ya llega hasta el final), devuelve un bloque VACÍO: mejor un renglón
 * en blanco para completar que uno prellenado que ya nace roto.
 */
export function defaultBlock(existentes: WorkingBlock[] = []): WorkingBlock {
  const validos = existentes.filter((b) => b.start?.trim() && b.end?.trim())
  if (validos.length === 0) return { start: '08:00', end: '17:00' }

  const finMax = Math.max(...validos.map((b) => timeToMinutes(b.end)))
  const DURACION = 60
  const FIN_DEL_DIA = 24 * 60
  if (finMax + DURACION > FIN_DEL_DIA) return { ...BLOQUE_VACIO }
  return { start: minutesToTime(finMax), end: minutesToTime(finMax + DURACION) }
}

export const WORKING_HOURS_DAY_KEYS = DAY_KEYS
