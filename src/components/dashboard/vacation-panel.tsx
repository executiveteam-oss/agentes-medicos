'use client'

// ============================================================
// VacationPanel — Panel interactivo de planificación de vacaciones
// Suggestions + block dates + vacation message
// ============================================================

import { useState, useTransition } from 'react'
import { blockVacationDates, saveVacationMessage } from '@/app/actions/vacation'
import type { VacationSuggestion } from '@/app/actions/vacation'
import { VacationDemandChart } from './vacation-chart'
import type { WeekDemand } from '@/app/actions/vacation'

interface Props {
  weeks: WeekDemand[]
  suggestions: VacationSuggestion[]
  overallAvg: number
  initialVacationMessage: string | null
}

export function VacationPanel({ weeks, suggestions, overallAvg, initialVacationMessage }: Props) {
  const [isPending, startTransition] = useTransition()
  const [blockedResult, setBlockedResult] = useState<{ startDate: string; endDate: string; doctorCount: number } | null>(null)
  const [blockError, setBlockError] = useState<string | null>(null)
  const [blockingWeek, setBlockingWeek] = useState<number | null>(null)

  // Vacation message state
  const [vacationMsg, setVacationMsg] = useState(
    initialVacationMessage ?? 'Estamos de vacaciones del [fecha] al [fecha]. Regresamos el [fecha] con toda la energía. ¿Te agendamos para cuando volvamos?'
  )
  const [msgSaved, setMsgSaved] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)

  function handleBlock(suggestion: VacationSuggestion) {
    setBlockError(null)
    setBlockedResult(null)
    setBlockingWeek(suggestion.week)
    startTransition(async () => {
      const result = await blockVacationDates(suggestion.startDate, suggestion.endDate)
      if (result.ok) {
        setBlockedResult({
          startDate: suggestion.startDate,
          endDate: suggestion.endDate,
          doctorCount: result.doctorCount ?? 0,
        })
      } else {
        setBlockError(result.error ?? 'Error bloqueando fechas')
      }
      setBlockingWeek(null)
    })
  }

  function handleSaveMessage() {
    setMsgSaved(false)
    setMsgError(null)
    startTransition(async () => {
      const result = await saveVacationMessage(vacationMsg)
      if (result.ok) {
        setMsgSaved(true)
      } else {
        setMsgError(result.error ?? 'Error guardando mensaje')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Chart */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Demanda por semana del año</h3>
        <p className="text-xs text-slate-400 mb-4">
          Últimos 12 meses · promedio: {overallAvg} citas/semana
        </p>
        <VacationDemandChart data={weeks} overallAvg={overallAvg} />
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-green-500" /> Baja demanda (ideal)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500" /> Demanda normal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-500" /> Alta demanda (evitar)
          </span>
        </div>
      </div>

      {/* Suggestions */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Semanas recomendadas para vacaciones</h3>
        <p className="text-xs text-slate-400 mb-4">
          Las 3 semanas con menor demanda histórica
        </p>

        {suggestions.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">Sin datos suficientes para sugerencias</p>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div
                key={s.week}
                className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-xl"
              >
                <div>
                  <p className="text-sm font-medium text-emerald-800">
                    Semana del {s.rangeLabel}
                  </p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Promedio: {s.avgAppointments} citas · Semana {s.week}
                  </p>
                </div>
                <button
                  onClick={() => handleBlock(s)}
                  disabled={isPending}
                  className="btn-v2-primary text-xs py-1.5 px-3 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {blockingWeek === s.week ? 'Bloqueando...' : 'Bloquear estas fechas'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Block result */}
        {blockedResult && (
          <div className="mt-4 p-4 bg-teal-50 border border-teal-200 rounded-xl">
            <p className="text-sm font-medium text-teal-800">
              Agenda bloqueada del {blockedResult.startDate} al {blockedResult.endDate}
            </p>
            <p className="text-xs text-teal-600 mt-0.5">
              {blockedResult.doctorCount} médico{blockedResult.doctorCount !== 1 ? 's' : ''} bloqueado{blockedResult.doctorCount !== 1 ? 's' : ''}. Los pacientes que intenten agendar recibirán el mensaje de vacaciones.
            </p>
          </div>
        )}
        {blockError && (
          <p className="mt-3 text-xs text-red-600">{blockError}</p>
        )}
      </div>

      {/* Vacation message */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Mensaje de vacaciones</h3>
        <p className="text-xs text-slate-400 mb-3">
          El agente usará este mensaje cuando la agenda esté cerrada por vacaciones
        </p>
        <textarea
          value={vacationMsg}
          onChange={(e) => { setVacationMsg(e.target.value); setMsgSaved(false) }}
          rows={4}
          className="input-v2 w-full resize-none"
          placeholder="Estamos de vacaciones del [fecha] al [fecha]..."
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleSaveMessage}
            disabled={isPending}
            className="btn-v2-primary text-xs py-1.5 px-4 disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Guardar mensaje'}
          </button>
          {msgSaved && <span className="text-xs text-emerald-600 font-medium">Guardado</span>}
          {msgError && <span className="text-xs text-red-600">{msgError}</span>}
        </div>
      </div>
    </div>
  )
}
