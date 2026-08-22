/**
 * EL AGUJERO DE LA TILDE — barrido de los 11 guards.
 *
 * En JavaScript `\b` y `\w` sólo conocen [A-Za-z0-9_]. Una `á`, una `é` o una
 * `ñ` NO son carácter de palabra, así que un `\b` pegado a una palabra
 * acentuada **nunca matchea**: la regex se ve bien, pasa el typecheck, y da
 * falso NEGATIVO para siempre. El guard existe y no protege.
 *
 * Lo encontró el guard 11 el 2026-08-22: "Tu hemoglobina está baja" no
 * disparaba, porque `está` termina en `á` y detrás había un `\b`.
 *
 * Este barrido hace dos cosas:
 *   A) escaneo mecánico del archivo — dónde hay un `\b`/`\w` pegado a un
 *      carácter acentuado o a un grupo que puede terminar en uno;
 *   B) prueba de comportamiento: cada guard contra SU caso más obvio escrito
 *      con tilde. El escaneo señala sospechosos; sólo la prueba condena.
 *
 * Run: TZ=America/Bogota npx tsx scripts/barrido-tilde-guards.mts
 */
import { readFileSync } from 'fs'

const RUTA = 'src/lib/whatsapp/agent-guards.ts'
const ACENTOS = 'áéíóúüñÁÉÍÓÚÜÑ'

// ── A) escaneo mecánico ────────────────────────────────────────────────────
console.log('\n═══ A · ESCANEO MECÁNICO — dónde puede estar el agujero ═══\n')
const lineas = readFileSync(RUTA, 'utf-8').split('\n')
type Sospecha = { linea: number; texto: string; por: string }
const sospechas: Sospecha[] = []

for (let i = 0; i < lineas.length; i++) {
  const l = lineas[i]
  if (l.trimStart().startsWith('//') || l.trimStart().startsWith('*')) continue

  // 1. `\b` inmediatamente después de un carácter acentuado: "está\b"
  if (new RegExp(`[${ACENTOS}]\\\\\\\\?b`).test(l)) sospechas.push({ linea: i + 1, texto: l.trim(), por: 'un \\b pega contra una letra acentuada' })

  // 2. `\b` después de un grupo cuya ÚLTIMA alternativa puede terminar en tilde:
  //    (est[áa]n?)\b  →  la rama "está" deja el cursor sobre la á.
  for (const m of l.matchAll(/\(([^()]*)\)\\+b/g)) {
    const ramas = m[1].split('|')
    const riesgosa = ramas.find((r) => new RegExp(`[${ACENTOS}]\\??$|\\[[^\\]]*[${ACENTOS}][^\\]]*\\][?*]?$`).test(r.trim()))
    if (riesgosa) sospechas.push({ linea: i + 1, texto: l.trim(), por: `la rama "${riesgosa.trim()}" puede terminar en letra acentuada y le sigue un \\b` })
  }

  // 3. `\w` usado donde hay acentos alrededor: \w no matchea á/ñ
  if (/\\w/.test(l) && new RegExp(`[${ACENTOS}]`).test(l)) sospechas.push({ linea: i + 1, texto: l.trim(), por: '\\w en una línea con acentos — \\w no incluye á/é/í/ó/ú/ñ' })
}

if (sospechas.length === 0) console.log('  (ninguna)')
for (const s of sospechas) {
  console.log(`  L${String(s.linea).padStart(4)} · ${s.por}`)
  console.log(`         ${s.texto.slice(0, 130)}`)
}

// ── B) prueba de comportamiento, guard por guard ───────────────────────────
const G = await import('@/lib/whatsapp/agent-guards')

type Prueba = { guard: string; caso: string; texto: string; corre: () => boolean; esperado: boolean }
const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const anioRef = Number(HOY.slice(0, 4))

const pruebas: Prueba[] = [
  // GUARD 1 — la paciente afirma su identidad. El caso obvio con tilde: "Sí, soy…"
  { guard: '1 · identidad fabricada', caso: 'la paciente contesta "Sí, soy Laura" (con tilde)',
    texto: 'Sí, soy Laura',
    esperado: false,   // NO debe bloquear: ella SÍ confirmó
    corre: () => G.detectHallucinatedIdentity({
      agentText: 'Perfecto Laura, ya confirmé tu identidad. ¿Para qué fecha quieres la cita?',
      messageHistory: [{ role: 'agent', content: '¡Hola! 👋 Antes de seguir, ¿eres Laura Valencia?' }] as never,
      currentPatientMsg: 'Sí, soy Laura Valencia',
      patientName: 'Laura Valencia',
    }).blocked },
  { guard: '1 · identidad fabricada', caso: 'la misma frase SIN tilde ("Si, soy Laura")',
    texto: 'Si, soy Laura', esperado: false,
    corre: () => G.detectHallucinatedIdentity({
      agentText: 'Perfecto Laura, ya confirmé tu identidad. ¿Para qué fecha quieres la cita?',
      messageHistory: [{ role: 'agent', content: '¡Hola! 👋 Antes de seguir, ¿eres Laura Valencia?' }] as never,
      currentPatientMsg: 'Si, soy Laura Valencia',
      patientName: 'Laura Valencia',
    }).blocked },

  // GUARD 2 — "cancelé tu cita" con tilde en el verbo
  { guard: '2 · cancelación fabricada', caso: '"Ya cancelé tu cita" (con tilde)',
    texto: 'Ya cancelé tu cita del jueves.', esperado: true,
    corre: () => G.detectHallucinatedCancellation({ agentText: 'Ya cancelé tu cita del jueves.', toolsUsed: [] }).blocked },
  { guard: '2 · cancelación fabricada', caso: '"tu cita está cancelada" (está con tilde)',
    texto: 'Listo, tu cita está cancelada.', esperado: true,
    corre: () => G.detectHallucinatedCancellation({ agentText: 'Listo, tu cita está cancelada.', toolsUsed: [] }).blocked },

  // GUARD 3 — reagendamiento
  { guard: '3 · reagendamiento fabricado', caso: '"Ya reagendé tu cita" (con tilde)',
    texto: 'Ya reagendé tu cita para el viernes.', esperado: true,
    corre: () => G.detectHallucinatedReschedule({ agentText: 'Ya reagendé tu cita para el viernes.', toolsUsed: [] }).blocked },
  { guard: '3 · reagendamiento fabricado', caso: '"tu cita está reprogramada"',
    texto: 'Tu cita está reprogramada para el viernes.', esperado: true,
    corre: () => G.detectHallucinatedReschedule({ agentText: 'Tu cita está reprogramada para el viernes.', toolsUsed: [] }).blocked },

  // GUARD 4 — confirmación de cita fabricada
  { guard: '4 · confirmación fabricada', caso: '"✅ Cita confirmada" sin llamar la tool',
    texto: '✅ Cita confirmada para el jueves 28 de agosto.', esperado: true,
    corre: () => G.detectHallucinatedAppointmentConfirmation({ agentText: '✅ Cita confirmada para el jueves 28 de agosto.', hasAppointmentData: false, toolsUsed: [] }).blocked },

  // GUARD 6 — el chequeo 1 es aritmética pura y los días acentuados son el caso
  // más común en español: miércoles y sábado. 25/08/2026 es MARTES y 28/08 es
  // VIERNES, así que las dos frases mienten y tienen que bloquear.
  { guard: '6 · datos sin respaldo', caso: 'dice "miércoles 25 de agosto" y el 25 cae martes (día CON tilde)',
    texto: '¿Te agendo el miércoles 25 de agosto a las 9:00 AM?', esperado: true,
    corre: () => G.detectDatosSinRespaldo({ agentText: '¿Te agendo el miércoles 25 de agosto a las 9:00 AM?', hechos: undefined, anioRef }).blocked },
  { guard: '6 · datos sin respaldo', caso: 'dice "sábado 28 de agosto" y el 28 cae viernes (día CON tilde)',
    texto: '¿Te agendo el sábado 28 de agosto?', esperado: true,
    corre: () => G.detectDatosSinRespaldo({ agentText: '¿Te agendo el sábado 28 de agosto?', hechos: undefined, anioRef }).blocked },
  { guard: '6 · datos sin respaldo', caso: 'CONTROL — "miércoles 26 de agosto" es correcto y NO debe bloquear',
    texto: '¿Te agendo el miércoles 26 de agosto?', esperado: false,
    corre: () => G.detectDatosSinRespaldo({ agentText: '¿Te agendo el miércoles 26 de agosto?', hechos: undefined, anioRef }).blocked },

  // GUARD 7 — promesa de humano, redactada con tilde
  { guard: '7 · promesa sin escalar', caso: '"ya le pasé tu caso a una persona" (pasé con tilde)',
    texto: 'Ya le pasé tu caso a una persona del consultorio, te contactan pronto.', esperado: true,
    corre: () => G.detectPromesaDeHumanoSinEscalar({ agentText: 'Ya le pasé tu caso a una persona del consultorio, te contactan pronto.', toolsUsed: [], yaVaAEscalar: false, tieneServicioPendiente: false }).blocked },

  // GUARD 8 — negó una cita que ella afirma
  { guard: '8 · cita negada', caso: '"no encuentro ninguna cita" (presente, sin tilde) — el control',
    texto: 'No encuentro ninguna cita registrada a tu nombre.', esperado: true,
    corre: () => G.detectCitaNegadaQueEllaAfirma({ agentText: 'No encuentro ninguna cita registrada a tu nombre.', patientText: 'pero yo tengo una cita el jueves', toolsUsed: ['get_patient_appointments'], yaVaAEscalar: false }).blocked },
  { guard: '8 · cita negada', caso: '"no encontré ninguna cita" (pasado CON tilde)',
    texto: 'No encontré ninguna cita registrada a tu nombre.', esperado: true,
    corre: () => G.detectCitaNegadaQueEllaAfirma({ agentText: 'No encontré ninguna cita registrada a tu nombre.', patientText: 'pero yo tengo una cita el jueves', toolsUsed: ['get_patient_appointments'], yaVaAEscalar: false }).blocked },
  { guard: '8 · cita negada', caso: '"no encontre ninguna cita" (pasado SIN tilde) — separa el bug de la tilde del de la conjugación',
    texto: 'No encontre ninguna cita registrada a tu nombre.', esperado: true,
    corre: () => G.detectCitaNegadaQueEllaAfirma({ agentText: 'No encontre ninguna cita registrada a tu nombre.', patientText: 'pero yo tengo una cita el jueves', toolsUsed: ['get_patient_appointments'], yaVaAEscalar: false }).blocked },

  // GUARD 9 — preparación inventada con acentos
  { guard: '9 · preparación inventada', caso: '"no uses óvulos" (óvulos con tilde) sin preparaciones cargadas',
    texto: 'Para el examen no uses óvulos 3 días antes.', esperado: true,
    corre: () => G.detectPreparacionInventada({ agentText: 'Para el examen no uses óvulos 3 días antes.', preparacionesCargadas: [] }).blocked },
  { guard: '9 · preparación inventada', caso: '"vejiga vacía" (vacía con tilde)',
    texto: 'Debes llegar con la vejiga vacía.', esperado: true,
    corre: () => G.detectPreparacionInventada({ agentText: 'Debes llegar con la vejiga vacía.', preparacionesCargadas: [] }).blocked },

  // GUARD 10 — convenio afirmado sin llamar la tool
  { guard: '10 · convenio sin verificar', caso: '"Sí, atendemos Nueva EPS" (Sí con tilde)',
    texto: 'Sí, atendemos Nueva EPS.', esperado: true,
    corre: () => G.detectConvenioSinVerificar({ agentText: 'Sí, atendemos Nueva EPS.', toolsUsed: [] }).blocked },

  // GUARD 11 — el que originó el barrido
  { guard: '11 · interpretación clínica', caso: '"tu hemoglobina está baja" (está con tilde) — el bug original',
    texto: 'Tu hemoglobina está baja.', esperado: true,
    corre: () => G.detectInterpretacionClinica({ agentText: 'Tu hemoglobina está baja.' }).blocked },
]

console.log('\n\n═══ B · PRUEBA DE COMPORTAMIENTO — cada guard contra su caso con tilde ═══\n')
let fallos = 0
let guardActual = ''
for (const p of pruebas) {
  if (p.guard !== guardActual) { console.log(`\n  GUARD ${p.guard}`); guardActual = p.guard }
  let real: boolean | string
  try { real = p.corre() } catch (e) { real = `error: ${e instanceof Error ? e.message : e}` }
  const ok = real === p.esperado
  if (!ok) fallos++
  console.log(`    ${ok ? '✅' : '🔴'} ${p.caso}`)
  console.log(`       esperado ${p.esperado ? 'BLOQUEA' : 'pasa'} · real ${real === true ? 'BLOQUEA' : real === false ? 'pasa' : real}`)
}

console.log(`\n\n═══ RESULTADO ═══\n  sospechas del escaneo: ${sospechas.length}\n  fallos de comportamiento: ${fallos}\n`)
process.exit(0)
