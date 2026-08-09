// ============================================================
// QUÉ ARGUMENTOS RECIBIÓ CADA TOOL — para poder auditar después.
//
// `audit_log.message_processed` guardaba solo los NOMBRES de las tools. Cuando
// una paciente con 13 citas de MEDPLUS recibió "no tenemos convenio", saber que
// se llamó `check_eps_convenio` no alcanzaba: la causa era el argumento
// (`insurer_type: 'Prepagada'` contra un convenio cargado con tipo NULL), y hubo
// que DEDUCIRLO del texto de la respuesta. Una deducción no es una traza.
//
// PERO los argumentos traen datos sensibles. `create_appointment` recibe cédula
// y fecha de nacimiento; eso es dato de salud bajo la Ley 1581/2012, y el
// CLAUDE.md prohíbe loggear documentos y teléfonos completos. Guardar el input
// crudo cambiaría un problema de auditoría por uno de privacidad.
//
// La regla: se guarda el argumento salvo que su nombre esté en la lista de
// sensibles; ahí se guarda solo que VINO y su largo. Con eso se reconstruye
// "llamó la tool con estos parámetros" sin escribir la cédula de nadie.
//
// Lista de DENEGACIÓN, no de permiso: una tool nueva loguea sus argumentos
// nuevos sin que nadie tenga que acordarse de habilitarlos. El costo de
// equivocarse en esa dirección es un dato de más en el log, no un agujero de
// auditoría — y si el nombre huele a PII, la heurística lo tapa igual.
// ============================================================

/** Claves cuyo VALOR nunca se escribe. Se comparan en minúsculas. */
const CLAVES_SENSIBLES = new Set([
  'document_number', 'documento', 'numero_documento', 'cedula', 'cc', 'identificacion',
  'date_of_birth', 'fecha_nacimiento', 'birth_date', 'birthdate',
  'phone', 'telefono', 'celular', 'whatsapp_phone', 'patient_phone',
  'address', 'direccion',
  'email', 'correo',
  'patient_name', 'nombre_paciente', 'full_name', 'nombre_completo',
])

/** Subcadenas que delatan PII aunque la clave sea nueva. */
const FRAGMENTOS_SENSIBLES = ['document', 'cedula', 'birth', 'nacimiento', 'phone', 'telefon', 'celular', 'email', 'correo', 'direccion', 'address']

function esSensible(clave: string): boolean {
  const k = clave.toLowerCase()
  if (CLAVES_SENSIBLES.has(k)) return true
  return FRAGMENTOS_SENSIBLES.some((f) => k.includes(f))
}

/** Techo por valor: un motivo de escalación puede ser largo y no aporta entero. */
const MAX_LARGO = 120

function redactarValor(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length > MAX_LARGO ? `${v.slice(0, MAX_LARGO)}…[+${v.length - MAX_LARGO}]` : v
  if (Array.isArray(v)) return v.slice(0, 10).map(redactarValor)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = esSensible(k) ? marcaSensible(val) : redactarValor(val)
    }
    return out
  }
  return String(v)
}

/** Deja constancia de que el argumento VINO, sin escribir su contenido. */
function marcaSensible(v: unknown): string {
  if (v === null || v === undefined) return '[ausente]'
  const s = String(v)
  return s.trim() === '' ? '[vacío]' : `[oculto:${s.length}]`
}

export interface ToolCallAudit {
  tool: string
  input: Record<string, unknown>
}

/**
 * Versión auditable de los argumentos de una tool: todo lo no sensible tal cual,
 * lo sensible como `[oculto:N]`.
 */
export function auditableToolInput(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    out[k] = esSensible(k) ? marcaSensible(v) : redactarValor(v)
  }
  return out
}

/** Un registro por llamada, en el orden en que ocurrieron. */
export function auditableToolCall(tool: string, input: Record<string, unknown> | null | undefined): ToolCallAudit {
  return { tool, input: auditableToolInput(input) }
}
