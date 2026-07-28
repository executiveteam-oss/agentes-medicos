import { detectDataRightsRequest, detectCrisis } from '../src/lib/safety/crisis-patterns'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Capa 0 — detección de solicitudes sobre DATOS PERSONALES (ARCO)\n')

// --- POSITIVOS: eliminación / borrado (DEBEN disparar) ---
const borrado = [
  'quiero eliminar mis datos',
  'eliminen toda mi informacion',
  'quiero que borren mi registro',
  'borren todo lo mio',
  'pueden eliminar mis datos personales',
  'quiero borrar mi historia clinica',           // historia clínica = dato
  'eliminen mis datos de su sistema',
  'no quiero estar en su base de datos',
]
for (const t of borrado) assert(`BORRADO+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: oposición al almacenamiento ---
const oposicion = [
  'no quiero que guarden mi informacion',
  'no quiero que me guarden informacion',        // ejemplo textual del usuario
  'no quiero que almacenen mis datos',
  'me opongo al tratamiento de mis datos',
  'ya no autorizo',
  'no autorizo que usen mis datos',
]
for (const t of oposicion) assert(`OPOSICION+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: acceso ---
const acceso = [
  'que datos tienen mios',
  'que informacion tienen de mi',
  'quiero saber que datos tienen de mi',
  'me pueden decir que informacion guardan',
  'quiero acceder a mis datos personales',
]
for (const t of acceso) assert(`ACCESO+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: rectificación / revocación ---
const rectRevoc = [
  'necesito corregir mis datos',
  'quiero rectificar mis datos personales',
  'quiero revocar mi consentimiento',
  'quiero retirar mi autorizacion',
]
for (const t of rectRevoc) assert(`RECT/REVOC+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: política / ARCO / habeas data / la palabra "privacidad" ---
const politica = [
  'cual es la politica de privacidad',
  'quiero ver la politica de tratamiento de datos',
  'quiero ejercer mis derechos arco',
  'habeas data',
  'privacidad',                                   // la promesa del aviso actual
  'proteccion de mis datos personales',
]
for (const t of politica) assert(`POLITICA+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: origen del dato (acceso — "¿de dónde sacaron mi info?") ---
const origen = [
  'quien les dio mi numero',
  'quien les paso mi numero',
  'como consiguieron mi informacion',
  'de donde sacaron mis datos',
  'de donde obtuvieron mi telefono',
  'quien les dio mi numero de telefono',
  'como consiguieron mi celular',
]
for (const t of origen) assert(`ORIGEN+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- POSITIVOS: amenaza de queja/denuncia SIC (mayor riesgo, DEBE escalar) ---
const denuncia = [
  'los voy a denunciar',
  'voy a poner una queja en la superintendencia',
  'voy a poner una queja en la sic',
  'esto viola mis datos personales',
  'estan violando mis datos',
  'es una violacion de mis datos personales',
  'voy a la superintendencia',
]
for (const t of denuncia) assert(`DENUNCIA+ "${t}"`, detectDataRightsRequest(t).matched, 'no disparó')

// --- AMBIGUOS → lado ARCO (sobre-detectar, DEBEN disparar) ---
const ambiguo = [
  'quiero actualizar mis datos',                  // rectificación aunque sea rutina
  'quiero cambiar mis datos',
]
for (const t of ambiguo) assert(`AMBIGUO+ "${t}"`, detectDataRightsRequest(t).matched, 'ambiguo debe escalar')

// --- FALSOS POSITIVOS (NO deben disparar) ---
const noDispara = [
  'cual es la politica de cancelacion',           // política ≠ datos
  'cual es la politica de la clinica sobre acompanantes',
  'confirma mis datos para la cita',              // confirmar ≠ borrar/acceder
  'te confirmo mis datos juan cc 123',
  'quiero eliminar mi cita',                      // cita ≠ datos (CLAVE)
  'necesito cancelar mi cita',
  'quiero cambiar la fecha de mi cita',           // cambiar fecha ≠ cambiar datos
  'necesito actualizar mi numero de telefono',    // "mi numero" ≠ "mis datos"
  'cuales datos necesitan para agendar',          // pregunta de agendamiento, no ARCO
  'me pueden dar informacion de la cita',
  'quiero agendar una cita',
  'que precio tienen la consulta',
  'quiero saber que horarios tienen',             // "que horarios" ≠ "que datos"
  'de donde sacaron esa informacion del examen',  // "esa informacion" ≠ "mi informacion"
  'quien les dio el resultado de mi examen',       // object no es dato de contacto/personal
]
for (const t of noDispara) assert(`NO- "${t}"`, !detectDataRightsRequest(t).matched, 'FALSO POSITIVO')

// --- PRECEDENCIA: crisis manda sobre datos (una crisis con "privacidad" sigue siendo crisis) ---
assert('crisis gana sobre datos', detectCrisis('me quiero suicidar, y borren mis datos').matched === true)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
