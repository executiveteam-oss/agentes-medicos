// ============================================================
// Festivos colombianos 2026 y utilidades de días hábiles
// ============================================================

// Festivos 2026 en Colombia (ISO YYYY-MM-DD)
export const FESTIVOS_2026: string[] = [
  '2026-01-01', // Año Nuevo
  '2026-01-12', // Reyes Magos (trasladado)
  '2026-03-23', // San José (trasladado)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-05-01', // Día del Trabajo
  '2026-05-18', // Ascensión del Señor (trasladado)
  '2026-06-08', // Corpus Christi (trasladado)
  '2026-06-15', // Sagrado Corazón (trasladado)
  '2026-06-29', // San Pedro y San Pablo (trasladado)
  '2026-07-20', // Independencia de Colombia
  '2026-08-07', // Batalla de Boyacá
  '2026-08-17', // Asunción de la Virgen (trasladado)
  '2026-10-12', // Día de la Raza (trasladado)
  '2026-11-02', // Todos los Santos (trasladado)
  '2026-11-16', // Independencia de Cartagena (trasladado)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
]

/**
 * Verifica si una fecha es festivo en Colombia
 */
export function esFestivo(fecha: Date): boolean {
  const iso = fecha.toISOString().split('T')[0]
  return FESTIVOS_2026.includes(iso)
}

/**
 * Retorna los festivos que caen en los próximos N días a partir de hoy (en hora Colombia)
 */
export function festivosProximos(diasAdelante: number = 3): { fecha: string; nombre: string }[] {
  const hoy = new Date()
  // Ajustar a hora Colombia (UTC-5)
  const hoyCol = new Date(hoy.getTime() - 5 * 60 * 60 * 1000)
  const hoyStr = hoyCol.toISOString().split('T')[0]

  const resultado: { fecha: string; nombre: string }[] = []

  for (let i = 0; i <= diasAdelante; i++) {
    const d = new Date(hoyCol.getTime() + i * 24 * 60 * 60 * 1000)
    const dStr = d.toISOString().split('T')[0]
    if (FESTIVOS_2026.includes(dStr)) {
      resultado.push({ fecha: dStr, nombre: getNombreFestivo(dStr) })
    }
  }

  return resultado
}

/**
 * Calcula días hábiles entre dos fechas (excluye domingos y festivos)
 */
export function diasHabilesDesde(desde: Date): number {
  const hoy = new Date()
  const hoyCol = new Date(hoy.getTime() - 5 * 60 * 60 * 1000)
  let dias = 0
  const d = new Date(desde)

  while (d <= hoyCol) {
    const diaSemana = d.getDay() // 0=domingo, 6=sábado
    const iso = d.toISOString().split('T')[0]
    if (diaSemana !== 0 && !FESTIVOS_2026.includes(iso)) {
      dias++
    }
    d.setDate(d.getDate() + 1)
  }

  return dias
}

function getNombreFestivo(iso: string): string {
  const nombres: Record<string, string> = {
    '2026-01-01': 'Año Nuevo',
    '2026-01-12': 'Reyes Magos',
    '2026-03-23': 'San José',
    '2026-04-02': 'Jueves Santo',
    '2026-04-03': 'Viernes Santo',
    '2026-05-01': 'Día del Trabajo',
    '2026-05-18': 'Ascensión del Señor',
    '2026-06-08': 'Corpus Christi',
    '2026-06-15': 'Sagrado Corazón',
    '2026-06-29': 'San Pedro y San Pablo',
    '2026-07-20': 'Independencia de Colombia',
    '2026-08-07': 'Batalla de Boyacá',
    '2026-08-17': 'Asunción de la Virgen',
    '2026-10-12': 'Día de la Raza',
    '2026-11-02': 'Todos los Santos',
    '2026-11-16': 'Independencia de Cartagena',
    '2026-12-08': 'Inmaculada Concepción',
    '2026-12-25': 'Navidad',
  }
  return nombres[iso] ?? 'Festivo'
}
