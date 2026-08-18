// ============================================================
// "El executor valida fechas" — helpers PUROS del backstop de create/cancel/
// reschedule (camino del AGENTE). Dos ejes:
//   - ¿el inicio es FUTURO?                       → isFutureStart
//   - ¿la cita cabe COMPLETA en una franja?        → isRangeWithinSchedule
//
// NO hay fallback al horario de la clínica: un día explícitamente inactivo del
// médico = FUERA de horario. (El fallback a clínica de check_availability es
// otro tema, aparte.)
// ============================================================
import { parseISO, isValid } from 'date-fns'
import { normalizeWorkingHours } from '@/lib/utils/working-hours'
import type { WorkingBlock } from '@/types/database'

export interface DaySchedule { active: boolean; blocks: WorkingBlock[] }

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type DayKey = (typeof DAY_KEYS)[number]

/** Día de la semana (0=domingo..6=sábado, como Date.getDay()) → clave del working_hours. */
export function dayKeyFromIndex(dayIndex: number): DayKey {
  return DAY_KEYS[dayIndex] ?? 'sunday'
}

/** Bloques del día para un médico. Sin working_hours o día ausente → inactivo. */
export function getDoctorDaySchedule(workingHours: unknown | null, dayKey: string): DaySchedule {
  if (!workingHours) return { active: false, blocks: [] }
  const wh = normalizeWorkingHours(workingHours as Record<string, unknown>) as unknown as Record<string, { active?: boolean; blocks?: WorkingBlock[] } | undefined>
  const day = wh[dayKey]
  if (!day) return { active: false, blocks: [] }
  return { active: !!day.active, blocks: Array.isArray(day.blocks) ? day.blocks : [] }
}

function hhmmToMin(s: string): number {
  const parts = s.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * Une franjas contiguas o solapadas en bloques maximales. Contiguas = una
 * termina donde arranca la otra (11:45→13:15 NO, pero 12:00→12:00 SÍ). Así una
 * cita que cruza el borde entre dos franjas pegadas no se rechaza. Devuelve
 * intervalos [start,end] en minutos, ordenados.
 */
function mergedIntervals(blocks: WorkingBlock[]): Array<{ start: number; end: number }> {
  const iv = blocks
    .map((b) => ({ start: hhmmToMin(b.start), end: hhmmToMin(b.end) }))
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start)
  const out: Array<{ start: number; end: number }> = []
  for (const cur of iv) {
    const last = out[out.length - 1]
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/**
 * ¿La cita [startHHMM, endHHMM) cabe COMPLETA en una sola franja del día
 * (tras unir franjas contiguas)? Inicio y fin dentro del MISMO bloque. Fin del
 * bloque INCLUSIVO: la cita puede terminar exactamente al cierre de la franja.
 */
export function isRangeWithinSchedule(startHHMM: string, endHHMM: string, day: DaySchedule): boolean {
  if (!day.active || day.blocks.length === 0) return false
  const start = hhmmToMin(startHHMM)
  const end = hhmmToMin(endHHMM)
  if (end <= start) return false
  return mergedIntervals(day.blocks).some((b) => start >= b.start && end <= b.end)
}

/** ¿El instante de inicio (ISO 8601, como viene de la DB) es estrictamente
 *  futuro respecto a `now`? Fecha inválida → false (defensivo). */
export function isFutureStart(startsAtIso: string, now: Date): boolean {
  const d = parseISO(startsAtIso)
  if (!isValid(d)) return false
  return d.getTime() > now.getTime()
}


// ============================================================
// LOS DÍAS QUE EL MÉDICO SÍ ATIENDE
//
// El 2026-08-18 el agente le dijo a una paciente: "El Dr. Jorge Darío no
// atiende los jueves. Atiende lunes, martes, miércoles, viernes y sábado."
// Jorge atiende lunes, miércoles y viernes. Lo del jueves era correcto; el
// resto lo inventó — dio "todos menos el que preguntó y el domingo".
//
// No fue desobediencia del modelo: el system prompt le PEDÍA decir los días
// ("Atiende [días disponibles]") y NADIE se los daba. check_availability
// respondía sólo "no atiende ese día (jueves)", y el bloque de médicos del
// prompt inyecta el horario desde `whatsapp_config.doctors[id]`, que en Algia
// está vacío. Se le pidió afirmar algo que no tenía forma de saber.
//
// Esto lo devuelve desde `working_hours`, que es la fuente real — la misma que
// usa la grilla y el cálculo de franjas.
// ============================================================

const NOMBRE_DIA: Record<DayKey, string> = {
  sunday: 'domingo', monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles',
  thursday: 'jueves', friday: 'viernes', saturday: 'sábado',
}

/** Orden de lectura humano: lunes primero, domingo al final. */
const ORDEN_SEMANA: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export interface DiaAtendido { dia: string; desde: string; hasta: string }

/** Los días con `active: true` y al menos un bloque, con su rango horario. */
export function diasQueAtiende(workingHours: unknown | null): DiaAtendido[] {
  const out: DiaAtendido[] = []
  for (const key of ORDEN_SEMANA) {
    const d = getDoctorDaySchedule(workingHours, key)
    if (!d.active || d.blocks.length === 0) continue
    const desde = d.blocks.reduce((a, b) => (b.start < a ? b.start : a), d.blocks[0].start)
    const hasta = d.blocks.reduce((a, b) => (b.end > a ? b.end : a), d.blocks[0].end)
    out.push({ dia: NOMBRE_DIA[key], desde, hasta })
  }
  return out
}

/** Frase lista para que el modelo la lea, SIN que tenga que componerla:
 *  "lunes, miércoles y viernes de 07:30 a 11:00". Vacío si no atiende ninguno. */
export function fraseDiasQueAtiende(workingHours: unknown | null): string {
  const dias = diasQueAtiende(workingHours)
  if (dias.length === 0) return ''

  const nombres = dias.map((d) => d.dia)
  const lista = nombres.length === 1
    ? nombres[0]
    : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`

  // Si todos los días comparten el mismo rango, se dice una vez.
  const mismoRango = dias.every((d) => d.desde === dias[0].desde && d.hasta === dias[0].hasta)
  if (mismoRango) return `${lista} de ${dias[0].desde} a ${dias[0].hasta}`
  return dias.map((d) => `${d.dia} de ${d.desde} a ${d.hasta}`).join(', ')
}


/**
 * Las PRÓXIMAS fechas concretas en que el médico atiende.
 *
 * Existe por el mismo motivo que `diasQueAtiende`, una capa más abajo. Con los
 * días ya resueltos, el agente pasó a decir bien "lunes, miércoles y viernes"
 * — y acto seguido inventó las fechas: "lunes 19, miércoles 21 o viernes 22 de
 * agosto", cuando el 19 era miércoles, el 21 viernes y el 22 sábado. Los tres
 * mal. Volvió a componer un dato que nadie le había dado.
 *
 * Devuelve la fecha ya formateada para que el modelo la copie, no la arme.
 * Trabaja en COT: la fecha se construye a mediodía con offset explícito, si no
 * `new Date('YYYY-MM-DD')` cae en UTC y en Vercel corre el día.
 */
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export interface FechaAtendida { fecha: string; texto: string }

export function proximasFechasQueAtiende(
  workingHours: unknown | null,
  desdeISO: string,
  cantidad = 3,
): FechaAtendida[] {
  const activos = new Set(diasQueAtiende(workingHours).map((d) => d.dia))
  if (activos.size === 0) return []

  const out: FechaAtendida[] = []
  // Se empieza en el día SIGUIENTE al pedido: si preguntó por el jueves, no
  // tiene sentido devolverle el jueves.
  for (let i = 1; i <= 60 && out.length < cantidad; i++) {
    const base = new Date(`${desdeISO}T12:00:00-05:00`)
    if (Number.isNaN(base.getTime())) return []
    base.setDate(base.getDate() + i)

    const y = base.getFullYear()
    const m = base.getMonth()
    const d = base.getDate()
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const nombre = DAY_KEYS[new Date(`${iso}T12:00:00-05:00`).getDay()]
    const dia = ({ sunday: 'domingo', monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles',
      thursday: 'jueves', friday: 'viernes', saturday: 'sábado' } as Record<string, string>)[nombre]

    if (!activos.has(dia)) continue
    out.push({ fecha: iso, texto: `${dia} ${d} de ${NOMBRE_MES[m]}` })
  }
  return out
}
