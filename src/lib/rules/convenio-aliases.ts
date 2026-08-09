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
