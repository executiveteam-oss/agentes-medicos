// ============================================================
// EL SERVICIO DE UNA CITA IMPORTADA — qué le van a hacer a la paciente.
//
// Carolina (secretaria de Algia): "no aparece si es histero, mapeo, consulta o
// así… me toca basarme en iSalud". El panel de detalle decía "Sin especificar"
// aunque el dato venía en el payload del sync desde siempre: quedaba enterrado
// en `external_data.procedimiento` y nadie lo leía.
//
// DOS COSAS SEPARADAS, Y ACÁ NO SE MEZCLAN:
//
//   a) MOSTRAR el texto que manda iSalud. Sin riesgo: es lo que el HIS dice que
//      es la cita. Resuelve el problema de Carolina y punto.
//
//   b) Vincular con `consultation_type_id`. Esa fila del catálogo lleva PRECIO
//      y duración, así que solo se escribe cuando el match es INEQUÍVOCO.
//      Elegir una fila al azar entre varias no es "aproximar": es fabricarle un
//      precio a una paciente.
//
// El catálogo de Algia tiene 80 filas para 33 nombres distintos porque el
// convenio es dimensión de FILA — "consulta de primera vez" existe 19 veces,
// una por convenio, con 3 precios distintos. Por eso el match por nombre casi
// nunca alcanza solo.
// ============================================================

/** Minúsculas, sin tildes, espacios colapsados, sin puntuación de borde.
 *  iSalud manda "EcografÍa dinÁmica" con tildes raras y el catálogo "ECOGRAFIA
 *  DINAMICA": sin normalizar no matchea ni uno. */
export function normalizarServicio(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface FilaCatalogo {
  id: string
  name: string
  eps_name: string | null
  price: number | null
  is_active: boolean
  /** El catálogo es POR MÉDICO: la misma "TERAPIA DE PISO PELVICO" existe una
   *  vez por cada profesional que la hace, con precios distintos. Es la
   *  desambiguación más fuerte que hay, porque la cita siempre trae médico. */
  doctor_id: string | null
}

export type ResultadoMatch =
  | { tipo: 'inequivoco'; consultationTypeId: string }
  | { tipo: 'resuelto_por_medico'; consultationTypeId: string }
  | { tipo: 'resuelto_por_convenio'; consultationTypeId: string }
  | { tipo: 'ambiguo'; candidatos: number; motivo: string }
  | { tipo: 'sin_match' }

/**
 * ¿A qué fila del catálogo corresponde este procedimiento de iSalud?
 *
 * Devuelve un id SOLO cuando no hay duda. Ante cualquier ambigüedad devuelve
 * 'ambiguo' —y el llamador deja `consultation_type_id` en NULL pero muestra el
 * texto igual—, porque el texto sin fila es útil y una fila equivocada es peor
 * que ninguna.
 */
export function matchearServicio(
  procedimiento: string,
  catalogo: FilaCatalogo[],
  entidadPaciente?: string | null,
  doctorIdDeLaCita?: string | null,
): ResultadoMatch {
  const clave = normalizarServicio(procedimiento)
  if (!clave) return { tipo: 'sin_match' }

  let candidatos = catalogo.filter((c) => c.is_active && normalizarServicio(c.name) === clave)
  if (candidatos.length === 0) return { tipo: 'sin_match' }
  if (candidatos.length === 1) return { tipo: 'inequivoco', consultationTypeId: candidatos[0].id }

  // ── Desambiguación 1: EL MÉDICO ──────────────────────────────────
  // Va primero porque es la más fuerte y la que más resuelve: el catálogo tiene
  // una fila por profesional que hace el procedimiento, y la cita siempre trae
  // médico. "TERAPIA DE PISO PELVICO" existe dos veces —Lina a $60.000 y
  // Daniela sin precio—, así que sin esto elegir cualquiera fabrica un precio.
  if (doctorIdDeLaCita) {
    const delMedico = candidatos.filter((c) => c.doctor_id === doctorIdDeLaCita)
    if (delMedico.length === 1) return { tipo: 'resuelto_por_medico', consultationTypeId: delMedico[0].id }
    if (delMedico.length > 1) candidatos = delMedico   // sigue por convenio, ya acotado
  }

  // ── Desambiguación 2: el convenio ────────────────────────────────
  const ent = normalizarServicio(entidadPaciente)
  if (ent) {
    const porConvenio = candidatos.filter((c) => {
      const e = normalizarServicio(c.eps_name)
      if (!e) return false
      // Contención por ambos lados: el catálogo dice "MEDPLUS" y iSalud manda
      // "MEDPLUS MEDICINA PREPAGADA"; también al revés.
      return ent.includes(e) || e.includes(ent)
    })
    if (porConvenio.length === 1) {
      return { tipo: 'resuelto_por_convenio', consultationTypeId: porConvenio[0].id }
    }
    if (porConvenio.length > 1) {
      return {
        tipo: 'ambiguo', candidatos: porConvenio.length,
        motivo: `${porConvenio.length} filas del mismo convenio para "${procedimiento}"`,
      }
    }
  }

  // Sin entidad, o con una que no matchea ningún convenio del catálogo.
  //
  // Un caso merece atención: si TODAS las filas comparten precio y duración,
  // elegir cualquiera daría el mismo resultado visible. Aun así NO se elige —
  // la fila también determina qué reglas del catálogo aplican (autorización,
  // edad, condición), y esas sí difieren entre filas del mismo precio.
  return {
    tipo: 'ambiguo',
    candidatos: candidatos.length,
    motivo: ent
      ? `${candidatos.length} filas para "${procedimiento}" y la entidad "${entidadPaciente}" no coincide con ninguna`
      : `${candidatos.length} filas para "${procedimiento}" y la cita no trae entidad`,
  }
}

// ---- el campo `aseguradora` de iSalud ----

export interface EntidadParseada {
  entidad: string
  regimen: string | null
  tipoAfiliado: string | null
}

/**
 * iSalud manda los tres datos pegados sin separador:
 *
 *   "PARTICULARRégimen: ParticularTipo afiliado: Cotizante"
 *
 * y el panel los mostraba tal cual. Los marcadores son literales y constantes:
 * verificado sobre las 2.904 citas importadas, las 2.904 traen "Régimen:" y
 * "Tipo afiliado:". Por eso se puede separar sin adivinar.
 *
 * Si algún día llega algo que no sigue el patrón, se devuelve el texto entero
 * como entidad y los otros dos en null — nunca se corta a ciegas.
 */
export function parsearEntidadISalud(crudo: string | null | undefined): EntidadParseada | null {
  const s = (crudo ?? '').trim()
  if (!s) return null

  const iReg = s.indexOf('Régimen:')
  const iTipo = s.indexOf('Tipo afiliado:')

  if (iReg < 0) return { entidad: s, regimen: null, tipoAfiliado: null }

  const entidad = s.slice(0, iReg).trim()
  const regimen = iTipo > iReg
    ? s.slice(iReg + 'Régimen:'.length, iTipo).trim()
    : s.slice(iReg + 'Régimen:'.length).trim()
  const tipoAfiliado = iTipo >= 0 ? s.slice(iTipo + 'Tipo afiliado:'.length).trim() : null

  return {
    entidad: entidad || s,
    regimen: regimen || null,
    tipoAfiliado: tipoAfiliado || null,
  }
}

// ---- el campo `reason` ----

/**
 * ¿El "Motivo" es en realidad el nombre de la paciente?
 *
 * El import llena `reason` con el nombre cuando no tiene otra cosa
 * (sync-agent: `reasonText = patientName || 'Bloqueo iSalud'`), así que el panel
 * mostraba "Motivo: LUISA FERNANDA MONTOYA" — un dato que ya está arriba, en el
 * nombre de la paciente. Ocupa lugar y no dice nada.
 *
 * Se compara normalizado porque el nombre de la ficha y el de iSalud difieren en
 * espacios dobles y tildes.
 */
export function motivoEsElNombre(
  reason: string | null | undefined,
  nombrePaciente: string | null | undefined,
): boolean {
  const r = normalizarServicio(reason)
  const n = normalizarServicio(nombrePaciente)
  if (!r) return false
  if (!n) return r === 'bloqueo isalud'
  return r === n || r === 'bloqueo isalud'
}
