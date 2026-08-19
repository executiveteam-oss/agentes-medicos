/**
 * ¿La paciente está respondiendo a un recordatorio de cita?
 *
 * Fuente ÚNICA de esa pregunta (patrón 2 del CLAUDE.md). Vive acá y no dentro
 * del webhook para que se pueda ejercitar con un script, sin montar una
 * conversación de WhatsApp entera.
 *
 * 🔴 EL BUG QUE ORIGINÓ ESTE ARCHIVO (2026-08-18)
 * La búsqueda exigía `reminder_24h_sent = true`. Cuando se prendió la ventana
 * de 72h, toda paciente que tocaba "Confirmar"/"Cancelar" en ESE recordatorio
 * caía fuera del filtro: la función devolvía "no hay nada pendiente", el botón
 * seguía de largo como texto libre y terminaba en el aviso de privacidad. Cinco
 * pacientes en un día — una de ellas cancelando una cita que quedó activa.
 *
 * La lección es la de siempre: el filtro nombraba UNA ventana en vez de nombrar
 * la pregunta. Si mañana se agrega una ventana nueva, se agrega a VENTANAS_
 * RECORDATORIO y esto la hereda solo.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

/** Columnas que marcan "a esta cita ya le salió un recordatorio". */
export const VENTANAS_RECORDATORIO = [
  'reminder_72h_sent',
  'reminder_24h_sent',
  'reminder_2h_sent',
] as const

/**
 * Estados de cita que todavía admiten confirmar / cancelar / reagendar.
 *
 * 🔴 `blocked_external` VA EN LA LISTA, y su ausencia costó el segundo caso de
 * este mismo bug (2026-08-19). El cron manda recordatorios a los TRES estados
 * —lo arreglamos en 84b5845— y esta búsqueda miraba sólo dos: le mandábamos el
 * botón a una cita que después no podíamos encontrar. Una paciente tocó
 * "Cancelar" sobre su cita del día siguiente y el sistema no la halló.
 *
 * `blocked_external` NO es "un bloqueo de agenda": en Algia son 400 filas y las
 * 400 tienen paciente real. Es una cita que iSalud puso en un cupo ya ocupado y
 * el sync degradó para no perderla. Excluirla es excluir pacientes.
 *
 * Se exporta para que el cron use LA MISMA lista: la pregunta "¿a qué citas se
 * les escribe?" se responde en un solo lugar.
 */
export const ESTADOS_VIGENTES = ['confirmed', 'rescheduled', 'blocked_external'] as const

export type TipoDeRespuesta = 'confirmacion' | 'cancelacion' | 'reagendamiento' | null

/**
 * Clasifica el texto de la paciente. PURA: sin DB, sin red.
 *
 * Matchea la palabra sola ("Confirmar", "sí", "Cancelar") porque es lo que
 * manda Meta cuando toca un botón del template. Una frase larga que contenga
 * "cancelar" NO entra acá a propósito: esa la maneja el agente, que puede
 * preguntar cuál cita.
 */
export function detectarTipoDeRespuesta(texto: string): TipoDeRespuesta {
  const t = texto.toLowerCase().trim()
  if (/^(s[ií]|si|yes|confirmo|confirmar|dale|claro|ok|listo)$/i.test(t)) return 'confirmacion'
  if (/^(no|cancelar|cancelo|no puedo)$/i.test(t)) return 'cancelacion'
  if (/^(cambiar|reagendar|reprogramar|cambio|mover)$/i.test(t)) return 'reagendamiento'
  return null
}

export interface CitaConRecordatorioPendiente {
  id: string
  starts_at: string
  doctor_id: string | null
}

/**
 * La cita futura más próxima que YA recibió algún recordatorio y todavía no
 * tiene respuesta. Es la que la paciente está contestando.
 *
 * Devuelve null si no hay ninguna — ahí el mensaje sigue su camino normal.
 */
export async function buscarCitaConRecordatorioPendiente(
  patientId: string,
  clinicId: string,
): Promise<CitaConRecordatorioPendiente | null> {
  const algunRecordatorioEnviado = VENTANAS_RECORDATORIO
    .map((c) => `${c}.eq.true`)
    .join(',')

  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, doctor_id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .or(algunRecordatorioEnviado)
    .is('reminder_confirmed', null)
    .in('status', ESTADOS_VIGENTES as unknown as string[])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data as CitaConRecordatorioPendiente | null) ?? null
}
