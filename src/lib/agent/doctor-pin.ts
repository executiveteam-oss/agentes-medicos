// ============================================================
// EL MÉDICO QUE PIDIÓ LA PACIENTE NO ES TEXTO — ES UNA RESTRICCIÓN.
//
// El 2026-08-17 dos pacientes pidieron cita con el Dr. Jorge Darío y quedaron
// agendadas con el Dr. Juan Diego. No fue un error de nombre al final: el
// `doctor_id` equivocado entró en el PRIMER check_availability y nunca se
// corrigió. El mecanismo, en las dos:
//
//   La paciente pide un servicio ("control o seguimiento", "primera vez").
//   Ese servicio NO existe bajo el médico que pidió, pero SÍ bajo otro.
//   En el prompt los tipos de consulta cuelgan de cada médico, así que el
//   modelo encontró el servicio en el bloque de otro médico y se llevó su
//   `doctor_id` puesto.
//
// El executor ya validaba que `doctor_id` y `consultation_type_id` fueran
// coherentes ENTRE SÍ (executor.ts). No alcanzó: el modelo mandó los dos del
// médico equivocado, coherentes entre sí. Lo que faltaba era contrastarlos
// contra lo que pidió la paciente — un dato que solo vivía en el texto del chat.
//
// Este módulo lo saca del texto y lo convierte en dato. Funciones PURAS:
// se testean sin DB ni red (scripts/test-doctor-pin.ts).
// ============================================================

/** Lo mínimo que hace falta de un médico para resolver una mención. */
export interface DoctorParaPin {
  id: string
  name: string
}

export interface DoctorPin {
  doctor_id: string
  doctor_name: string
}

/** Sin tildes, en minúsculas, espacios colapsados y sin puntuación. Así
 *  "Dr. Jorge Darío López" y "jorge dario lopez" son la misma cadena. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Palabras que NO identifican a nadie: si un alias se reduce a esto, se tira.
const RUIDO = new Set([
  'dr', 'dra', 'doctor', 'doctora', 'de', 'del', 'la', 'el', 'los', 'las', 'y',
])

/**
 * Los alias con los que se puede nombrar a un médico.
 *
 * Para "JORGE DARIO LOPEZ ISANOA" salen: el nombre completo, "jorge dario",
 * "lopez isanoa", y cada palabra suelta ("jorge", "dario", "lopez", "isanoa").
 * Las palabras sueltas son las que más se usan en un chat real ("con isanoa",
 * "el doctor jorge") y también las que más colisionan — por eso el paso
 * siguiente descarta las ambiguas.
 */
function aliasesDe(nombre: string): string[] {
  const palabras = normalizar(nombre).split(' ').filter((p) => p && !RUIDO.has(p) && p.length > 2)
  if (palabras.length === 0) return []

  const out = new Set<string>()
  out.add(palabras.join(' '))
  if (palabras.length >= 2) {
    out.add(`${palabras[0]} ${palabras[1]}`)                                  // primer + segundo nombre
    out.add(`${palabras[palabras.length - 2]} ${palabras[palabras.length - 1]}`) // los dos apellidos
  }
  for (const p of palabras) out.add(p)
  return [...out]
}

/**
 * Construye el índice alias → médico para UNA clínica, DESCARTANDO todo alias
 * que apunte a más de un médico.
 *
 * Este descarte es la mitad del valor del módulo. En Algia conviven
 * "JUAN DIEGO VILLEGAS" y un doctor de pruebas "Juan Londoño": el alias "juan"
 * es de los dos y no identifica a ninguno. Lo mismo "lopez", que comparten
 * "JORGE DARIO LOPEZ ISANOA" y "JOSÉ DUVÁN LÓPEZ JARAMILLO"; y "daniela", que
 * comparten "DANIELA OSORIO" y "JAZMIN DANIELA GOMEZ".
 *
 * Ante ambigüedad NO se pinea. Un pin equivocado agenda con el médico
 * equivocado igual que hoy, pero además bloquea al correcto: sería peor que
 * no tener pin. Sin pin, el flujo queda como estaba y lo cubre el guard.
 */
export function construirIndice(doctors: DoctorParaPin[]): Map<string, DoctorParaPin> {
  const conteo = new Map<string, Set<string>>()
  const dueño = new Map<string, DoctorParaPin>()

  for (const d of doctors) {
    for (const alias of aliasesDe(d.name)) {
      if (!conteo.has(alias)) conteo.set(alias, new Set())
      conteo.get(alias)!.add(d.id)
      dueño.set(alias, d)
    }
  }

  const indice = new Map<string, DoctorParaPin>()
  for (const [alias, ids] of conteo) {
    if (ids.size === 1) indice.set(alias, dueño.get(alias)!)
  }
  return indice
}

/**
 * ¿La paciente nombró a un médico en este mensaje?
 *
 * Gana el alias MÁS LARGO que aparezca: si escribe "jorge dario lopez", el
 * match tiene que ser por la frase entera y no por una palabra suelta que
 * podría pertenecer a otro. Con dos médicos distintos nombrados en el mismo
 * mensaje devuelve null — "¿atiende Jorge o Juan Diego?" es una pregunta, no
 * una elección, y pinear ahí sería inventar una decisión que nadie tomó.
 */
export function detectarMencionDeMedico(
  texto: string,
  doctors: DoctorParaPin[],
  opciones?: { nombrePaciente?: string | null },
): DoctorPin | null {
  // Las palabras del nombre de la PACIENTE se sacan antes de matchear. Sin
  // esto, "Lina Marcela Gallego Londoño" (ella presentándose) matchea a la
  // Dra. LINA GRAJALES, y una paciente apellidada Villegas o Quintero pinearía
  // al médico equivocado con solo decir cómo se llama.
  const fuera = new Set(
    normalizar(opciones?.nombrePaciente ?? '').split(' ').filter(Boolean),
  )
  const limpio = normalizar(texto).split(' ').filter((p) => !fuera.has(p)).join(' ')

  const t = ` ${limpio} `
  if (t.trim() === '') return null

  const indice = construirIndice(doctors)
  const encontrados = new Map<string, { doc: DoctorParaPin; largo: number }>()

  for (const [alias, doc] of indice) {
    if (t.includes(` ${alias} `)) {
      const previo = encontrados.get(doc.id)
      if (!previo || alias.length > previo.largo) {
        encontrados.set(doc.id, { doc, largo: alias.length })
      }
    }
  }

  if (encontrados.size !== 1) return null   // 0 = nadie; 2+ = ambiguo, no se pinea
  const { doc } = [...encontrados.values()][0]
  return { doctor_id: doc.id, doctor_name: doc.name }
}

/** Lee el pin del `context` de la conversación. Tolera context nulo o viejo. */
export function leerPin(context: Record<string, unknown> | null | undefined): DoctorPin | null {
  const id = context?.pinned_doctor_id
  const name = context?.pinned_doctor_name
  if (typeof id !== 'string' || !id) return null
  return { doctor_id: id, doctor_name: typeof name === 'string' ? name : '' }
}

/** Arma el `context` con el pin puesto, PRESERVANDO lo que ya había —
 *  misma razón que escalationContext: pisar el objeto entero borra pendientes. */
export function contextConPin(
  prev: Record<string, unknown> | null | undefined,
  pin: DoctorPin,
): Record<string, unknown> {
  return {
    ...(prev ?? {}),
    pinned_doctor_id: pin.doctor_id,
    pinned_doctor_name: pin.doctor_name,
    pinned_doctor_at: new Date().toISOString(),
  }
}
