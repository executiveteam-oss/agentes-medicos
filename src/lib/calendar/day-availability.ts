// ============================================================
// ¿QUÉ PASA CON LA AGENDA DE ESTE MÉDICO ESE DÍA? — fuente única.
//
// Esta es LA respuesta a "¿a qué hora atiende y qué está bloqueado?", y la usan
// los dos lados: `check_availability` (lo que el agente le ofrece a la paciente)
// y la grilla del dashboard (lo que ve la secretaria).
//
// POR QUÉ UNA SOLA: en este repo ya hubo cinco bugs de dos caminos respondiendo
// distinto a la misma pregunta —el cupo libre, el estado de la escalación, los
// archivos sin revisar, el conteo de la tarjeta, el médico de la disponibilidad—.
// Si la agenda calculara su propio "acá atiende" copiando la query, el sexto
// estaría escrito: la secretaria vería verde donde el agente ve cerrado, y nadie
// se enteraría hasta que una paciente llegue a un consultorio vacío.
//
// ES PURA A PROPÓSITO: no toca la base. Recibe los datos ya traídos y decide.
// Así se testea sin DB, sin fabricar bloqueos en producción — que fue justo lo
// que dejó dos ramas de este mismo cálculo sin cubrir durante meses.
//
// LO QUE **NO** DECIDE ACÁ: si un SERVICIO concreto se puede hacer en ese hueco
// (consultation_type_schedules, reglas del catálogo). Verde significa "el médico
// atiende", no "esta cita se puede agendar". Es deliberado: mezclar las dos cosas
// haría que la grilla mienta en el caso más común para cubrir el más raro.
// ============================================================

import type { WorkingBlock } from '@/types/database'
import { normalizeWorkingHours } from '@/lib/utils/working-hours'

/** Los cuatro estados que la grilla tiene que poder distinguir. `ocupado` no
 *  sale de acá: lo pinta la tarjeta de la cita, que ya existe. */
export type EstadoFranja =
  | 'disponible'        // el médico atiende y no hay cita
  | 'fuera_de_horario'  // no atiende a esa hora ese día
  | 'bloqueado'         // alguien lo cerró a propósito

/** Por qué está cerrado. El motivo importa: "no atiende los lunes" y "cerramos
 *  ese viernes" son cosas distintas para quien agenda. */
export type TipoBloqueo =
  | 'clinica_no_operativa'
  | 'festivo'
  | 'fecha_bloqueada_medico'
  | 'fecha_bloqueada_clinica'
  | 'agenda_cerrada'
  | 'horario_manual'

export interface Bloqueo {
  tipo: TipoBloqueo
  /** Frase lista para mostrar en el tooltip. */
  motivo: string
}

/** Lo que hay que traer de la DB para poder decidir. El fetcher lo arma; esta
 *  capa no sabe de dónde salió. */
export interface DatosDelDia {
  fecha: string                    // YYYY-MM-DD
  diaSemana: string                // 'lunes' … 'domingo'
  indiceDiaSemana: number          // 0=domingo … 6=sábado
  medico: {
    nombre: string
    working_hours: unknown | null
    agenda_closed: boolean
    agenda_closed_reason: string | null
    agenda_closed_until: string | null
    schedule_type: string | null
    manual_availability_message: string | null
  } | null
  /** La fila de blocked_dates que aplica ese día, si hay. */
  fechaBloqueada: { doctor_id: string | null; reason: string | null } | null
  /** whatsapp_config.doctors[doctorId], si existe. */
  configWhatsApp: { days: number[]; start: string; end: string } | null
  /** clinic.working_hours, el último fallback. */
  horarioClinica: unknown | null
  /** Estado operativo de la clínica HOY. `null` = operando normal.
   *
   *  Es un hecho del día, no configuración: `working_hours` dice a qué hora
   *  abre CUANDO abre, no si hoy está abierta. Confundir las dos cosas hizo que
   *  el agente le afirmara a una paciente "Sí, Algia está abierta" en plena
   *  contingencia por sismo. */
  estadoClinica: { estado: 'contingencia' | 'cerrado'; mensaje: string | null } | null
  /** Festivo nacional de ese día, si lo hay. `null` = día hábil.
   *
   *  Un festivo NO es un bloqueo que cargó la clínica: es un hecho del
   *  calendario del país. Por eso viene por su propio canal y tiene su propio
   *  tipo — la secretaria necesita leer "Festivo — Asunción de la Virgen", no
   *  un genérico "cerrado" que la deje sin saber por qué.
   *
   *  El fetcher ya aplica la excepción por clínica: si la clínica atiende ESE
   *  festivo, acá llega null. */
  festivo: { nombre: string } | null
}

export interface DisponibilidadDelDia {
  fecha: string
  diaSemana: string
  /** Si el día entero está cerrado, acá está el porqué. `null` = no está cerrado. */
  bloqueo: Bloqueo | null
  /** Las franjas en que el médico atiende. Vacío = no atiende ese día. */
  franjas: WorkingBlock[]
  /** Atajo: hay al menos una franja y no hay bloqueo. */
  atiende: boolean
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
const CLAVES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export function nombreDiaSemana(indice: number): string {
  return DIAS[indice] ?? ''
}

/**
 * La decisión. Precedencia y cortes, en el orden en que importan.
 */
export function resolverDisponibilidadDia(d: DatosDelDia): DisponibilidadDelDia {
  const base = { fecha: d.fecha, diaSemana: d.diaSemana }

  // Sin médico no hay horario que mostrar. Pasa cuando el id no existe o no es
  // de esta clínica, y el default seguro es "no atiende": heredar el horario del
  // consultorio pintaría disponible la agenda de alguien que no está.
  if (!d.medico) return { ...base, bloqueo: null, franjas: [], atiende: false }

  // ── 1. Bloqueos que cierran el día ENTERO ──────────────────────────
  // Van primero porque ganan sobre cualquier horario: un médico puede tener
  // franja los viernes y aun así estar cerrado ESE viernes.

  // El estado operativo va PRIMERO de todo. Si la clínica no está operando, no
  // importa el horario, ni el festivo, ni la agenda del médico: no se atiende y
  // el agente no puede decir lo contrario.
  if (d.estadoClinica) {
    return {
      ...base, franjas: [], atiende: false,
      bloqueo: {
        tipo: 'clinica_no_operativa',
        motivo: d.estadoClinica.mensaje?.trim()
          || (d.estadoClinica.estado === 'contingencia'
                ? 'El consultorio no está atendiendo normalmente en este momento.'
                : 'El consultorio está cerrado.'),
      },
    }
  }

  // El festivo va ANTES que todo lo demás: no importa el horario del médico ni
  // que su agenda esté abierta — el país no trabaja. Y se nombra, porque
  // "Festivo — Asunción de la Virgen" le dice a quien agenda por qué no puede,
  // mientras que "cerrado" la deja preguntándose si es un error del sistema.
  if (d.festivo) {
    return {
      ...base, franjas: [], atiende: false,
      bloqueo: { tipo: 'festivo', motivo: `Festivo — ${d.festivo.nombre}.` },
    }
  }

  if (d.medico?.schedule_type === 'manual') {
    return {
      ...base, franjas: [], atiende: false,
      bloqueo: {
        tipo: 'horario_manual',
        motivo: d.medico.manual_availability_message?.trim()
          || `${d.medico.nombre} no tiene horario fijo — la agenda se coordina a mano.`,
      },
    }
  }

  if (d.medico?.agenda_closed) {
    const hasta = d.medico.agenda_closed_until ? ` hasta el ${formatoCorto(d.medico.agenda_closed_until)}` : ''
    const porque = d.medico.agenda_closed_reason ? ` (${d.medico.agenda_closed_reason})` : ''
    return {
      ...base, franjas: [], atiende: false,
      bloqueo: { tipo: 'agenda_cerrada', motivo: `Agenda de ${d.medico.nombre} cerrada${hasta}${porque}.` },
    }
  }

  if (d.fechaBloqueada) {
    const esDelMedico = d.fechaBloqueada.doctor_id !== null
    const porque = d.fechaBloqueada.reason ? `: ${d.fechaBloqueada.reason}` : ''
    return {
      ...base, franjas: [], atiende: false,
      bloqueo: {
        tipo: esDelMedico ? 'fecha_bloqueada_medico' : 'fecha_bloqueada_clinica',
        motivo: esDelMedico
          ? `${d.medico?.nombre ?? 'El médico'} no atiende el ${formatoCorto(d.fecha)}${porque}.`
          : `El consultorio no atiende el ${formatoCorto(d.fecha)}${porque}.`,
      },
    }
  }

  // ── 2. Las franjas del día ─────────────────────────────────────────
  // Precedencia: working_hours del médico > whatsapp_config > horario de la
  // clínica. Con una excepción que ya costó un bug:
  const clave = CLAVES[d.indiceDiaSemana]
  let franjas: WorkingBlock[] = []
  let activo = false
  // Un día que el médico marcó EXPLÍCITAMENTE inactivo significa "no atiende",
  // NO "usá el horario de la clínica". Sin esto, un médico que no trabaja los
  // miércoles aparecía disponible 08–18 con el horario del consultorio.
  let inactivoExplicito = false

  if (d.medico?.working_hours) {
    const norm = normalizeWorkingHours(d.medico.working_hours as Record<string, unknown>)[clave]
    const crudo = (d.medico.working_hours as Record<string, unknown>)?.[clave] as { active?: boolean } | undefined
    if (norm.active && norm.blocks.length > 0) {
      activo = true
      franjas = norm.blocks
    } else if (crudo?.active === false) {
      inactivoExplicito = true
    }
  }

  if (!activo && !inactivoExplicito && d.configWhatsApp?.days.includes(d.indiceDiaSemana)) {
    activo = true
    franjas = [{ start: d.configWhatsApp.start, end: d.configWhatsApp.end }]
  }

  if (!activo && !inactivoExplicito && d.horarioClinica) {
    const norm = normalizeWorkingHours(d.horarioClinica as Record<string, unknown>)[clave]
    if (norm.active && norm.blocks.length > 0) {
      activo = true
      franjas = norm.blocks
    }
  }

  return { ...base, bloqueo: null, franjas, atiende: activo && franjas.length > 0 }
}

/**
 * El estado de UNA hora concreta. Es lo que la grilla pinta celda por celda.
 * `hhmm` en formato 'HH:MM' de 24h.
 */
export function estadoDeFranja(disp: DisponibilidadDelDia, hhmm: string): EstadoFranja {
  if (disp.bloqueo) return 'bloqueado'
  const min = aMinutos(hhmm)
  if (min === null) return 'fuera_de_horario'
  const dentro = disp.franjas.some((f) => {
    const ini = aMinutos(f.start), fin = aMinutos(f.end)
    return ini !== null && fin !== null && min >= ini && min < fin
  })
  return dentro ? 'disponible' : 'fuera_de_horario'
}

/**
 * Lo que se le muestra a la secretaria si clickea una celda que no es verde.
 * Es el texto del modal de confirmación, así que dice el porqué concreto —
 * "no atiende los martes" y "cerramos el 14/08" llevan a decisiones distintas.
 */
export function motivoParaConfirmar(disp: DisponibilidadDelDia, nombreMedico: string): string {
  if (disp.bloqueo) return disp.bloqueo.motivo
  if (!disp.atiende) return `${nombreMedico} no atiende los ${disp.diaSemana}.`
  return `Ese horario está fuera de la franja de ${nombreMedico} (atiende ${disp.franjas.map((f) => `${f.start}–${f.end}`).join(', ')}).`
}

// ---- helpers ----

/** 'HH:MM' → minutos desde medianoche. null si no parsea. */
function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

/** 'YYYY-MM-DD' → 'DD/MM'. Sin date-fns: es puro y no vale traer TZ acá. */
function formatoCorto(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  return m ? `${m[3]}/${m[2]}` : fecha
}
