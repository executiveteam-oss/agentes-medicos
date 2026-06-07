// ============================================================
// Lookup de códigos EAPB para reporte Resolución 256.
// Source-of-truth: tabla eapb_codes en DB.
// En Fase 1 cargamos también un mirror INLINE para lookups sin DB
// (e.g. tests, validación pre-export en cliente).
// Sub-fase 2 va a leer SIEMPRE de DB.
// ============================================================

import type { InsurerOption } from './insurer-options'

/** Sentinel para pacientes particulares — Res 256 exige "NA" en CODIGO EAPB */
export const EAPB_CODE_PARTICULAR = 'NA'

interface EapbEntry {
  code: string
  name: string
  type: 'EPS' | 'Prepagada' | 'Plan Complementario'
  aliases: string[]
}

// Mirror del seed de la migración 00072. Mantener en sync con DB.
const EAPB_SEED: EapbEntry[] = [
  { code: 'EPS037', name: 'Nueva EPS', type: 'EPS', aliases: ['nueva eps', 'nueva'] },
  { code: 'EPS010', name: 'Salud Total', type: 'EPS', aliases: ['salud total'] },
  { code: 'EPS017', name: 'Famisanar', type: 'EPS', aliases: ['famisanar'] },
  { code: 'EPS023', name: 'Compensar', type: 'EPS', aliases: ['compensar'] },
  { code: 'EPS016', name: 'Coomeva EPS', type: 'EPS', aliases: ['coomeva eps'] },
  { code: 'EPS002', name: 'SOS', type: 'EPS', aliases: ['sos', 'servicio occidental de salud'] },
  { code: 'EPS018', name: 'Sanitas EPS', type: 'EPS', aliases: ['eps sanitas', 'sanitas eps'] },
  { code: 'EPS005', name: 'Sura EPS', type: 'EPS', aliases: ['sura eps', 'suramericana eps'] },
  { code: 'EPS012', name: 'Coosalud', type: 'EPS', aliases: ['coosalud'] },
  { code: 'EPS015', name: 'Aliansalud', type: 'EPS', aliases: ['aliansalud', 'alian salud'] },
  { code: 'EPS013', name: 'Comfenalco', type: 'EPS', aliases: ['comfenalco'] },
  { code: 'EPS022', name: 'Mutual Ser', type: 'EPS', aliases: ['mutual ser', 'mutualser'] },
  { code: 'PRE001', name: 'Colsanitas', type: 'Prepagada', aliases: ['colsanitas'] },
  { code: 'PRE002', name: 'Sura Prepagada', type: 'Prepagada', aliases: ['sura prepagada'] },
  { code: 'PRE003', name: 'Coomeva Prepagada', type: 'Prepagada', aliases: ['coomeva', 'coomeva prepagada', 'coomeva medicina prepagada'] },
  { code: 'PRE004', name: 'Colmédica', type: 'Prepagada', aliases: ['colmedica', 'colmédica'] },
  { code: 'PRE005', name: 'Allianz Salud', type: 'Prepagada', aliases: ['allianz', 'allianz salud', 'allianz care', 'allianz gold', 'allianz seguros de vida'] },
  { code: 'PRE006', name: 'AXA Colpatria Prepagada', type: 'Prepagada', aliases: ['axa', 'axa colpatria', 'colpatria'] },
  { code: 'PRE007', name: 'MediPlus', type: 'Prepagada', aliases: ['mediplus', 'medi plus'] },
]

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Lookup desde texto libre (patients.eps, appointments.eps_name).
 * Reglas:
 * - "Particular" / "PARTICULAR" / null vacío después de normalizar y == 'particular' → EAPB_CODE_PARTICULAR ('NA')
 * - Match exacto contra aliases > match substring > null si no encuentra
 * - Marcas ambiguas sin disambiguación (Sura, Sanitas) retornan null intencionalmente
 */
export function findEapbCodeByName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const n = normalize(raw)
  if (!n) return null
  if (n === 'particular') return EAPB_CODE_PARTICULAR

  // Marcas ambiguas sin tipo confirmado: rechazar
  if (n === 'sura' || n === 'sanitas') return null

  // Match exacto contra aliases
  for (const e of EAPB_SEED) {
    if (e.aliases.some(a => normalize(a) === n)) return e.code
  }

  // Match por substring (input contiene alias o alias contiene input)
  for (const e of EAPB_SEED) {
    if (e.aliases.some(a => n.includes(normalize(a)) || normalize(a).includes(n))) return e.code
  }

  return null
}

/**
 * Lookup desde un InsurerOption confirmado (que ya pasó disambiguación EPS vs Prepagada).
 * Para ambiguas (Sura/Sanitas) requiere insurer_type.
 */
export function getEapbCodeFromInsurerOption(
  opt: InsurerOption,
  insurerType: 'EPS' | 'Prepagada' | null
): string | null {
  if (opt.hasAmbiguity && insurerType === null) return null

  if (opt.name === 'Sura') return insurerType === 'EPS' ? 'EPS005' : 'PRE002'
  if (opt.name === 'Sanitas') return insurerType === 'EPS' ? 'EPS018' : 'PRE001'

  // No ambiguas: lookup directo por nombre canónico o por eapb_code en el option
  if (opt.eapb_code) return opt.eapb_code

  for (const e of EAPB_SEED) {
    if (normalize(e.name) === normalize(opt.name)) return e.code
  }
  return null
}

export function getAllEapbCodes(): readonly EapbEntry[] {
  return EAPB_SEED
}
