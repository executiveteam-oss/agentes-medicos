import { detectCrisis, detectHumanRequest, normalizeForSafety } from '../src/lib/safety/crisis-patterns'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Capa 0 — detección de crisis\n')

// --- normalizeForSafety ---
assert('normaliza acentos/mayúsculas', normalizeForSafety('ME QUIERO MORÍR') === 'me quiero morir')
assert('colapsa letras repetidas', normalizeForSafety('holaaaa') === 'hola')
assert('quita puntuación', normalizeForSafety('¡me quiero morir!!!') === 'me quiero morir')

// --- CRISIS: positivos directos (DEBEN disparar) ---
const crisisPos = [
  'Me quiero suicidar, que hago',        // mensaje real del incidente
  'estoy pensando en suicidarme',
  'quiero suicidarme',
  'suisidio',                             // typo
  'quiero matarme',
  'me voy a matar',
  'quiero quitarme la vida',
  'ya no quiero vivir',
  'no quiero seguir viviendo',
  'no le veo sentido a la vida',
  'prefiero estar muerto',
  'estaria mejor muerto',
  'quiero hacerme daño',
  'pienso en cortarme las venas',
  'quiero autolesionarme',
]
for (const t of crisisPos) assert(`CRISIS+ "${t}"`, detectCrisis(t).matched, 'no disparó')

// --- CRISIS: AMBIGUOS → lado crisis (principio rector, DEBEN disparar) ---
const crisisAmbiguo = [
  'me quiero morir',
  'quiero morir',
  'ya no aguanto mas',
  'no quiero seguir aca',            // bare → crisis
  'me quiero morir por el dolor',    // "por X" → crisis (calibrado #3, sobre-detectar)
  'me quiero morir por esto que me pasa',
]
for (const t of crisisAmbiguo) assert(`CRISIS-ambiguo+ "${t}"`, detectCrisis(t).matched, 'ambiguo debe ir a crisis')

// --- CRISIS: negativos (modismos con calificador, NO deben disparar) ---
const crisisNeg = [
  'me quiero morir de la pena',
  'me quiero morir de la verguenza',
  'que pena tan berraca',
  'me muero por un cafe',
  'me muero por verte',
  'matar el tiempo',
  'me esta matando el trabajo',
  'me esta matando la espalda',
  'me mata la curiosidad',
  'morirse de risa',
  'morirse del susto',
  'morirse del aburrimiento',
  'morirse de las ganas',
  'me muero de risa',
  'me muero de hambre',
  'me muero de sueno',
  'me muero de frio',
  'me matas de risa',
  'esto me mata',
  'me duele la cabeza',
  'es un dolor mortal',
  'morir de amor',
  'necesito una cita de ginecologia',
  'no quiero seguir aca en la fila',   // continuación inocua → NO crisis
  'la escala del dolor llego a 8',     // "escala" médica → NO pedido de humano ni crisis
]
for (const t of crisisNeg) assert(`CRISIS- "${t}"`, !detectCrisis(t).matched, 'FALSO POSITIVO')

// --- HUMANO: positivos (DEBEN disparar) ---
const humanPos = [
  'Escala a humano',                     // incidente
  'Humano',                              // incidente ("Humano*" → sanitizado)
  'necesito hablar con una persona',
  'quiero un asesor',
  'pasame con alguien del consultorio',
  'necesito una persona real',
  'quiero escalar con un humano',
  'escálame a alguien',                  // conjugado (calibrado #2)
  'escálenme a alguien del equipo',      // conjugado (calibrado #2)
  'escálame',                            // reflexivo bare → pedido de transferencia
]
for (const t of humanPos) assert(`HUMANO+ "${t}"`, detectHumanRequest(t).matched, 'no disparó')

// --- HUMANO: negativos (NO deben disparar) ---
const humanNeg = [
  'soy una persona mayor',
  'busco cita para persona de la tercera edad',
  'hola buenas',
  'quiero agendar una cita',
  'la escala del dolor llego a 8',       // "escala" médica, NO pedido de humano
  'en que escala miden el dolor',
]
for (const t of humanNeg) assert(`HUMANO- "${t}"`, !detectHumanRequest(t).matched, 'FALSO POSITIVO')

// --- Precedencia: crisis gana sobre humano ---
assert('crisis gana sobre humano', detectCrisis('me quiero suicidar, pasame con un humano').matched === true)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
