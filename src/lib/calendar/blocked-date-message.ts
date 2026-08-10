// ============================================================
// El mensaje de "ese día no se atiende", como función pura.
//
// Vivía embebido en `checkAvailability`, y esas dos ramas fueron dos de los
// tres lugares donde el nombre salía del médico equivocado. No se detectaron
// durante diez días por una razón concreta: para ejercitarlas hace falta un
// `blocked_dates` en la base, y Algia no tiene ninguno — así que ningún test
// contra datos reales pasa por ahí.
//
// Sacándolas a una función pura, el nombre que se le dice a la paciente se
// puede verificar sin base de datos y sin fabricar un bloqueo en producción.
// ============================================================

export interface FechaBloqueadaInput {
  /** Nombre del médico PEDIDO. Null → se usa un genérico, nunca otro nombre. */
  nombreMedico: string | null | undefined
  /** Un bloqueo del médico o de toda la clínica. */
  bloqueadoPor: 'doctor' | 'clinic'
  /** "lunes", "martes"… ya en español. */
  diaSemana: string
  /** Motivo configurado, si lo hay. */
  motivo?: string | null
}

/** Genérico cuando no se pudo resolver el médico. Nunca se cae al principal. */
const MEDICO_SIN_NOMBRE = 'El médico'

export function mensajeFechaBloqueada({
  nombreMedico,
  bloqueadoPor,
  diaSemana,
  motivo,
}: FechaBloqueadaInput): string {
  const porMotivo = motivo ? ` por: ${motivo}` : ''

  if (bloqueadoPor === 'clinic') {
    return `El consultorio no atiende ese día (${diaSemana})${porMotivo}. Ofrece otro día.`
  }

  const quien = (nombreMedico ?? '').trim() || MEDICO_SIN_NOMBRE
  const alternativa = motivo
    ? 'Ofrece otro día con este doctor o propón otro doctor de la misma especialidad.'
    : 'Ofrece otro día con este doctor o propón otro doctor.'

  return `${quien} no atiende ese día (${diaSemana})${porMotivo}. ${alternativa}`
}
