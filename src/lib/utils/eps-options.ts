// ============================================================
// COMPATIBILIDAD — Lista de EPS (mantenido para no romper imports)
//
// La fuente de verdad ahora es insurer-options.ts (migración 00071).
// Este archivo re-exporta nombres canónicos en formato array plano
// para los forms existentes (patient-form-modal, appointment-form-modal,
// patients-list-v2) hasta que se actualicen en Sub-fase B.
// ============================================================

import { INSURER_OPTIONS } from './insurer-options'

/** Nombres canónicos de TODAS las aseguradoras (EPS + Prepagada + ambiguas), + 'Otra'. */
export const EPS_OPTIONS = [
  ...INSURER_OPTIONS.map((o) => o.name),
  'Otra',
] as const

/** Para filtros que incluyen "todas" y "Particular" como pseudo-opciones */
export const EPS_FILTER_OPTIONS = [
  'todas',
  ...EPS_OPTIONS.filter((e) => e !== 'Otra'),
  'Particular',
] as const
