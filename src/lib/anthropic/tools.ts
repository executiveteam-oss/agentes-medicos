// ============================================================
// Definición de Tools (herramientas) para Claude
// Estas son las ACCIONES que el agente puede ejecutar:
// - Revisar disponibilidad de horarios
// - Crear, cancelar, reagendar citas
// - Ver citas del paciente
// - Escalar a humano
// - Agregar a lista de espera
//
// Claude decide CUÁNDO usar cada tool basado en la conversación.
// Nosotros definimos QUÉ parámetros necesita cada una.
// ============================================================

import type { Tool } from '@anthropic-ai/sdk/resources/messages'

export const agentTools: Tool[] = [
  {
    name: 'check_availability',
    description:
      'Consulta los horarios disponibles de un doctor para una fecha específica. ' +
      'Úsala cuando el paciente quiere agendar y necesitas mostrarle opciones. ' +
      'Si no hay disponibilidad, sugiere al paciente unirse a la lista de espera.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doctor_id: {
          type: 'string',
          description: 'ID UUID del doctor',
        },
        preferred_date: {
          type: 'string',
          description: 'Fecha preferida en formato YYYY-MM-DD. Si no la da, usa la fecha de hoy.',
        },
        preferred_time: {
          type: 'string',
          description: 'Hora preferida en formato HH:MM (24h). Opcional.',
        },
        consultation_type_id: {
          type: 'string',
          description: 'ID UUID del tipo de consulta. Si se proporciona, se usa la duración del tipo en vez de la duración por defecto. Opcional.',
        },
      },
      required: ['doctor_id'],
    },
  },
  {
    name: 'create_appointment',
    description:
      'Crea una cita nueva. SOLO usar DESPUÉS de que el paciente confirme fecha y hora ' +
      'y haya proporcionado todos los datos requeridos. ' +
      'NUNCA agendar sin confirmación explícita del paciente ("sí, dale", "perfecto", "agéndame").',
    input_schema: {
      type: 'object' as const,
      properties: {
        doctor_id: {
          type: 'string',
          description: 'ID UUID del doctor',
        },
        patient_name: {
          type: 'string',
          description: 'Nombres y apellidos completos del paciente',
        },
        patient_phone: {
          type: 'string',
          description: 'Teléfono del paciente con código de país (ej: +573101112233)',
        },
        starts_at: {
          type: 'string',
          description: 'Fecha y hora de inicio en formato ISO 8601 con timezone America/Bogota (ej: 2026-02-15T14:00:00-05:00)',
        },
        date_of_birth: {
          type: 'string',
          description: 'Fecha de nacimiento del paciente en formato YYYY-MM-DD (ej: 1990-03-15)',
        },
        document_type: {
          type: 'string',
          enum: ['CC', 'TI', 'CE', 'PP', 'RC'],
          description: 'Tipo de documento: CC (Cédula Ciudadanía), TI (Tarjeta Identidad), CE (Cédula Extranjería), PP (Pasaporte), RC (Registro Civil)',
        },
        document_number: {
          type: 'string',
          description: 'Número de documento sin puntos, comas ni espacios (solo dígitos)',
        },
        patient_address: {
          type: 'string',
          description: 'Dirección de residencia del paciente (opcional)',
        },
        patient_secondary_phone: {
          type: 'string',
          description: 'Teléfono adicional de contacto, diferente al de WhatsApp (opcional)',
        },
        patient_email: {
          type: 'string',
          description: 'Correo electrónico del paciente (opcional)',
        },
        patient_eps: {
          type: 'string',
          description: 'EPS a la que pertenece el paciente (opcional)',
        },
        procedure_entity: {
          type: 'string',
          description: 'Entidad por la que realiza el procedimiento: EPS, particular, póliza, ARL, SOAT (opcional)',
        },
        reason: {
          type: 'string',
          description: 'Motivo de la consulta (opcional)',
        },
        consultation_type_id: {
          type: 'string',
          description: 'ID UUID del tipo de consulta seleccionado. Determina la duración de la cita. Opcional.',
        },
        modality: {
          type: 'string',
          enum: ['presencial', 'virtual'],
          description: 'Modalidad de la cita. Usar "virtual" si el paciente eligió consulta por videollamada. Default: presencial.',
        },
        free_text_reason: {
          type: 'string',
          description: 'Motivo o diagnóstico escrito por el paciente. Obligatorio si el tipo de consulta tiene requires_free_text_reason=true.',
        },
      },
      required: ['doctor_id', 'patient_name', 'patient_phone', 'starts_at', 'date_of_birth', 'document_type', 'document_number'],
    },
  },
  {
    name: 'get_patient_appointments',
    description:
      'Obtiene las citas futuras (confirmadas) de un paciente. ' +
      'Úsala cuando el paciente pregunta por sus citas o quiere cancelar/reagendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patient_phone: {
          type: 'string',
          description: 'Teléfono del paciente con código de país (ej: +573101112233)',
        },
      },
      required: ['patient_phone'],
    },
  },
  {
    name: 'cancel_appointment',
    description:
      'Cancela una cita existente. Pedir confirmación al paciente antes de cancelar. ' +
      'Después de cancelar, ofrecer reagendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: {
          type: 'string',
          description: 'ID UUID de la cita a cancelar',
        },
        reason: {
          type: 'string',
          description: 'Motivo de la cancelación',
        },
      },
      required: ['appointment_id', 'reason'],
    },
  },
  {
    name: 'reschedule_appointment',
    description:
      'Reagenda una cita a una nueva fecha/hora. La cita anterior se marca como "rescheduled". ' +
      'Confirmar la nueva fecha con el paciente antes de ejecutar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: {
          type: 'string',
          description: 'ID UUID de la cita a reagendar',
        },
        new_starts_at: {
          type: 'string',
          description: 'Nueva fecha y hora en formato ISO 8601 con timezone (ej: 2026-02-16T10:00:00-05:00)',
        },
      },
      required: ['appointment_id', 'new_starts_at'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Escala la conversación a un humano del consultorio. Usar cuando: ' +
      '1. El paciente pide hablar con alguien (después de 1 intento de retención) ' +
      '2. Emergencia médica (después de dar instrucciones del 123) ' +
      '3. Ideación suicida (después de dar Línea 106) ' +
      '4. Tema que no puedes resolver',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Por qué se escala (para que el humano tenga contexto)',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'emergency'],
          description: 'Nivel de urgencia. emergency = riesgo de vida',
        },
      },
      required: ['reason', 'urgency'],
    },
  },
  {
    name: 'add_to_waitlist',
    description:
      'Agrega al paciente a la lista de espera cuando NO hay disponibilidad, o cuando el doctor tiene disponibilidad manual. ' +
      'Si se cancela una cita, el sistema notifica automáticamente al siguiente en la lista. ' +
      'Úsala después de verificar disponibilidad y no encontrar horarios, o para doctores con schedule_type "manual".',
    input_schema: {
      type: 'object' as const,
      properties: {
        doctor_id: {
          type: 'string',
          description: 'ID UUID del doctor',
        },
        patient_phone: {
          type: 'string',
          description: 'Teléfono del paciente con código de país',
        },
        preferred_dates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fechas preferidas en formato YYYY-MM-DD',
        },
        preferred_time: {
          type: 'string',
          enum: ['morning', 'afternoon', 'any'],
          description: 'Preferencia de horario: mañana, tarde, o cualquiera',
        },
        reason: {
          type: 'string',
          description: 'Motivo de consulta o tipo de consulta solicitado',
        },
        preferred_schedule_notes: {
          type: 'string',
          description: 'Notas de preferencia de horario del paciente (ej: "mañanas de lunes a miércoles", "tardes preferiblemente"). Usar para doctores con disponibilidad manual.',
        },
        consultation_type_name: {
          type: 'string',
          description: 'Nombre del tipo de consulta solicitado (ej: "Consulta general", "Ecografía")',
        },
      },
      required: ['doctor_id', 'patient_phone'],
    },
  },
  {
    name: 'check_eps_convenio',
    description:
      'Verifica si la clínica tiene convenio con una EPS/aseguradora. ' +
      'Úsala DESPUÉS de que el paciente diga su EPS y ANTES de proponer horarios. ' +
      'Si no hay convenio, informa al paciente y ofrece agendar como particular.',
    input_schema: {
      type: 'object' as const,
      properties: {
        eps_name: {
          type: 'string',
          description: 'Nombre de la EPS o aseguradora que el paciente mencionó (ej: "Suramericana", "Coomeva", "Sanitas")',
        },
      },
      required: ['eps_name'],
    },
  },
]
