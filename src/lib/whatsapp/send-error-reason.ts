// ============================================================
// Motivo de fallo de envío de WhatsApp en lenguaje CLARO (para la secretaria).
// El código de Meta va al audit_log; acá el texto que se muestra en pantalla.
// ============================================================
export function whatsappSendErrorReason(code?: number | null): string {
  switch (code) {
    case 131030:
      return 'El número no está autorizado para recibir mensajes (lista del Test Number de Meta).'
    case 190:
      return 'El token de WhatsApp de la clínica venció.'
    case 131047:
      return 'Pasaron más de 24 horas desde el último mensaje del paciente; WhatsApp no permite escribir sin una plantilla aprobada.'
    case 131026:
      return 'El número no tiene WhatsApp o no puede recibir mensajes.'
    case 131031:
      return 'La cuenta de WhatsApp de la clínica está restringida por Meta.'
    case 368:
      return 'La cuenta de WhatsApp está temporalmente bloqueada por Meta.'
    default:
      return code
        ? `No se pudo entregar el mensaje (WhatsApp código ${code}).`
        : 'No se pudo entregar el mensaje (falla de conexión con WhatsApp).'
  }
}
