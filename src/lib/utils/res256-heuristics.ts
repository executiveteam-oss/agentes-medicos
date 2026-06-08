// src/lib/utils/res256-heuristics.ts
// ============================================================
// Heurística de sugerencia de categoría Res-256 por keyword en nombre.
//
// IMPORTANTE: esta función SOLO sugiere. NUNCA se persiste sin
// confirmación de staff. Los casos dudosos retornan null (mejor
// que sesgar a Lady con una clasificación equivocada).
// ============================================================

import type { Res256Category } from '@/types/database'

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function suggestRes256Category(name: string): Res256Category | null {
  const n = normalize(name)
  if (!n) return null

  // Ecografía gana sobre cualquier otra categoría
  if (/\becograf/.test(n)) return 'Ecografía'

  // Resonancia / RMN
  if (/resonancia|\brmn\b/.test(n)) return 'Resonancia Magnética'

  // Histeroscopia, colposcopia + procedimientos de utero → Ginecología
  // (Aunque colposcopia sola es ambigua, "X por histeroscopia" es claramente gineco)
  if (/histeroscop|ablacion endometr|biopsia.*endometr|liberacion.*uter/.test(n)) return 'Ginecología'

  // Ginecología explícita (consulta gineco, ginecologia y obstetricia)
  // Nota: "ginecologia y obstetricia" → Ginecología (consulta general gineco)
  // Atención parto / control prenatal específico → Obstetricia
  if (/atencion.*parto|control.*prenat|consulta.*prenat|atencion.*obstetric/.test(n)) return 'Obstetricia'

  if (/\bginecolog/.test(n)) return 'Ginecología'

  // Fisioterapia y paquetes → NoAplica explícito
  if (/fisioterap|terapia.*piso|paq.*terap|psicolog/.test(n)) return 'NoAplica'

  // Dudosos sin match → null
  return null
}
