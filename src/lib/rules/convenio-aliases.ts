// ============================================================
// CÓMO LA GENTE NOMBRA A SU ASEGURADORA vs. cómo quedó cargada.
//
// Algia tiene el convenio de SOS cargado con la razón social completa:
// "ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A". Ninguna
// paciente dice eso. Dicen "SOS", "EPS SOS", "SOS contributivo". Y como el
// matcher compara subcadenas, "sos" no aparece por ningún lado dentro de esa
// razón social: el convenio existe, está clasificado, y es inalcanzable.
// Son 1.653 citas históricas.
//
// POR QUÉ ALIAS Y NO RENOMBRAR LA FILA
// Renombrar `eps_name` a "SOS" habría funcionado con el matcher actual, y
// verificamos que NO rompe las reglas de autorización (referencian "SOS", el
// nombre corto) ni el reporte Res-256 (usa `appointments.eps_name`, otra
// columna). Pero el import de convenios de iSalud deduplica por
// (clinic_id, doctor_id, name, eps_name): con el nombre cambiado, la próxima
// importación no reconocería la fila y la volvería a crear con la razón social
// larga. Quedarían las dos, y el problema vuelve por la fila nueva.
//
// Un alias no toca el dato importado, así que sobrevive a la próxima corrida.
//
// ESTA TABLA ES NACIONAL, NO DE UNA CLÍNICA. "Servicio Occidental de Salud" es
// SOS en todo Colombia; no es una preferencia de Algia. Por eso vive en código
// y no en la config de la clínica.
// ============================================================

export interface ConvenioAlias {
  /** Nombre corto, el que la gente usa. Solo para leer. */
  marca: string
  /** Cómo puede escribirlo la paciente. Normalizado: minúsculas, sin tildes. */
  comoLoDice: string[]
  /** Fragmentos que aparecen en el `eps_name` cargado. Normalizados. */
  comoEstaCargado: string[]
}

export const CONVENIO_ALIASES: ConvenioAlias[] = [
  {
    marca: 'SOS',
    comoLoDice: ['sos', 'eps sos', 'sos eps', 'sos contributivo', 'sos subsidiado', 's o s', 'sos pac', 'sos plan excelencia'],
    comoEstaCargado: ['servicio occidental de salud', 'occidental de salud'],
  },
]

// ============================================================
// PARTICULAR NO ES UN CONVENIO QUE FALTE.
//
// Es la categoría más grande de la clínica: 12.795 citas históricas, más que
// cualquier aseguradora. Y el agente le pregunta a la paciente "¿vas por EPS,
// medicina prepagada o particular?", así que "particular" es una respuesta
// esperable — que el modelo después manda a verificar como si fuera una
// aseguradora, igual que hizo con "Medplus".
//
// Sin este corte, cada paciente particular escalaría por "convenio no
// reconocido": el caso MÁS COMÚN convertido en cola para el staff.
//
// La lista es CORTA a propósito. Marcar como particular a alguien que sí tiene
// convenio es el mismo error que negarle el convenio, solo que más silencioso:
// se va pagando de su bolsillo sin que nadie escale. Ante una respuesta
// ambigua ("no tengo EPS" — puede tener prepagada), NO se asume particular: se
// deja escalar, que es el lado seguro.
// ============================================================
const DICE_PARTICULAR = [
  'particular', 'pago particular', 'particular pago', 'voy particular',
  'soy particular', 'como particular', 'por particular', 'de particular',
  'privado', 'pago privado', 'consulta particular', 'particular privado',
]

/**
 * ¿La paciente dijo que paga ella, sin aseguradora?
 *
 * Exige que la frase SEA una de las formas conocidas, no que las contenga:
 * "particular" dentro de "no soy particular, tengo Sura" no puede activarlo.
 */
export function dijoParticular(texto: string | null | undefined): boolean {
  const n = normalizarConvenio(texto ?? '')
  if (!n) return false
  return DICE_PARTICULAR.includes(n)
}

/** Minúsculas, sin tildes, sin puntuación, espacios colapsados. */
export function normalizarConvenio(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ¿Lo que dijo la paciente y lo que está cargado son la misma aseguradora,
 * aunque no compartan ni una letra?
 *
 * Se exige que el dicho matchee un alias COMPLETO (o el alias contenga lo
 * dicho como palabra), no una subcadena suelta: "sos" no puede matchear dentro
 * de "colsanitas" ni de "asociacion".
 */
/**
 * ¿UN CONVENIO DICHO POR LA PACIENTE ES ESTE CONVENIO CARGADO?
 *
 * Fuente ÚNICA del criterio. La usan dos lugares que no pueden divergir:
 *   · el executor (check_eps_convenio) para contestarle a la paciente
 *   · la vista de salud de configuración, para decirle a la clínica qué
 *     convenios suyos el agente NO va a reconocer
 *
 * Si la vista reimplementara este matcheo, empezaría a mentir en cuanto alguien
 * toque el del agente — y mentiría del lado peor: marcando como rotos convenios
 * que funcionan, o dando por buenos los que no.
 *
 * El criterio es asimétrico a propósito (ver el comentario en checkEpsConvenio):
 * ante la duda se reconoce, porque decirle "no tenemos convenio" a alguien que
 * sí lo tiene la manda a colgar y no deja rastro.
 */
export function convenioCoincide(dicho: string, cargado: string): boolean {
  // 🔴 NORMALIZAR TILDES EN LA COMPARACIÓN DIRECTA (2026-08-21).
  //
  // Antes acá se comparaba con `.toLowerCase()` a secas, mientras que la tabla
  // de alias sí normalizaba tildes. Resultado: "Colmédica" bien escrito NO
  // matcheaba "COLMEDICA" cargado, y la paciente recibía "no tengo registrado
  // ese convenio" por una tilde. La misma pregunta tenía dos normalizaciones
  // distintas según por qué rama pasara.
  const d = normalizarConvenio(dicho ?? '')
  const c = normalizarConvenio(cargado ?? '')
  if (!d || !c) return false
  // Lo cargado contiene lo dicho: "colmedica" dentro de "colmedica medicina
  // prepagada sa".
  if (c.includes(d)) return true
  // Y al revés, con lo cargado pegado: cubre "S.O.S." cargado y "sos" dicho.
  if (d.includes(c.replace(/\s+/g, ''))) return true
  return mismoConvenioPorAlias(dicho, cargado)
}

export function mismoConvenioPorAlias(dicho: string, cargado: string): boolean {
  const d = normalizarConvenio(dicho)
  const c = normalizarConvenio(cargado)
  if (!d || !c) return false

  return CONVENIO_ALIASES.some((a) => {
    const loDijo = a.comoLoDice.some((x) => {
      const n = normalizarConvenio(x)
      // Igualdad, o el dicho contiene el alias como PALABRA completa.
      return d === n || new RegExp(`(^|\\s)${escapar(n)}($|\\s)`).test(d)
    })
    if (!loDijo) return false
    return a.comoEstaCargado.some((x) => c.includes(normalizarConvenio(x)))
  })
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
