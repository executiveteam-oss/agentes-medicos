// ============================================================
// EL CONTRATO DE SALIDA DEL AGENTE — qué texto del loop LEE la paciente.
//
// 🚨 TODAVÍA NO ESTÁ CABLEADO. Este módulo existe para la prueba en sombra
//    (scripts/sombra-contrato-salida.ts). appointment-agent.ts sigue con el
//    join('\n\n') de siempre hasta que el diff se apruebe.
//
// EL PROBLEMA QUE RESUELVE
// El loop de tools acumula el texto de TODAS las vueltas y lo une con '\n\n'.
// No hay ninguna marca que separe "esto es para la paciente" de "esto es el
// modelo pensando en voz alta", así que cada narración interna sale por
// WhatsApp. La defensa de hoy —strip-internal-monologue— es una lista de
// patrones que crece con cada caso nuevo: vamos siempre un caso atrás.
//
// LA IDEA
// No hace falta que el modelo marque nada: la marca ya está en la ESTRUCTURA
// del loop. El modelo emite texto en dos posiciones distintas y significan
// cosas distintas:
//
//   · texto en una vuelta que TERMINA (end_turn) → ya no va a llamar más
//     tools, no le falta información: es su respuesta. Es para la paciente.
//   · texto en una vuelta que sigue con un tool_use → dijo algo y acto seguido
//     fue a buscar un dato. Es preámbulo. Salvo un caso, no es la respuesta.
//
// El caso que se salva es la escalación: el prompt le exige emitir el mensaje
// para la paciente ANTES de llamar escalate_to_human, y después de esa tool el
// turno se corta. Ese texto pre-tool es el único que la paciente va a recibir,
// así que manda sobre todo lo demás.
//
// De ahí las tres reglas de abajo, en orden. La ganancia no es sólo tirar
// narración: el mensaje pasa a tener UNA sola fuente, así que desaparece por
// construcción el bug de orden (el "✅ confirmada" que salía ANTES del
// "¿confirmas?" porque el orden era el del loop, no el de la conversación).
// ============================================================

/** Una vuelta del loop de tools, como la vio el agente. */
export interface VueltaDelLoop {
  /** Bloques `text` que el modelo emitió en esta vuelta (trimmeados, sin vacíos). */
  textos: string[]
  /** Cómo cerró la vuelta. 'otro' = stop_reason inesperado. */
  cierre: 'end_turn' | 'tool_use' | 'otro'
  /** Nombres de las tools que pidió en esta vuelta. */
  tools: string[]
}

export type OrigenDelTexto =
  | 'pre_escalada'         // regla 0 — lo que dijo justo antes de escalar
  | 'final'                // regla 1 — su respuesta al cerrar el turno
  | 'final_mas_pregunta'   // regla 1-bis — la respuesta + la pregunta que quedó colgada
  | 'previo_a_tool'  // regla 2 — no cerró; lo último que alcanzó a decir
  | 'fallback'       // regla 3 — no dijo nada utilizable

export interface SalidaDelAgente {
  text: string
  origen: OrigenDelTexto
  /** Los bloques que SÍ se envían. Se devuelven aparte del texto porque
   *  re-partir `text` por '\n\n' no los recupera: un bloque del modelo puede
   *  tener una línea en blanco adentro. */
  usados: string[]
  /** Bloques que el contrato dejó afuera. Si esto sube, el modelo narra de más. */
  descartados: number
  /** Los bloques descartados, para auditar. NO se envían. */
  descartadosTexto: string[]
}

/**
 * Arma el mensaje para la paciente a partir de las vueltas del loop.
 *
 * `fallback` es el mismo texto que hoy usa appointment-agent cuando no hay nada
 * que enviar — se recibe por parámetro para no duplicar la constante.
 */
/** ¿Este texto le pregunta algo a la paciente? */
const PREGUNTA = /[?¿]/

export function armarSalida(vueltas: VueltaDelLoop[], fallback: string): SalidaDelAgente {
  const todos = vueltas.flatMap((v) => v.textos)
  const total = todos.length

  const armar = (elegidos: string[], origen: OrigenDelTexto): SalidaDelAgente => {
    const text = elegidos.join('\n\n').trim()
    const usados = new Set(elegidos)
    const descartadosTexto = todos.filter((t) => !usados.has(t))
    return { text, origen, usados: elegidos, descartados: total - elegidos.length, descartadosTexto }
  }

  // REGLA 0 — escalación. El prompt le exige hablarle a la paciente ANTES de
  // llamar escalate_to_human, y el turno se corta ahí. Ese texto es el único
  // que ella va a leer: gana sobre cualquier cosa posterior (que además sería
  // el modelo repitiendo "un asesor te contactará", ya redundante).
  const vEsc = vueltas.find((v) => v.tools.includes('escalate_to_human'))
  if (vEsc && vEsc.textos.length > 0) return armar(vEsc.textos, 'pre_escalada')

  // REGLA 1 — el turno cerró y el modelo dijo algo. Esa es la respuesta.
  const vFinal = [...vueltas].reverse().find((v) => v.cierre !== 'tool_use' && v.textos.length > 0)
  if (vFinal) {
    // REGLA 1-bis — LA PREGUNTA QUE QUEDÓ COLGADA.
    // Sale de un caso real: el modelo preguntó "¿confirmas que eres X? Responde
    // sí o no", llamó una tool igual, y en el texto de cierre escribió "cuando
    // confirmes tu identidad te doy la información" — como si ya le hubieran
    // contestado. Con la regla 1 sola, la paciente recibe una respuesta que se
    // apoya en una pregunta que nunca le hicieron, y la conversación se traba.
    //
    // Por eso: si el texto de cierre NO le pregunta nada y algún bloque
    // descartado SÍ preguntaba, van los dos, en el orden del loop.
    //
    // Es una excepción que sólo puede AGREGAR texto, nunca quitarlo: su peor
    // caso es mandar un preámbulo de más, que es exactamente lo que se manda
    // hoy. No puede producir silencio ni perder contenido.
    if (!PREGUNTA.test(vFinal.textos.join(' '))) {
      const colgada = vueltas
        .filter((v) => v.cierre === 'tool_use')
        .flatMap((v) => v.textos)
        .filter((t) => PREGUNTA.test(t))
        .pop()
      if (colgada) return armar([colgada, ...vFinal.textos], 'final_mas_pregunta')
    }
    return armar(vFinal.textos, 'final')
  }

  // REGLA 2 — el turno NO cerró con texto (stop_reason raro, o cerró mudo) pero
  // el modelo alcanzó a decir algo antes de una tool. Mandamos lo ÚLTIMO que
  // dijo, no todo junto: los preámbulos viejos ya no describen dónde quedó.
  const vPrevia = [...vueltas].reverse().find((v) => v.textos.length > 0)
  if (vPrevia) return armar(vPrevia.textos, 'previo_a_tool')

  // REGLA 3 — no hay nada que mandar.
  return { text: fallback, origen: 'fallback', usados: [], descartados: 0, descartadosTexto: [] }
}
