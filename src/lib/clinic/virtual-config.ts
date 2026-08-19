// ============================================================
// ¿Esta clínica puede atender por videollamada?
//
// Fuente ÚNICA de esa pregunta (patrón 2 del CLAUDE.md): la contestan el
// prompt (para saber si mencionar la modalidad) y el executor (para no dejar
// agendar algo que no se puede cumplir). Si divergen, el agente promete algo
// que el sistema después rechaza — o peor, acepta.
//
// 🔴 POR QUÉ EXISTE (2026-08-19)
// El prompt decía "el sistema enviará el link automáticamente antes de la
// cita". Ese mecanismo NO EXISTE en ninguna versión del código: no hay cron, ni
// job, ni nada que mande links de videollamada. Y el 18/08 el agente le
// prometió a una paciente el link 30 minutos antes de una terapia de piso
// pélvico, que además sólo se hace presencial.
//
// Al medirlo: 0 de 20 clínicas tienen virtual habilitado, 0 tienen base_url y
// hay 0 tipos de consulta virtuales en todo el sistema. La funcionalidad nunca
// se usó — pero el prompt la prometía igual.
// ============================================================

export interface VirtualConfig {
  enabled?: boolean | null
  base_url?: string | null
  platform?: string | null
  instructions?: string | null
}

/**
 * True sólo si la clínica puede REALMENTE sostener una cita virtual: el flag
 * prendido Y una URL base con la que armar el enlace.
 *
 * El flag solo no alcanza. Sin `base_url` no hay link que mandar, y una cita
 * virtual sin link es una paciente esperando frente a la pantalla.
 */
export function puedeAtenderVirtual(virtualConfig: unknown): boolean {
  const cfg = (virtualConfig ?? {}) as VirtualConfig
  if (cfg.enabled !== true) return false
  return typeof cfg.base_url === 'string' && cfg.base_url.trim().length > 0
}

/** Por qué no puede, para el mensaje de bloqueo y el audit. */
export function motivoSinVirtual(virtualConfig: unknown): string {
  const cfg = (virtualConfig ?? {}) as VirtualConfig
  if (cfg.enabled !== true) return 'la clínica no tiene la atención virtual habilitada'
  return 'la clínica no tiene configurada la plataforma de videollamada (falta base_url)'
}
