// ============================================================
// Lista centralizada de aseguradoras de salud en Colombia
//
// Distingue EPS (régimen contributivo Ley 100) de Medicina Prepagada
// (voluntaria). El agente usa esto para:
//   1. Mostrar opciones en formularios del dashboard
//   2. Disambiguar cuando el paciente menciona una marca con doble producto
//      (ej. "Sura" → puede ser Sura EPS o Sura Prepagada)
//   3. Resolver alias hablados ("colmedica" → "Colmédica")
//
// Histórico relevante (junio 2026):
//   - Coomeva EPS fue liquidada por Supersalud en 2022. Solo queda Coomeva Prepagada.
//   - Medimás EPS fue liquidada en 2019, sus afiliados migraron a Sanitas EPS.
//   - Allianz no opera EPS en Colombia; solo Prepagada, Pólizas, ARL, SOAT.
//
// Sub-fase A: solo lectura. Sub-fase B agregará UI para staff edit.
// ============================================================

import type { InsurerType } from '@/types/database'

export interface InsurerOption {
  /** Nombre canónico, mostrado en UI y guardado en DB */
  name: string
  /** Categoría: EPS, Prepagada, o 'ambigua' si la marca tiene ambos productos */
  type: InsurerType | 'ambigua'
  /** Si true, el agente debe preguntar EPS vs Prepagada cuando el paciente mencione esta marca */
  hasAmbiguity: boolean
  /** Variantes que el paciente puede mencionar (lowercase, sin tildes) */
  aliases: readonly string[]
  /** Nota interna para futuros mantenedores */
  notes?: string
  /** Migración 00072 — código EAPB para Res 256. Solo seteado en no-ambiguas. */
  eapb_code?: string
}

// ============================================================
// LISTA MAESTRA
// ============================================================
export const INSURER_OPTIONS: readonly InsurerOption[] = [
  // ---- AMBIGUAS (agente pregunta EPS o Prepagada) ----
  {
    name: 'Sura',
    type: 'ambigua',
    hasAmbiguity: true,
    aliases: ['sura', 'suramericana'],
    notes: 'Sura tiene EPS (Sura EPS) Y Prepagada (Sura Prepagada). Preguntar siempre.',
  },
  {
    name: 'Sanitas',
    type: 'ambigua',
    hasAmbiguity: true,
    aliases: ['sanitas', 'eps sanitas'],
    notes: 'Sanitas EPS (régimen contributivo) y Colsanitas (prepagada, marca distinta).',
  },

  // ---- SOLO PREPAGADA ----
  {
    name: 'Coomeva Prepagada',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['coomeva', 'coomeva prepagada', 'coomeva medicina prepagada'],
    notes: 'Coomeva EPS fue liquidada por Supersalud en enero 2022. Solo aplica la Prepagada.',
    eapb_code: 'PRE003',
  },
  {
    name: 'Colsanitas',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['colsanitas'],
    notes: 'Es la prepagada del grupo Sanitas. Marca distinta de Sanitas EPS.',
    eapb_code: 'PRE001',
  },
  {
    name: 'Colmédica',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['colmedica', 'colmédica'],
    eapb_code: 'PRE004',
  },
  {
    name: 'MediPlus',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['mediplus', 'medi plus'],
    eapb_code: 'PRE007',
  },
  {
    name: 'AXA Colpatria Prepagada',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['axa', 'axa colpatria', 'colpatria', 'axa prepagada'],
    eapb_code: 'PRE006',
  },
  {
    name: 'Allianz Salud',
    type: 'Prepagada',
    hasAmbiguity: false,
    aliases: ['allianz', 'allianz salud', 'allianz care', 'allianz gold', 'allianz seguros de vida'],
    notes: 'Allianz no tiene EPS en Colombia. Si paciente menciona accidente laboral → flujo ARL (payment_type existente).',
    eapb_code: 'PRE005',
  },

  // ---- SOLO EPS ----
  {
    name: 'Nueva EPS',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['nueva eps', 'nueva'],
    eapb_code: 'EPS037',
  },
  {
    name: 'Compensar',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['compensar'],
    eapb_code: 'EPS023',
  },
  {
    name: 'Salud Total',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['salud total'],
    eapb_code: 'EPS010',
  },
  {
    name: 'Famisanar',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['famisanar'],
    eapb_code: 'EPS017',
  },
  {
    name: 'SOS',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['sos', 'servicio occidental de salud'],
    eapb_code: 'EPS002',
  },
  {
    name: 'Coosalud',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['coosalud'],
    eapb_code: 'EPS012',
  },
  {
    name: 'Mutual Ser',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['mutual ser', 'mutualser'],
    eapb_code: 'EPS022',
  },
  {
    name: 'Comfenalco',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['comfenalco'],
    eapb_code: 'EPS013',
  },
  {
    name: 'Aliansalud',
    type: 'EPS',
    hasAmbiguity: false,
    aliases: ['aliansalud', 'alian salud'],
    eapb_code: 'EPS015',
  },
] as const

// ============================================================
// HELPERS PARA EL AGENTE Y FORMS
// ============================================================

/** Normaliza input del paciente: lowercase, sin tildes, sin doble espacio */
export function normalizeInsurerInput(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Busca una aseguradora por nombre/alias del paciente.
 * Retorna null si no hay match.
 */
export function findInsurer(raw: string): InsurerOption | null {
  const needle = normalizeInsurerInput(raw)
  if (!needle) return null

  // Match exacto en aliases (más rápido que substring)
  for (const opt of INSURER_OPTIONS) {
    if (opt.aliases.some((a) => normalizeInsurerInput(a) === needle)) return opt
  }

  // Match por substring (paciente puede haber dicho más palabras)
  for (const opt of INSURER_OPTIONS) {
    if (opt.aliases.some((a) => needle.includes(normalizeInsurerInput(a)))) return opt
  }

  return null
}

/** Lista de nombres canónicos por tipo, para forms y dropdowns */
export function getInsurerNamesByType(type: InsurerType): string[] {
  return INSURER_OPTIONS
    .filter((opt) => opt.type === type || opt.type === 'ambigua')
    .map((opt) => opt.name)
}

/** Todos los nombres canónicos (para el form actual que aún no distingue) */
export const ALL_INSURER_NAMES: readonly string[] = INSURER_OPTIONS.map((o) => o.name)
