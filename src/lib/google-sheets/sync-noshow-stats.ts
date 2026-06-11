// ============================================================
// Sincroniza la pestaña "Estadísticas No-Show" del Google Sheet
// Sub-tabla 1: No-shows por día de la semana (lunes a domingo)
// Sub-tabla 2: No-shows por franja horaria (8-10, 10-12, etc.)
// ============================================================

import { getSheetsClient } from './client'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { toZonedTime } from 'date-fns-tz'
import { parseISO, getDay, getHours } from 'date-fns'

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const TIME_SLOTS = ['8:00 - 10:00', '10:00 - 12:00', '12:00 - 14:00', '14:00 - 16:00', '16:00 - 18:00']

export async function syncNoShowStatsTab(clinicId: string, sheetId: string): Promise<void> {
  const sheets = getSheetsClient()

  // Todas las citas con outcome registrado (facturado o inasistente — histórico)
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, attendance_outcome')
    .eq('clinic_id', clinicId)
    .in('attendance_outcome', ['facturado', 'inasistente'])

  if (!appointments) return

  // Contadores por día de la semana
  const byDay: Record<number, { total: number; noShows: number }> = {}
  for (let i = 0; i < 7; i++) byDay[i] = { total: 0, noShows: 0 }

  // Contadores por franja horaria
  const bySlot: Record<string, { total: number; noShows: number }> = {}
  for (const slot of TIME_SLOTS) bySlot[slot] = { total: 0, noShows: 0 }

  for (const apt of appointments) {
    const colombiaDate = toZonedTime(parseISO(apt.starts_at), 'America/Bogota')
    const dayIndex = getDay(colombiaDate)
    const hour = getHours(colombiaDate)

    // Por día
    byDay[dayIndex].total++
    if (apt.attendance_outcome === 'inasistente') byDay[dayIndex].noShows++

    // Por franja horaria
    let slotKey: string | null = null
    if (hour >= 8 && hour < 10) slotKey = '8:00 - 10:00'
    else if (hour >= 10 && hour < 12) slotKey = '10:00 - 12:00'
    else if (hour >= 12 && hour < 14) slotKey = '12:00 - 14:00'
    else if (hour >= 14 && hour < 16) slotKey = '14:00 - 16:00'
    else if (hour >= 16 && hour < 18) slotKey = '16:00 - 18:00'

    if (slotKey) {
      bySlot[slotKey].total++
      if (apt.attendance_outcome === 'inasistente') bySlot[slotKey].noShows++
    }
  }

  // Construir datos
  const values: (string | number)[][] = []

  // Sub-tabla 1: Por día de la semana
  values.push(['NO-SHOWS POR DÍA DE LA SEMANA'])
  values.push(['Día', 'Citas Totales', 'No-Shows', '% No-Show'])

  // Orden: lunes(1) a domingo(0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]
  for (const d of dayOrder) {
    const { total, noShows } = byDay[d]
    const rate = total > 0 ? `${Math.round((noShows / total) * 100)}%` : '0%'
    values.push([DAY_NAMES[d], total, noShows, rate])
  }

  // Espacio
  values.push([])
  values.push([])

  // Sub-tabla 2: Por franja horaria
  values.push(['NO-SHOWS POR FRANJA HORARIA'])
  values.push(['Franja Horaria', 'Citas Totales', 'No-Shows', '% No-Show'])

  for (const slot of TIME_SLOTS) {
    const { total, noShows } = bySlot[slot]
    const rate = total > 0 ? `${Math.round((noShows / total) * 100)}%` : '0%'
    values.push([slot, total, noShows, rate])
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "'Estadísticas No-Show'!A:Z",
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "'Estadísticas No-Show'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })
}
