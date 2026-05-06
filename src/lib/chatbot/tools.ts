// ============================================================
// Help chatbot tools: navigate_to + log_kb_used (internal)
// ============================================================

import type Anthropic from '@anthropic-ai/sdk'

export const chatbotTools: Anthropic.Messages.Tool[] = [
  {
    name: 'navigate_to',
    description: 'Navega al usuario a una pagina del dashboard de Omuwan. Usa esta tool cuando el usuario quiera ir a una seccion especifica o cuando le estes explicando como hacer algo y quieras llevarlo directamente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Ruta del dashboard. Debe ser una de las rutas validas listadas en el system prompt.',
        },
        label: {
          type: 'string',
          description: 'Nombre legible de la página para mostrar al usuario. Ej: "Configuración de doctores"',
        },
      },
      required: ['path', 'label'],
    },
  },
  {
    name: 'log_kb_used',
    description: "Registra que archivo(s) de KB usaste para responder. SIEMPRE llamala al final de tu respuesta. Si no usaste ningun archivo de la KB, pasa ['unknown'].",
    input_schema: {
      type: 'object' as const,
      properties: {
        kb_files: {
          type: 'array',
          items: { type: 'string' },
          description: "Lista de archivos .md usados, ej: ['configurar-doctores.md']. Si ninguno aplico, ['unknown'].",
        },
      },
      required: ['kb_files'],
    },
  },
]

/** Internal tools that the endpoint intercepts and does NOT stream to the client */
export const INTERNAL_TOOLS = new Set(['log_kb_used'])
