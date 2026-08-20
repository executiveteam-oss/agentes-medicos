// ============================================================
// ESCALAR UNA CONVERSACIÓN — fuente única.
//
// 🔴 POR QUÉ EXISTE (2026-08-20)
// Había TRECE puntos de escalación en el webhook, cada uno con su propio
// `.update({ status: 'escalated' })` sin chequear el `{ error }`, seguido de una
// notificación sin try/catch. Si el UPDATE fallaba, el flujo seguía igual y la
// paciente recibía "ya le pedí al equipo que te contacte" sobre una conversación
// que quedaba en `active`: sin marca, fuera de toda bandeja, invisible.
//
// Medido: 5 pacientes recibieron esa promesa entre el 12 y el 13/08 y ninguna
// quedó escalada.
//
// LA REGLA (patrón 1): la promesa la emite el código DESPUÉS de que el hecho
// ocurrió. Si la escalación no se pudo escribir, la paciente no puede oír que
// una persona la va a contactar — porque no la va a contactar nadie.
//
// QUÉ CUENTA COMO FALLA
//   · UPDATE falla (tras un reintento) → la escalación NO existe. Falla.
//   · La notificación falla            → la escalación SÍ existe y la
//     conversación ya aparece en Atención por derivación (escalada sin
//     respuesta humana). Se audita, pero no es falla: el staff la ve igual.
//
// La distinción importa. Tratar el fallo de la alerta como fallo de escalación
// le daría a la paciente un mensaje de error sobre algo que sí funcionó.
// ============================================================
import { supabaseAdmin } from '@/lib/supabase/admin'
import { escalationContext, type EscalationReason } from '@/lib/conversations/escalation-reasons'
import { formatPhone } from '@/lib/utils/dates'

export interface ResultadoEscalacion {
  /** ¿Quedó escrita la escalación? Si es false, NO prometas una persona. */
  ok: boolean
  /** Sólo cuando ok=false. */
  error?: string
}

export interface ArgsEscalacion {
  conversationId: string
  clinicId: string
  motivo: EscalationReason
  /** Detalle libre que va al context (código del error, texto que lo disparó). */
  detalle?: string | null
  /** El context previo — se preserva, nunca se pisa. */
  contextPrevio: Record<string, unknown> | null | undefined
  /** La alerta al staff, que varía por camino. Se ejecuta ADENTRO del try. */
  notificar?: () => Promise<void>
}

/**
 * Marca la conversación como escalada y avisa al staff.
 *
 * Reintenta el UPDATE una vez. Si falla dos veces, deja `escalation_failed` en
 * audit_log con el conversation_id y el error, y devuelve ok:false para que el
 * caller le diga la verdad a la paciente.
 */
export async function escalarConversacion(args: ArgsEscalacion): Promise<ResultadoEscalacion> {
  const { conversationId, clinicId, motivo, detalle, contextPrevio, notificar } = args

  const payload = {
    status: 'escalated' as const,
    escalated_at: new Date().toISOString(),
    context: escalationContext(contextPrevio, motivo, detalle ?? null),
  }

  let ultimoError: string | null = null
  for (let intento = 1; intento <= 2; intento++) {
    // 🔴 EL `.select()` NO ES DECORATIVO.
    //
    // Un UPDATE que no matchea NINGUNA fila devuelve `error: null` en Supabase.
    // Sin pedir las filas de vuelta, "no se actualizó nada" y "se actualizó
    // bien" son indistinguibles — que es exactamente el caso más probable en
    // producción: la fila no existe, o el clinic_id no coincide. La primera
    // versión de esta función tenía ese agujero y lo encontró su propio test.
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update(payload)
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .select('id')

    if (!error && (data?.length ?? 0) > 0) { ultimoError = null; break }
    ultimoError = error?.message ?? 'el UPDATE no alcanzó ninguna fila'
    console.error(`[escalar] UPDATE falló (intento ${intento}/2) conv=${conversationId}: ${ultimoError}`)
  }

  if (ultimoError) {
    await registrarFallo(clinicId, conversationId, 'update', ultimoError, motivo)
    return { ok: false, error: ultimoError }
  }

  // La escalación YA está escrita. Lo que siga no puede desescalarla.
  if (notificar) {
    try {
      await notificar()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[escalar] notificación falló conv=${conversationId}: ${msg}`)
      await registrarFallo(clinicId, conversationId, 'notificacion', msg, motivo)
      // NO devuelve ok:false: la conversación ya está escalada y aparece en
      // Atención por derivación. La alerta es un extra, no la escalación.
    }
  }

  return { ok: true }
}

async function registrarFallo(
  clinicId: string,
  conversationId: string,
  fase: 'update' | 'notificacion',
  error: string,
  motivo: EscalationReason,
): Promise<void> {
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'escalation_failed',
      actor_type: 'system',
      target_type: 'conversation',
      target_id: conversationId,
      details: { fase, error: error.slice(0, 400), motivo_intentado: motivo },
    })
  } catch (e) {
    // Si ni el audit_log entra, sólo queda el console. No hay a dónde más ir.
    console.error(`[escalar] no se pudo auditar el fallo de conv=${conversationId}:`, e)
  }
}

/**
 * Lo que lee la paciente cuando la escalación NO se pudo escribir.
 *
 * Es el ÚNICO texto determinista que incluye el teléfono de la clínica. En
 * todos los demás caminos el agente no da número —se sacó del prompt a
 * propósito— porque hay alguien del otro lado que va a responder. Acá no lo hay:
 * la conversación no quedó en ninguna bandeja, así que mandarla a esperar sería
 * dejarla esperando a nadie.
 *
 * No dice "error del sistema": dice qué pasó y qué puede hacer.
 */
export function mensajeEscalacionFallida(clinicPhone: string | null | undefined): string {
  // Formato colombiano para mostrar: 3XX XXX XXXX, no el +57 pegado.
  const tel = clinicPhone?.trim() ? formatPhone(clinicPhone.trim()) : ''
  const base = 'Perdón, tuve un problema para pasar tu caso al equipo del consultorio 🙁'
  const salida = tel
    ? `Escríbeme de nuevo en un momento, o si prefieres puedes llamar al ${tel}.`
    : 'Escríbeme de nuevo en un momento y lo intento otra vez.'
  return `${base} ${salida}`
}
