// ============================================================
// De las citas de un día a las filas de la agenda impresa.
//
// Cada columna tiene FALLBACKS, no una sola fuente: el 29% de las citas de un
// día no tiene ficha vinculada, y el dato igual existe en el payload crudo que
// dejó el sync. Sin los fallbacks la hoja saldría con un tercio de los renglones
// en blanco.
//
// Medido sobre las 31 citas del 20/08/2026: con estos fallbacks quedan vacías
// 0 columnas salvo PRODUCTO, donde 7 citas no tienen el dato EN NINGUNA de las
// tres fuentes — iSalud las exportó sin procedimiento. Esas van con guion.
// ============================================================

import { parseAseguradora } from '@/lib/isalud/consulta-convenio-derivation'
import { formatInTimeZone } from 'date-fns-tz'
import type { FilaAgenda } from './build-pdf'
import { SIN_DATO } from './build-pdf'

/** Lo que hay que traer de la DB. El caller hace la query. */
export interface CitaParaAgenda {
  starts_at: string
  reason: string | null
  eps_name: string | null
  payment_type: string | null
  external_service_name: string | null
  external_data: Record<string, unknown> | null
  doctor: { name: string; specialty: string | null } | null
  patient: { name: string; document_type: string | null; document_number: string | null } | null
  consultation_type: { name: string } | null
}

function limpio(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** El primero de la lista que tenga algo de verdad. '' cuenta como vacío. */
function primero(...valores: unknown[]): string {
  for (const v of valores) {
    const t = limpio(v)
    if (t) return t
  }
  return SIN_DATO
}

export function armarFilasAgenda(citas: CitaParaAgenda[]): FilaAgenda[] {
  return citas.map((c) => {
    const ext = c.external_data ?? {}

    // iSalud manda la identificación en un solo campo: "CC 1053813866".
    const identificacion = limpio(ext['identificacion']) ?? ''
    const [tipoDeIdent, ...restoIdent] = identificacion.split(/\s+/)

    // El campo `aseguradora` del scrape trae TRES datos pegados sin separador:
    // "PARTICULARRégimen: ParticularTipo afiliado: Cotizante". parseAseguradora
    // ya existe para esto (patrón 2: no se duplica la pregunta) y corta en
    // "Régimen:". Ojo: esto limpia la PRESENTACIÓN, no el dato guardado.
    const aseguradoraCruda = limpio(ext['aseguradora'])
    const aseguradora = aseguradoraCruda ? parseAseguradora(aseguradoraCruda) : null

    return {
      horaInicia: formatInTimeZone(new Date(c.starts_at), 'America/Bogota', 'h:mm a'),
      fecha: formatInTimeZone(new Date(c.starts_at), 'America/Bogota', 'dd/MM/yyyy'),
      profesional: primero(c.doctor?.name, ext['profesional_nombre']),
      especialidad: primero(c.doctor?.specialty),
      aseguradora: primero(c.eps_name, aseguradora, aseguradoraCruda, c.payment_type),
      tipoId: primero(c.patient?.document_type, tipoDeIdent),
      nroId: primero(c.patient?.document_number, restoIdent.join(' ')),
      // `reason` va último: cuando la cita no tiene ficha, el sync guarda ahí el
      // NOMBRE de la paciente — es el único lugar donde queda.
      nombre: primero(c.patient?.name, ext['nombre_paciente'], c.reason),
      producto: primero(c.consultation_type?.name, c.external_service_name, ext['procedimiento']),
    }
  })
}
