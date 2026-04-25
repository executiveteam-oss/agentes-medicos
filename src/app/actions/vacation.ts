'use server'

// ============================================================
// Server Actions — Planificación de vacaciones
// Analiza demanda histórica por semana ISO para sugerir
// las mejores semanas para tomar vacaciones.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import { getISOWeek, startOfISOWeek, endOfISOWeek, format, addDays } from 'date-fns'
import { es } from 'date-fns/locale'

// --- Types ---

export interface WeekDemand {
  week: number        // 1-53
  label: string       // "Ene 1" (mes + semana del mes)
  avgAppointments: number
  tier: 'low' | 'mid' | 'high'
  isCurrent: boolean
}

export interface VacationSuggestion {
  week: number
  avgAppointments: number
  rangeLabel: string  // "2 al 8 de enero"
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
}

export interface VacationData {
  weeks: WeekDemand[]
  suggestions: VacationSuggestion[]
  overallAvg: number
  totalWeeksAnalyzed: number
}

/**
 * Obtener datos de demanda por semana ISO (últimos 12 meses)
 * para planificación de vacaciones.
 */
export async function getVacationData(): Promise<VacationData> {
  const clinicId = await checkReadPermission('analytics')

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

  // Todas las citas de los últimos 12 meses (cualquier estado excepto cancelled)
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at')
    .eq('clinic_id', clinicId)
    .gte('starts_at', twelveMonthsAgo.toISOString())
    .in('status', ['confirmed', 'completed', 'no_show', 'rescheduled'])

  // Agrupar por semana ISO
  const weekCounts: Record<number, number[]> = {} // week -> [count_year1, count_year2, ...]

  // Para cada cita, calcular semana ISO y acumular
  // Usamos un mapa week+year para contar citas por semana por año
  const weekYearCounts: Record<string, number> = {}
  for (const apt of appointments ?? []) {
    const d = new Date(apt.starts_at)
    const week = getISOWeek(d)
    const year = d.getFullYear()
    const key = `${year}-${week}`
    weekYearCounts[key] = (weekYearCounts[key] ?? 0) + 1
  }

  // Agrupar: para cada semana ISO, recopilar conteos de cada año
  for (const [key, count] of Object.entries(weekYearCounts)) {
    const week = parseInt(key.split('-')[1])
    if (!weekCounts[week]) weekCounts[week] = []
    weekCounts[week].push(count)
  }

  // Calcular promedio por semana
  const weekAverages: { week: number; avg: number }[] = []
  for (let w = 1; w <= 53; w++) {
    const counts = weekCounts[w] ?? [0]
    const avg = Math.round(counts.reduce((s, c) => s + c, 0) / Math.max(counts.length, 1))
    weekAverages.push({ week: w, avg })
  }

  // Promedio general
  const allAvgs = weekAverages.map((w) => w.avg)
  const overallAvg = allAvgs.length > 0
    ? Math.round(allAvgs.reduce((s, a) => s + a, 0) / allAvgs.length)
    : 0

  // Semana actual
  const currentWeek = getISOWeek(new Date())

  // Nombre del mes para cada semana (basado en el lunes de esa semana en el año actual)
  const currentYear = new Date().getFullYear()
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

  function getWeekLabel(week: number): string {
    // Obtener fecha del lunes de esa semana
    const jan4 = new Date(currentYear, 0, 4) // Jan 4 siempre está en semana 1
    const start = startOfISOWeek(jan4)
    const monday = addDays(start, (week - 1) * 7)
    return monthNames[monday.getMonth()]
  }

  function getWeekRange(week: number): { start: Date; end: Date; label: string } {
    const jan4 = new Date(currentYear, 0, 4)
    const weekStart = startOfISOWeek(jan4)
    const monday = addDays(weekStart, (week - 1) * 7)
    const sunday = endOfISOWeek(monday)
    const label = `${format(monday, "d", { locale: es })} al ${format(sunday, "d 'de' MMMM", { locale: es })}`
    return {
      start: monday,
      end: sunday,
      label,
    }
  }

  // Clasificar tiers
  const weeks: WeekDemand[] = weekAverages.map(({ week, avg }) => ({
    week,
    label: getWeekLabel(week),
    avgAppointments: avg,
    tier: avg < overallAvg * 0.75 ? 'low'
      : avg > overallAvg * 1.25 ? 'high'
        : 'mid',
    isCurrent: week === currentWeek,
  }))

  // Top 3 semanas con menor demanda (excluyendo semana actual y semanas pasadas este año)
  const futureSuggestions = weekAverages
    .filter((w) => w.week > currentWeek || w.week < currentWeek - 4) // evitar semanas recientes
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)
    .map((w) => {
      const range = getWeekRange(w.week)
      return {
        week: w.week,
        avgAppointments: w.avg,
        rangeLabel: range.label,
        startDate: format(range.start, 'yyyy-MM-dd'),
        endDate: format(range.end, 'yyyy-MM-dd'),
      }
    })
    .sort((a, b) => a.week - b.week) // ordenar cronológicamente

  return {
    weeks,
    suggestions: futureSuggestions,
    overallAvg,
    totalWeeksAnalyzed: Object.keys(weekYearCounts).length,
  }
}

/**
 * Bloquear agenda de TODOS los doctores para un rango de fechas (vacaciones).
 * Cierra la agenda de cada doctor activo con motivo "Vacaciones" y fecha hasta.
 */
export async function blockVacationDates(
  startDate: string,  // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
): Promise<{ ok: boolean; error?: string; doctorCount?: number }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    // Obtener todos los doctores activos
    const { data: doctors, error: fetchError } = await supabaseAdmin
      .from('doctors')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)

    if (fetchError || !doctors?.length) {
      return { ok: false, error: 'No hay médicos activos para bloquear' }
    }

    // Cerrar agenda de cada doctor
    const { error: updateError } = await supabaseAdmin
      .from('doctors')
      .update({
        agenda_closed: true,
        agenda_closed_reason: 'Vacaciones',
        agenda_closed_until: endDate,
      })
      .eq('clinic_id', clinicId)
      .eq('is_active', true)

    if (updateError) return { ok: false, error: 'Error bloqueando agendas' }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'vacation_blocked',
      actor_type: 'staff',
      target_type: 'clinic',
      target_id: clinicId,
      details: {
        start_date: startDate,
        end_date: endDate,
        doctors_affected: doctors.map((d) => d.name),
      },
    })

    revalidatePath('/dashboard/whatsapp')
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/vacaciones')
    return { ok: true, doctorCount: doctors.length }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Guardar mensaje de vacaciones en whatsapp_config.
 */
export async function saveVacationMessage(
  message: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    // Leer config actual
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    const currentConfig = (clinic?.whatsapp_config ?? {}) as Record<string, unknown>

    // Actualizar con vacation_message
    const updatedConfig = {
      ...currentConfig,
      vacation_message: message.trim() || null,
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({ whatsapp_config: updatedConfig })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando mensaje' }

    revalidatePath('/dashboard/whatsapp')
    revalidatePath('/dashboard/vacaciones')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Obtener mensaje de vacaciones actual.
 */
export async function getVacationMessage(): Promise<string | null> {
  try {
    const clinicId = await checkReadPermission('analytics')

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    const config = clinic?.whatsapp_config as Record<string, unknown> | null
    return (config?.vacation_message as string) ?? null
  } catch {
    return null
  }
}
