/**
 * Guard 9 — preparación inventada. Puro, sin DB.
 * Run: npx tsx scripts/test-guard-preparacion.ts
 */
import { detectPreparacionInventada } from '@/lib/whatsapp/agent-guards'

const CARGADA_REAL = 'No tener relaciones sexuales 24 horas antes. No usar óvulos ni cremas vaginales 2 días antes. No debe tener sangrado abundante.'
let mal = 0
function check(nombre: string, texto: string, cargadas: string[], debeBloquear: boolean) {
  const r = detectPreparacionInventada({ agentText: texto, preparacionesCargadas: cargadas })
  const ok = r.blocked === debeBloquear
  if (!ok) mal++
  console.log(`${ok ? '✅' : '🔴'} ${nombre}  (bloqueó=${r.blocked})`)
}

// El caso real del 21/08: clínica SIN nada cargado, el agente se la inventa.
check('inventa "vejiga llena" sin nada cargado',
  'Para la ecografía necesitas vejiga llena: toma agua 1 hora antes y no orines.', [], true)
check('inventa ayuno sin nada cargado',
  'Debes venir en ayunas de 8 horas.', [], true)

// Con preparación cargada, reproducirla NO se bloquea.
check('reproduce la preparación cargada',
  'Para ese examen: no tengas relaciones sexuales 24 horas antes, no uses óvulos ni cremas vaginales 2 días antes, y no debes tener sangrado abundante.',
  [CARGADA_REAL], false)
check('la resume pero es la misma',
  'Ten en cuenta: sin relaciones sexuales 24 horas antes, sin óvulos ni cremas vaginales 2 días antes, y sin sangrado abundante.',
  [CARGADA_REAL], false)

// Con preparación cargada pero inventando OTRA cosa: bloquea igual.
check('🔴 inventa vejiga llena aunque la clínica tenga OTRA preparación cargada',
  'Para la ecografía necesitas la vejiga llena: toma agua 1 hora antes.', [CARGADA_REAL], true)

// Texto sin ninguna indicación: no dispara.
check('confirma una cita (no es preparación)',
  '✅ Cita confirmada con el Dr. Jorge el miércoles 26 a las 8:15 AM. Te esperamos.', [], false)
check('dice que no la sabe y deriva',
  'Prefiero no darte una indicación de preparación de memoria. Ya le pedí al consultorio que te confirme.', [], false)
check('habla de horarios, no de preparación',
  'El Dr. Jorge atiende lunes de 7:30 a 12:00. ¿Te sirve el lunes 24?', [], false)

console.log(`\n${mal === 0 ? '✅ todo bien' : `🔴 ${mal} fallas`}`)
process.exit(mal ? 1 : 0)
