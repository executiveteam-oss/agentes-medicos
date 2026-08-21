/**
 * Test puro del contrato de salida. Sin DB, sin red, sin modelo.
 * Los casos salieron de la prueba en sombra sobre 1.020 turnos reales
 * (scripts/sombra/replay-contrato-salida.mts).
 * Run: npx tsx scripts/test-contrato-salida.ts
 */
import { armarSalida, type VueltaDelLoop } from '@/lib/agent/contrato-de-salida'

const FB = 'FALLBACK'
let ok = 0, fail = 0
function check(nombre: string, vueltas: VueltaDelLoop[], esperado: { text: string; origen: string }) {
  const r = armarSalida(vueltas, FB)
  const bien = r.text === esperado.text && r.origen === esperado.origen
  console.log(`${bien ? '✅' : '🔴'} ${nombre}`)
  if (!bien) { console.log(`     esperado: [${esperado.origen}] ${JSON.stringify(esperado.text)}`)
               console.log(`     obtuvo  : [${r.origen}] ${JSON.stringify(r.text)}`) ; fail++ } else ok++
}

// REGLA 0 — escalación: gana el texto PRE-tool, no lo que diga después.
check('escalación: manda el motivo pre-tool, no el eco posterior',
  [{ textos: ['Ese servicio lo maneja una persona del consultorio.'], cierre: 'tool_use', tools: ['escalate_to_human'] },
   { textos: ['Un asesor te contactará pronto.'], cierre: 'end_turn', tools: [] }],
  { text: 'Ese servicio lo maneja una persona del consultorio.', origen: 'pre_escalada' })

// REGLA 1 — el texto de cierre es la respuesta; el preámbulo se cae.
check('preámbulo antes de la tool: se descarta',
  [{ textos: ['Perfecto, voy a revisar la disponibilidad.'], cierre: 'tool_use', tools: ['check_availability'] },
   { textos: ['Tengo el lunes 24 a las 8:00 AM. ¿Te sirve?'], cierre: 'end_turn', tools: [] }],
  { text: 'Tengo el lunes 24 a las 8:00 AM. ¿Te sirve?', origen: 'final' })

// El caso que motivó la regla: dato inventado y después corregido.
check('dato inventado pre-tool: no sale',
  [{ textos: ['El consultorio atiende de 8:00 AM a 1:00 PM los sábados.'], cierre: 'tool_use', tools: ['check_availability'] },
   { textos: ['El Dr. Jorge no atiende sábados. Atiende lunes, miércoles y viernes.'], cierre: 'end_turn', tools: [] }],
  { text: 'El Dr. Jorge no atiende sábados. Atiende lunes, miércoles y viernes.', origen: 'final' })

// REGLA 1-bis — turno 83 de la sombra: la pregunta no puede quedar colgada.
check('pregunta pre-tool + cierre que no pregunta nada: van las dos',
  [{ textos: ['¿Confirmas que eres Lucelly Sempertex? Responde sí o no.'], cierre: 'tool_use', tools: ['get_patient_appointments'] },
   { textos: ['Cuando confirmes tu identidad te doy la información de tu cita.'], cierre: 'end_turn', tools: [] }],
  { text: '¿Confirmas que eres Lucelly Sempertex? Responde sí o no.\n\nCuando confirmes tu identidad te doy la información de tu cita.',
    origen: 'final_mas_pregunta' })

// …pero si el cierre YA pregunta algo, no se re-agrega nada.
check('el cierre ya pregunta: no se agrega el preámbulo',
  [{ textos: ['¿Para qué día lo quieres?'], cierre: 'tool_use', tools: ['check_availability'] },
   { textos: ['Tengo lunes y miércoles. ¿Cuál prefieres?'], cierre: 'end_turn', tools: [] }],
  { text: 'Tengo lunes y miércoles. ¿Cuál prefieres?', origen: 'final' })

// REGLA 2 — no cerró con texto: lo último que alcanzó a decir.
check('cierre mudo: manda lo último dicho antes de la tool',
  [{ textos: ['Dame un segundo.'], cierre: 'tool_use', tools: ['check_availability'] },
   { textos: ['Ya casi, revisando el último dato.'], cierre: 'tool_use', tools: ['check_availability'] },
   { textos: [], cierre: 'end_turn', tools: [] }],
  { text: 'Ya casi, revisando el último dato.', origen: 'previo_a_tool' })

// REGLA 3 — nunca silencio.
check('el modelo no dijo NADA: fallback, nunca vacío',
  [{ textos: [], cierre: 'end_turn', tools: [] }], { text: FB, origen: 'fallback' })
check('cero vueltas: fallback', [], { text: FB, origen: 'fallback' })

// Varios bloques en la MISMA vuelta son una sola emisión: no se parten.
check('dos bloques en la vuelta de cierre: van los dos',
  [{ textos: ['Listo, quedó agendada.', '¿Necesitas algo más?'], cierre: 'end_turn', tools: [] }],
  { text: 'Listo, quedó agendada.\n\n¿Necesitas algo más?', origen: 'final' })

console.log(`\n${ok} pasaron, ${fail} fallaron`)
process.exit(fail ? 1 : 0)
