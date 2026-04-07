// ============================================================
// Sanitización de mensajes de pacientes
// Limpia el input ANTES de enviarlo a Claude para evitar:
// 1. Inyección de prompts (alguien intenta "hackear" al agente)
// 2. Mensajes demasiado largos que gastan tokens
// 3. HTML/scripts maliciosos
// ============================================================

const MAX_MESSAGE_LENGTH = 1000 // Caracteres máximo — un mensaje normal tiene ~200

/**
 * Sanitiza el mensaje del paciente antes de enviarlo al LLM
 * - Limita longitud a 1000 caracteres
 * - Elimina etiquetas HTML
 * - Elimina caracteres de control invisibles
 * - Limpia intentos básicos de inyección de prompts
 */
export function sanitizePatientMessage(rawMessage: string): string {
  let message = rawMessage

  // 1. Eliminar etiquetas HTML (por si alguien envía <script> o similar)
  message = message.replace(/<[^>]*>/g, '')

  // 2. Eliminar caracteres de control invisibles (excepto saltos de línea)
  //    Estos caracteres pueden confundir al LLM
  message = message.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 3. Normalizar unicode (NFD → NFC) para evitar evasión con caracteres combinados
  message = message.normalize('NFC')

  // 4. Normalizar acentos para comparación de patrones de inyección
  //    (comparamos contra versión sin acentos, pero mantenemos el mensaje original)
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  // 5. Limpiar intentos de inyección de prompts
  const injectionPatterns = [
    // Inglés
    /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/gi,
    /forget\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|context)/gi,
    /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/gi,
    /override\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/gi,
    /bypass\s+(all\s+)?(safety|security|content|system)/gi,
    /you\s+are\s+now\s+a/gi,
    /act\s+as\s+(a\s+)?(different|new)/gi,
    /pretend\s+(you\s+are|to\s+be|that)/gi,
    /jailbreak/gi,
    /system\s*prompt/gi,
    /\[INST\]/gi,
    /\[SYSTEM\]/gi,
    /system\s*:\s*/gi,
    /<\|im_start\|>/gi,
    /<<\s*SYS\s*>>/gi,
    // Español
    /ignora\s+(todas?\s+)?(las?\s+)?(instrucciones|prompts?)\s*(anteriores|previas?)?/gi,
    /olvida\s+(todas?\s+)?(las?\s+)?(instrucciones|prompts?|reglas)/gi,
    /olvidar\s+(todas?\s+)?(las?\s+)?(instrucciones|prompts?|reglas)/gi,
    /ignorar\s+(todas?\s+)?(las?\s+)?(instrucciones|prompts?|reglas)/gi,
    /eres\s+ahora\s+un/gi,
    /actua\s+como\s+(un|una|si)/gi,
    /pretende\s+que\s+(eres|no)/gi,
    /instrucciones\s+anteriores/gi,
  ]

  for (const pattern of injectionPatterns) {
    message = message.replace(pattern, '[filtrado]')
  }

  // 6. Verificar patrones en versión normalizada (sin acentos)
  const normalizedInjectionKeywords = [
    'actua como si', 'pretende que eres', 'instrucciones anteriores',
    'olvida las reglas', 'ignora las instrucciones', 'system prompt',
  ]
  for (const keyword of normalizedInjectionKeywords) {
    if (normalized.includes(keyword)) {
      message = message.replace(new RegExp(keyword.replace(/\s+/g, '\\s+'), 'gi'), '[filtrado]')
    }
  }

  // 7. Truncar a longitud máxima
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_MESSAGE_LENGTH)
  }

  // 8. Limpiar espacios extra
  message = message.trim()

  return message
}

/**
 * Verifica si el mensaje es de un tipo que el agente puede procesar
 * Soporta texto siempre, y image/document si el paciente tiene documentos pendientes.
 */
export function isSupportedMessageType(type: string, hasDocumentsPending?: boolean): boolean {
  if (type === 'text') return true
  // Aceptar image y document si el paciente tiene documentos pendientes
  if (hasDocumentsPending && (type === 'image' || type === 'document')) return true
  return false
}

/**
 * Tipos de media que cuentan como "documento recibido" para el flujo de documentos
 */
export function isDocumentMediaType(type: string): boolean {
  return type === 'image' || type === 'document'
}

/**
 * Mensaje para cuando el paciente envía un tipo no soportado (audio, imagen, etc.)
 */
export function getUnsupportedTypeMessage(type: string): string {
  const typeMessages: Record<string, string> = {
    audio: '🎤 Por ahora solo manejo mensajes de texto. ¿Me escribes tu consulta?',
    image: '📷 Por ahora solo manejo mensajes de texto. ¿Me cuentas qué necesitas?',
    video: '🎥 Por ahora solo manejo mensajes de texto. ¿Me escribes tu consulta?',
    document: '📄 Por ahora solo manejo mensajes de texto. ¿Me cuentas qué necesitas?',
    sticker: '😊 ¡Qué buen sticker! Pero solo manejo texto. ¿En qué te puedo ayudar?',
    location: '📍 Gracias por la ubicación, pero por ahora solo manejo texto. ¿En qué te ayudo?',
  }

  return typeMessages[type] ?? 'Por ahora solo manejo mensajes de texto. ¿Me escribes tu consulta?'
}
