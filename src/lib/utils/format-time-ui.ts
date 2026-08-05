// ============================================================
// Formateo de fecha/hora para la UI del dashboard — FUENTE ÚNICA.
//
// POR QUÉ EXISTE (bug de hidratación, agosto 2026):
// `format()` de date-fns formatea en la zona horaria del RUNTIME. El servidor
// de Vercel corre en UTC y el navegador de la secretaria en America/Bogota →
// el MISMO timestamp se renderiza distinto de los dos lados:
//
//     servidor (UTC)      → "2:30 AM" · "MIÉ 5 AGO"
//     navegador (Bogotá)  → "9:30 PM" · "MAR 4 AGO"
//
// Eso es un mismatch de hidratación (React #418). No se ve en desarrollo
// porque la Mac también está en America/Bogota: es un bug EXCLUSIVO de
// producción.
//
// REGLA: en la UI nunca se llama `format()` de date-fns sobre un timestamp
// que viene del servidor. Se usa esto, que fija la zona explícitamente y da
// el mismo string en cualquier runtime.
//
// Para textos relativos ("hace 3 horas"), que dependen del RELOJ y no de la
// zona, ver <RelativeTime> en src/components/ui/relative-time.tsx.
// ============================================================

import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'

/** Zona de la clínica. Colombia no tiene horario de verano (UTC-5 todo el año). */
export const UI_TIMEZONE = 'America/Bogota'

/** Formatea un timestamp con un patrón de date-fns, siempre en hora Colombia. */
export function formatUI(iso: string | Date, pattern: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return ''
  return formatInTimeZone(d, UI_TIMEZONE, pattern, { locale: es })
}

/** Solo la hora: "9:30 PM". */
export function formatTimeUI(iso: string | Date): string {
  return formatUI(iso, 'h:mm a')
}

/**
 * Clave de día calendario EN COLOMBIA ("2026-08-04"). Sirve para agrupar y
 * comparar días sin que la zona del runtime mueva el corte de medianoche.
 */
export function dayKeyUI(iso: string | Date): string {
  return formatUI(iso, 'yyyy-MM-dd')
}

/** ¿Dos timestamps caen en días distintos, en hora Colombia? */
export function isDifferentDayUI(current: string | Date, previous: string | Date): boolean {
  return dayKeyUI(current) !== dayKeyUI(previous)
}

/**
 * Separador de día para el hilo de mensajes: "HOY" / "AYER" / "MAR 4 AGO".
 *
 * `nowIso` se pasa explícito para que la decisión HOY/AYER sea determinista y
 * testeable. Cuando se omite usa el reloj real: eso es "now"-dependiente y solo
 * puede cambiar de valor al cruzar la medianoche, no por la zona del runtime.
 */
export function formatDaySeparatorUI(iso: string | Date, nowIso?: string | Date): string {
  const key = dayKeyUI(iso)
  const now = nowIso ?? new Date()
  const todayKey = dayKeyUI(now)
  if (key === todayKey) return 'HOY'

  // Ayer = el día calendario anterior AL DE COLOMBIA, no al del runtime.
  const [y, m, d] = todayKey.split('-').map(Number)
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1))
  const yesterdayKey = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`
  if (key === yesterdayKey) return 'AYER'

  return formatUI(iso, 'EEE d MMM').toUpperCase()
}
