// ============================================================
// Lista centralizada de EPS colombianas
// Usada en formularios de pacientes, citas, y filtros
// ============================================================

export const EPS_OPTIONS = [
  'Sura',
  'Compensar',
  'Nueva EPS',
  'Sanitas',
  'Salud Total',
  'Famisanar',
  'SOS',
  'Coosalud',
  'Medimás',
  'Mutual Ser',
  'Comfenalco',
  'Aliansalud',
  'Otra',
] as const

/** Para filtros que incluyen "todas" */
export const EPS_FILTER_OPTIONS = ['todas', ...EPS_OPTIONS.filter(e => e !== 'Otra'), 'Particular'] as const
