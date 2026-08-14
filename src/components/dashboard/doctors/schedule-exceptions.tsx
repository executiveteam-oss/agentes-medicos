'use client'

// ============================================================
// "Este martes atiendo distinto" — excepciones de horario por fecha.
//
// Va debajo del horario base, en la misma pestaña, y usa EL MISMO editor de
// bloques: dos inputs de hora, la × para borrar, "+ Agregar bloque". La
// secretaria ya sabe usarlo; un editor nuevo sería otra cosa que aprender para
// hacer lo mismo.
//
// Lo que esta pantalla NO hace: cancelar ni mover citas. Si al cambiar el
// horario quedan citas afuera, se muestran con nombre y hora para que una
// persona decida. Una cita confirmada no se toca desde una pantalla de
// configuración.
// ============================================================

import { useState, useEffect, useTransition } from 'react'
import {
  getExcepciones, guardarExcepcion, borrarExcepcion,
  type ExcepcionHorario, type CitaFuera,
} from '@/app/actions/schedule-exceptions'
import { defaultBlock, validateBlocks, stripEmptyBlocks } from '@/lib/utils/working-hours'
import type { WorkingBlock } from '@/types/database'

/** 'YYYY-MM-DD' → "martes 18 de agosto". Se ancla al mediodía: una fecha sin
 *  hora se parsea como medianoche UTC y en Bogotá muestra el día anterior. */
function fechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota',
  })
}

const hoyCOT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

export function ScheduleExceptions({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const [lista, setLista] = useState<ExcepcionHorario[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [fecha, setFecha] = useState('')
  const [blocks, setBlocks] = useState<WorkingBlock[]>([defaultBlock()])
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [citasFuera, setCitasFuera] = useState<CitaFuera[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getExcepciones(doctorId).then((r) => { setLista(r); setCargando(false) })
  }, [doctorId])

  function limpiar() {
    setFecha(''); setBlocks([defaultBlock()]); setMotivo('')
    setError(null); setAbierto(false)
  }

  function editar(e: ExcepcionHorario) {
    setFecha(e.exception_date)
    setBlocks(e.blocks.length > 0 ? e.blocks : [defaultBlock()])
    setMotivo(e.reason ?? '')
    setError(null); setCitasFuera(null); setAbierto(true)
  }

  function guardar() {
    setError(null); setCitasFuera(null)
    if (!fecha) { setError('Elegí la fecha'); return }

    const limpios = stripEmptyBlocks(blocks)
    if (limpios.length === 0) {
      setError('Agregá al menos un bloque horario. Si ese día no se atiende, usá "Bloqueos" en vez de una excepción.')
      return
    }
    const err = validateBlocks(limpios)
    if (err) { setError(err); return }

    startTransition(async () => {
      const r = await guardarExcepcion({ doctorId, fecha, blocks: limpios, reason: motivo || null })
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar'); return }
      setLista(await getExcepciones(doctorId))
      // Las citas que quedaron fuera se muestran DESPUÉS de guardar: el horario
      // ya está bien, lo que falta es una decisión sobre esas pacientes.
      if (r.citasFuera && r.citasFuera.length > 0) setCitasFuera(r.citasFuera)
      limpiar()
    })
  }

  function borrar(id: string) {
    startTransition(async () => {
      const r = await borrarExcepcion(id)
      if (r.ok) setLista(await getExcepciones(doctorId))
      else setError(r.error ?? 'No se pudo borrar')
    })
  }

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-slate-900">Excepciones por fecha</h4>
        {!abierto && (
          <button type="button" onClick={() => { setAbierto(true); setCitasFuera(null) }}
            className="text-xs text-blue-700 hover:text-blue-800 font-medium">
            + Agregar excepción
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        Un horario distinto para un día puntual. Los demás días siguen con el horario de arriba.
        Si ese día no se atiende, usá <span className="font-medium">Bloqueos</span>.
      </p>

      {/* Lista */}
      {cargando ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : lista.length === 0 && !abierto ? (
        <p className="text-xs text-slate-400">Sin excepciones próximas.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {lista.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-900 capitalize">{fechaLarga(e.exception_date)}</p>
                <p className="text-[11px] text-slate-500">
                  {e.blocks.map((b) => `${b.start}–${b.end}`).join('  ·  ')}
                  {e.reason ? ` — ${e.reason}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => editar(e)}
                className="text-[11px] text-blue-700 hover:text-blue-800 font-medium">Editar</button>
              <button type="button" onClick={() => borrar(e.id)} disabled={isPending}
                className="text-slate-300 hover:text-red-500 text-base leading-none px-1"
                title="Eliminar excepción" aria-label="Eliminar excepción">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Alta / edición — mismo editor de bloques que el horario base */}
      {abierto && (
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 w-14 shrink-0">Fecha</label>
            <input type="date" value={fecha} min={hoyCOT()}
              onChange={(ev) => setFecha(ev.target.value)}
              className="input-field py-1 px-2 text-xs" />
          </div>

          <div className="flex items-start gap-2">
            <label className="text-xs text-slate-500 w-14 shrink-0 mt-1.5">Horario</label>
            <div className="flex-1 space-y-1.5">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={b.start}
                    onChange={(ev) => setBlocks(blocks.map((x, j) => j === i ? { ...x, start: ev.target.value } : x))}
                    className="input-field py-1 px-2 text-xs w-24" />
                  <span className="text-xs text-slate-400">a</span>
                  <input type="time" value={b.end}
                    onChange={(ev) => setBlocks(blocks.map((x, j) => j === i ? { ...x, end: ev.target.value } : x))}
                    className="input-field py-1 px-2 text-xs w-24" />
                  <button type="button"
                    onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
                    className="text-slate-300 hover:text-red-500 text-base leading-none px-1"
                    title="Eliminar bloque" aria-label="Eliminar bloque">×</button>
                </div>
              ))}
              {/* defaultBlock(blocks) propone la hora siguiente al último bloque:
                  apretar "+" no puede generar un solapamiento instantáneo. */}
              <button type="button" onClick={() => setBlocks([...blocks, defaultBlock(blocks)])}
                className="text-[11px] text-blue-700 hover:text-blue-800 font-medium">
                + Agregar bloque
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 w-14 shrink-0">Motivo</label>
            <input type="text" value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
              placeholder="Opcional (ej: congreso en la mañana)"
              className="input-field py-1 px-2 text-xs flex-1" />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={guardar} disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50">
              {isPending ? 'Guardando…' : 'Guardar excepción'}
            </button>
            <button type="button" onClick={limpiar}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
          </div>
        </div>
      )}

      {/* Citas que quedaron fuera. Se informan; no se tocan. */}
      {citasFuera && citasFuera.length > 0 && (
        <div className="mt-3 p-3 rounded-lg border border-amber-300 bg-amber-50">
          <p className="text-xs font-semibold text-amber-900 mb-1">
            Hay {citasFuera.length} {citasFuera.length === 1 ? 'cita' : 'citas'} fuera del horario nuevo
          </p>
          <p className="text-[11px] text-amber-800 mb-2">
            No se cancelaron ni se movieron. Decidí vos qué hacer con cada una — {doctorName} las tiene agendadas.
          </p>
          <div className="space-y-1">
            {citasFuera.map((c) => (
              <div key={c.id} className="text-[11px] text-amber-900 flex items-center gap-2">
                <span className="font-medium w-12 shrink-0">{c.hora}</span>
                <span className="flex-1 truncate">{c.paciente}</span>
                {c.servicio && <span className="text-amber-700 truncate max-w-[45%]">{c.servicio}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
