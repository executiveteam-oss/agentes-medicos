// ============================================================
// Capa 0 de seguridad — detectores deterministas (puros, sin DB/red).
// Principio: ante ambigüedad, SOBRE-DETECTAR crisis. Un caso sin calificador
// inequívoco de modismo va al lado de crisis. Ver spec §3/§6.
// Las keywords viven acá (código), NO en config por-clínica.
// ============================================================

/** Normaliza para matchear: minúsculas, sin acentos, sin puntuación,
 *  colapsa espacios y letras repetidas (3+). Tolera tildes/mayúsculas/typos. */
export function normalizeForSafety(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quitar diacriticos (acentos)
    .replace(/(.)\1{2,}/g, '$1')      // colapsar 3+ repeticiones (holaaa → hola)
    .replace(/[^\w\s]/g, ' ')         // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}

// Cola de modismo que DESACTIVA el match de "morir" (calificador inequívoco).
// Cola de modismo que DESACTIVA "morir": SOLO el calificador "de <modismo>"
// (de la pena / de risa / de hambre...). Se quitó la exclusión de "por" a
// propósito (decisión de calibración): "me quiero morir por el dolor/por esto"
// se trata como CRISIS — errar hacia sobre-detectar (costo asimétrico).
const IDIOM_TAIL = '(?! de (la |el |las |los )?(pena|verguenza|risa|susto|aburrimiento|ganas|hambre|sueno|frio|calor|sed|amor|miedo|nervios))'

// Patrones de crisis. Cada uno corre sobre el texto YA normalizado.
const CRISIS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(suicid|suisid)/, label: 'suicidio' },
  { re: new RegExp(`\\b(matarme|me mato|me voy a matar|me quiero matar|quiero matarme)\\b(?! de )`), label: 'matarse' },
  { re: new RegExp(`\\b(me )?(quiero|quisiera) morir(me)?\\b${IDIOM_TAIL}`), label: 'quiero morir' },
  // "quitar(se) la vida": cubre enclítico (quitarme/quitarse) Y perifrástico
  // ("me voy a quitar la vida", "me quiero quitar la vida"). Sin el suffix
  // enclítico opcional se escapaban declaraciones inequívocas (review I1).
  { re: /\b(quitar(me|se|te|le|nos)?\s+la\s+vida|acabar con mi vida|terminar con mi vida|acabar con todo)\b/, label: 'quitarse la vida' },
  { re: /\b(no quiero vivir|no quiero seguir viviendo|ya no quiero vivir|no vale la pena vivir|no le veo sentido a (la vida|nada|vivir))\b/, label: 'no quiero vivir' },
  { re: /\b(mejor muerto|estaria mejor muerto|prefiero estar muerto|estarian mejor sin mi)\b/, label: 'mejor muerto' },
  { re: /\b(hacerme dano|lastimarme|autolesi|cortarme (las venas|los brazos))/, label: 'autolesion' },
  { re: /\b(ya no aguanto mas|desaparecer para siempre)\b/, label: 'indirecto' },
  // "no quiero seguir aca" (bare) = crisis (ambiguo → crisis). Se excluye solo
  // la continuación claramente inocua ("...en la fila", "...esperando").
  { re: /\bno quiero seguir aca\b(?! (en (la |esta )?fila|esperando|haciendo fila))/, label: 'indirecto-aca' },
]

const HUMAN_REQUEST_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(humano|ser humano|agente humano)\b/, label: 'humano' },
  { re: /\b(persona real|con una persona|con alguien real|alguien del consultorio)\b/, label: 'persona' },
  { re: /\b(hablar con alguien|hablar con una persona|pasame con|comunicarme con alguien)\b/, label: 'hablar con alguien' },
  { re: /\b(asesor|secretaria)\b/, label: 'asesor' },
  // "escalar" solo con intención de transferencia — NO la palabra "escala"
  // suelta ("escala del dolor" es frecuente en una clínica de dolor pélvico).
  { re: /\bescala(r)? a (un |una )?(humano|persona|asesor|alguien|secretaria)\b/, label: 'escalar a' },
  // Formas reflexivas imperativas ("escálame", "escálenme", "escalarme") =
  // pedido de transferencia inequívoco, con o sin destino explícito.
  { re: /\bescal(ame|enme|arme)\b/, label: 'escalar reflexivo' },
]

// Solicitudes sobre DATOS PERSONALES (ARCO / habeas data / política de datos).
// Determinista, corre en Capa 0 como el pedido de humano. Cualquier match
// ESCALA al canal humano — el bot NUNCA cumple la solicitud solo (no borra, no
// exporta, no rectifica). La política de datos vigente de la clínica designa
// este mismo WhatsApp como canal oficial ARCO, con término legal de respuesta
// → un falso NEGATIVO = la clínica incumple su propia política. Ante ambigüedad,
// sobre-detectar (mismo principio que crisis). Ver spec Capa 0.
const DATA_RIGHTS_PATTERNS: { re: RegExp; label: string }[] = [
  // Eliminación / borrado — el sustantivo de datos va pegado al verbo (con a lo
  // sumo 2 determinantes), para NO capturar "eliminar mi cita" (cita ≠ datos).
  { re: /\b(eliminar|eliminen|elimine|elimina|borrar|borren|borre|borra)( (mis|mi|toda|todos|todo|los|la|su|sus)){0,2} (datos|dato|informacion|registro|registros|historial|historia)\b/, label: 'eliminar datos' },
  { re: /\b(borren|eliminen) todo lo mio\b/, label: 'baja datos' },
  { re: /\bno quiero estar en (su|la) base de datos\b/, label: 'baja base' },
  // Oposición al almacenamiento / tratamiento
  { re: /\bno quiero que (me )?(guarden|almacenen|tengan|usen|traten|conserven|registren)( mi| mis| la)? (datos|dato|informacion)\b/, label: 'no almacenar' },
  { re: /\b(me opongo al tratamiento|no autorizo (el tratamiento|que (usen|guarden|traten))|ya no autorizo)\b/, label: 'oposicion' },
  // Acceso ("¿qué datos tienen míos?", "quiero saber qué información tienen")
  { re: /\bque (datos|dato|informacion) (tienen|guardan|almacenan|manejan)\b/, label: 'acceso' },
  { re: /\b(quiero saber|quisiera saber|puedo saber|me pueden decir) que (datos|dato|informacion)\b/, label: 'acceso saber' },
  { re: /\b(acceder a|consultar) mis datos( personales)?\b/, label: 'acceso mis datos' },
  // Origen del dato ("¿quién les dio mi número?", "¿de dónde sacaron mis datos?")
  // — es la forma más común de expresar preocupación por datos; es acceso ARCO.
  { re: /\b(quien les (dio|paso)|quien le (dio|paso)|de donde (sacaron|obtuvieron|consiguieron|tienen)|como (consiguieron|obtuvieron|sacaron|tienen))( \w+){0,3} (mi numero|mi telefono|mi celular|mi informacion|mis datos|mi contacto)\b/, label: 'origen del dato' },
  // Rectificación ("corregir/actualizar mis datos" — NO "confirmar mis datos")
  { re: /\b(corregir|rectificar|actualizar|cambiar) mis datos( personales)?\b/, label: 'rectificacion' },
  // Revocación de consentimiento
  { re: /\b(revocar|retirar|retiro|revoco) (mi|el) (autorizacion|consentimiento)\b/, label: 'revocacion' },
  // ARCO / habeas data / protección de datos — EJERCICIO de derechos → escalan.
  // NOTA: "privacidad" y "política de privacidad/tratamiento/datos" NO están acá
  // — son CONSULTAS de política (informativas), las maneja detectPrivacyPolicyQuery.
  { re: /\b(derecho arco|derechos arco|habeas data)\b/, label: 'arco' },
  { re: /\btratamiento de (mis )?datos personales\b/, label: 'tratamiento datos' },
  { re: /\bproteccion de (mis )?datos( personales)?\b/, label: 'proteccion datos' },
  // Amenaza de queja/denuncia ante la SIC — el caso de MAYOR riesgo legal.
  // Escala siempre; sobre-detectar acá es barato (una amenaza siempre amerita
  // que la vea un humano) y no hacerlo es el peor escenario.
  { re: /\b(los voy a denunciar|voy a denunciar|los denuncio|voy a poner una (queja|denuncia)|poner una (queja|denuncia)|una queja (ante|en) (la )?(sic|superintendencia)|ante la (sic|superintendencia)|voy a (la )?superintendencia|a la superintendencia)\b/, label: 'denuncia/SIC' },
  { re: /\b(esto )?(viola|violan|estan violando) (mis |los )?datos( personales)?\b/, label: 'violacion datos' },
  { re: /\bes una violacion (de |a )(mis )?datos( personales)?\b/, label: 'violacion datos' },
]

export function detectCrisis(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of CRISIS_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}

// ============================================================
// CONSULTA de política de privacidad (informativa, NO ejercicio de derecho).
// "privacidad", "política de privacidad", "política de tratamiento de datos".
// Separada de detectDataRightsRequest a propósito: si la clínica tiene URL de
// política configurada → se responde con el link (SIN escalar); si no → cae al
// flujo de derechos (acuse + escalación). El EJERCICIO de un derecho (eliminar,
// acceder, rectificar, etc.) NUNCA pasa por acá — ese escala siempre.
// ============================================================
const PRIVACY_POLICY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bpolitica de (privacidad|tratamiento|datos|proteccion de datos)\b/, label: 'politica' },
  { re: /\bprivacidad\b/, label: 'privacidad' },
]

export function detectPrivacyPolicyQuery(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of PRIVACY_POLICY_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}

export function detectDataRightsRequest(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of DATA_RIGHTS_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}

export function detectHumanRequest(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of HUMAN_REQUEST_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}
