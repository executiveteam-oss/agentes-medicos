// ============================================================
// EL HORARIO DE LA BANDEJA — ¿hay alguien del equipo leyendo el WhatsApp?
//
// Existe porque el 2026-08-22, un SÁBADO a las 08:21, una paciente pidió mover
// su cita del lunes y el agente le contestó "ya les avisé y te contactan
// pronto". No había nadie. "Pronto" era el lunes.
//
// Es OTRA pregunta que las dos que ya existían, y por eso es otro campo:
//   clinics.working_hours   → ¿el consultorio está abierto?      (texto al paciente)
//   doctors.working_hours   → ¿cuándo atiende ESTE médico?       (agenda real)
//   clinics.inbox_hours     → ¿cuándo me van a responder?        (esto)
//
// Funciones PURAS: reciben el "ahora" por parámetro. Se testean sin DB y sin
// esperar a que sea sábado.
// ============================================================

import { normalizeWorkingHours } from '@/lib/utils/working-hours'

/** Orden de la semana en el índice de Date.getDay() (0 = domingo). */
const CLAVES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export interface VentanaDeAtencion {
  /** ¿Hay alguien ahora mismo? */
  dentro: boolean
  /** Cuándo vuelve a haber alguien, en palabras: "hoy a las 8:00 AM",
   *  "mañana a las 8:00 AM", "el lunes a las 8:00 AM". null si nunca. */
  proxima: string | null
  /** El día y la hora crudos de la próxima apertura, para auditar. */
  proximaISO: string | null
}

/** "8:00 AM" desde "08:00" — 12h con AM/PM, como se lee en Colombia. */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h)) return hhmm
  const suf = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m ?? 0).padStart(2, '0')} ${suf}`
}

/** Minutos desde medianoche de una fecha, en Colombia. */
function minutosCOT(d: Date): number {
  const cot = new Date(d.getTime() - 5 * 3600_000)
  return cot.getUTCHours() * 60 + cot.getUTCMinutes()
}
function diaCOT(d: Date): number {
  return new Date(d.getTime() - 5 * 3600_000).getUTCDay()
}
const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

interface DiaBandeja { activo: boolean; desde: string; hasta: string }
function leerDias(inboxHours: unknown | null): DiaBandeja[] {
  const norm = normalizeWorkingHours((inboxHours ?? null) as Record<string, unknown> | null)
  return CLAVES.map((k) => {
    const d = norm[k]
    const b = d?.blocks?.[0]
    return { activo: Boolean(d?.active && b), desde: b?.start ?? '', hasta: b?.end ?? '' }
  })
}

/**
 * ¿Hay alguien atendiendo la bandeja en `ahora`, y si no, cuándo?
 *
 * Sin `inbox_hours` cargado devuelve `dentro: true`. Es el default SEGURO en la
 * dirección que importa: si no sabemos el horario, no le inventamos a la
 * paciente una espera que quizá no existe — se comporta como hoy.
 */
export function ventanaDeAtencion(inboxHours: unknown | null, ahora: Date): VentanaDeAtencion {
  const dias = leerDias(inboxHours)
  if (!dias.some((d) => d.activo)) return { dentro: true, proxima: null, proximaISO: null }

  const hoy = diaCOT(ahora)
  const min = minutosCOT(ahora)
  const d0 = dias[hoy]
  if (d0.activo && min >= aMinutos(d0.desde) && min < aMinutos(d0.hasta)) {
    return { dentro: true, proxima: null, proximaISO: null }
  }

  // Todavía no abrió HOY: la próxima es hoy mismo.
  if (d0.activo && min < aMinutos(d0.desde)) {
    return { dentro: false, proxima: `hoy a partir de las ${hora12(d0.desde)}`, proximaISO: `${NOMBRE_DIA[hoy]} ${d0.desde}` }
  }

  // Si no, el próximo día activo. Se buscan los 7 siguientes y se corta: sin
  // este límite, una clínica con todos los días apagados haría un bucle infinito
  // — y ese caso ya cortó arriba, pero el límite se queda igual.
  for (let salto = 1; salto <= 7; salto++) {
    const idx = (hoy + salto) % 7
    const d = dias[idx]
    if (!d.activo) continue
    const cuando = salto === 1 ? 'mañana' : `el ${NOMBRE_DIA[idx]}`
    return { dentro: false, proxima: `${cuando} a partir de las ${hora12(d.desde)}`, proximaISO: `${NOMBRE_DIA[idx]} ${d.desde}` }
  }
  return { dentro: false, proxima: null, proximaISO: null }
}

/**
 * La coletilla que va al final de un mensaje que promete contacto humano.
 *
 * Dentro de la ventana devuelve '' y el mensaje queda como hoy — no se toca lo
 * que ya funciona. Fuera, dice CUÁNDO va a pasar en vez de "pronto", que es la
 * palabra que un sábado a las 8 de la mañana significa "el lunes".
 */
export function coletillaDeContacto(inboxHours: unknown | null, ahora: Date): string {
  const v = ventanaDeAtencion(inboxHours, ahora)
  if (v.dentro || !v.proxima) return ''
  return ` El equipo responde ${v.proxima}, así que te escriben apenas abran 🙏`
}
