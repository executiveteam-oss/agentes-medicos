// ============================================================
// ¿QUÉ CLÍNICAS PROCESA UN PROCESO AUTOMÁTICO?
//
// Una sola respuesta, para los 11 crons. Antes cada uno decidía por su cuenta:
// siete filtraban `subscription_status IN ('trial','active')` copiado a mano y
// cuatro no filtraban nada — así que "las clínicas que procesamos" tenía dos
// definiciones distintas según qué cron mirabas.
//
// 🚨 HOY EL FILTRO NO DESCARTA A NADIE, Y ESTÁ BIEN. Las 20 clínicas están en
// 'trial' (18) o 'active' (2), todas legítimamente. El filtro es el mecanismo,
// no la limpieza: el día que una clínica se vaya se le pone un estado fuera de
// esta lista y los 11 dejan de tocarla, sin buscar 11 lugares.
//
// Lo que NO hay que hacer es "verificar" esto viendo que el cron sale verde:
// con el filtro puesto y las 20 adentro, verde no prueba nada. Lo que prueba
// es el conteo — por eso `clinicasVivas` devuelve las filas y cada cron loguea
// cuántas procesó.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

/** Los estados en los que una clínica participa de los procesos automáticos. */
export const ESTADOS_VIVOS = ['trial', 'active'] as const

/**
 * Las clínicas que un cron debe procesar, con los campos que pida.
 * `id` siempre viene incluido: sin él no se puede filtrar nada aguas abajo.
 */
export async function clinicasVivas<T = { id: string }>(campos = 'id'): Promise<T[]> {
  const seleccion = campos.split(',').map((c) => c.trim()).includes('id') ? campos : `id, ${campos}`
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select(seleccion)
    .in('subscription_status', ESTADOS_VIVOS as unknown as string[])
  if (error) {
    console.error('[clinicasVivas] no se pudieron leer las clínicas:', error.message)
    // Devolver [] y no lanzar: un cron que no puede leer clínicas debe procesar
    // CERO, nunca "todas". El conteo en cero queda visible en el log.
    return []
  }
  return (data ?? []) as unknown as T[]
}
