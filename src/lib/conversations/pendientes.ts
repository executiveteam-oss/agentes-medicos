// ============================================================
// PENDIENTES DE UNA CONVERSACIÓN — fuente única.
//
// Tres cosas distintas pueden dejar una conversación esperando algo, y las tres
// se comportan igual: mandan la conversación a la pestaña Atención, muestran un
// badge y corren un reloj desde que se generaron.
//
//   servicio ruleado    la Capa 0 marcó un servicio que revisa una persona
//   orden médica        la secretaria pidió la orden para radicar la cuenta
//   contacto general    la secretaria escribió y espera respuesta
//
// POR QUÉ ACÁ Y NO EN CADA LUGAR: los tres viven en `conversations.context`, los
// tres alimentan el mismo orden de cola (waitingMs) y los tres pintan badge. Si
// cada uno se lee por su cuenta, el día que se agregue el cuarto la cola va a
// ordenar mal en una pantalla y bien en otra. Ya nos pasó con el estado de la
// escalación: dos fuentes para la misma pregunta.
//
// El reloj de la cola es el MÁS VIEJO de los pendientes activos: lo que lleva
// más tiempo sin resolverse manda, sin importar de qué tipo sea.
// ============================================================

export type TipoPendiente = 'servicio' | 'orden_medica' | 'contacto'

export interface Pendiente {
  tipo: TipoPendiente
  /** ISO. Cuándo se generó — nunca se pisa al insistir. */
  desde: string
  /** Texto corto para el badge. */
  etiqueta: string
}

/** Nombre CORTO del servicio ruleado, para el badge. Keys del matcher. */
const NOMBRE_SERVICIO: Record<string, string> = {
  colposcopia: 'Colposcopia',
  vulvoscopia: 'Vulvoscopia',
  biopsia_histeroscopia: 'Histeroscopia/biopsia',
  mapeo: 'Mapeo',
  citologia: 'Citología',
  posquirurgico: 'Control posquirúrgico',
  diu: 'DIU',
  sedacion: 'Sedación',
}
export const nombreServicio = (k: string) => NOMBRE_SERVICIO[k] ?? k

/** Forma del `context` de conversations en lo que hace a pendientes. */
export interface ContextPendientes {
  servicios_marcados?: string[]
  servicios_marcados_at?: string | null
  /** Los servicios que una persona YA gestionó. Ver el bloque de abajo. */
  servicios_resueltos?: string[]
  servicios_resueltos_at?: string | null
  servicios_resueltos_por?: string | null
  orden_medica_pedida_at?: string | null
  contacto_enviado_at?: string | null
}

// ============================================================
// CERRAR UN SERVICIO MARCADO
//
// 🔴 POR QUÉ HIZO FALTA (2026-08-20)
// La Capa 0 marcaba servicios y NADIE los sacaba nunca: un solo escritor
// (webhook) que sólo agrega. Medido sobre Algia: 27 conversaciones con servicio
// marcado, CERO con cualquier señal de cierre — el campo no existía. Un servicio
// marcado el 12/08 seguía en la cola de Atención el año siguiente.
//
// El cierre se guarda como la LISTA de los resueltos, no como un booleano ni una
// fecha suelta. La diferencia importa: si mañana la Capa 0 marca un servicio
// NUEVO sobre una conversación ya gestionada, `servicios_marcados - resueltos`
// vuelve a dar no-vacío y el pendiente reaparece solo. Con un flag "ya está
// revisada" ese caso quedaría enterrado.
//
// Y al cerrar se limpia `servicios_marcados_at`, que es el reloj de la cola: el
// webhook lo fija con `?? new Date()` y nunca lo pisa, así que un servicio nuevo
// heredaría la antigüedad del anterior y la fila diría "esperando hace 9 días"
// recién marcada. Es el patrón 8 — el número que se muestra tiene que ser el que
// explica la posición.
// ============================================================

/** Los servicios marcados que TODAVÍA esperan a una persona. */
export function serviciosPendientes(ctx: ContextPendientes | null | undefined): string[] {
  const c = ctx ?? {}
  const marcados = Array.isArray(c.servicios_marcados) ? c.servicios_marcados : []
  const resueltos = new Set(Array.isArray(c.servicios_resueltos) ? c.servicios_resueltos : [])
  return marcados.filter((s) => !resueltos.has(s))
}

/**
 * Los pendientes ACTIVOS de una conversación, del más viejo al más nuevo.
 * Vacío = no hay nada esperando.
 */
export function pendientesDe(ctx: ContextPendientes | null | undefined): Pendiente[] {
  const c = ctx ?? {}
  const out: Pendiente[] = []

  // Sólo los que nadie gestionó todavía.
  const servicios = serviciosPendientes(c)
  if (servicios.length > 0 && c.servicios_marcados_at) {
    out.push({
      tipo: 'servicio',
      desde: c.servicios_marcados_at,
      etiqueta: `🚨 ${servicios.map(nombreServicio).join(' · ')}`,
    })
  }
  if (c.orden_medica_pedida_at) {
    out.push({ tipo: 'orden_medica', desde: c.orden_medica_pedida_at, etiqueta: '📄 Orden médica' })
  }
  if (c.contacto_enviado_at) {
    out.push({ tipo: 'contacto', desde: c.contacto_enviado_at, etiqueta: '💬 Contacto enviado' })
  }

  return out.sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime())
}

/**
 * Timestamp del pendiente MÁS VIEJO, o null si no hay ninguno.
 * Es el reloj con el que la cola de Atención ordena estas conversaciones.
 */
export function pendienteMasViejo(ctx: ContextPendientes | null | undefined): string | null {
  return pendientesDe(ctx)[0]?.desde ?? null
}

/** ¿Esta conversación tiene algo esperando? Decide la pestaña Atención. */
export function tienePendientes(ctx: ContextPendientes | null | undefined): boolean {
  return pendientesDe(ctx).length > 0
}
