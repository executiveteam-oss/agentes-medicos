// ============================================================
// Contexto del agente — FUENTE ÚNICA de config/doctores/tipos/paciente que
// consume runAppointmentAgent. Extraído del webhook (movimiento PURO, mismo
// comportamiento) para que "devolver al agente" (Etapa 3) re-corra el agente
// con EXACTAMENTE el mismo contexto — sin un segundo camino que responda
// distinto. existingPatient cambió 2 veces en 3 días (entidad, edad):
// duplicarlo garantizaba drift silencioso.
// ============================================================
import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateAgeFromBirthDate } from '@/lib/utils/age'
import { insurerFromRecord } from '@/lib/utils/insurer-from-record'
import { DEFAULT_ESCALATION_KEYWORDS } from '@/lib/whatsapp/default-config'
import { DEFAULT_CRISIS_CONFIG } from '@/lib/safety/crisis-config'
import type { Clinic, ConsultationType, Doctor, Patient, WhatsAppConfig } from '@/types/database'
import type { ResolvedTratante, DoctorInfo } from '@/lib/isalud/tratante-specialty'

/** Extrae y normaliza la config de WhatsApp de la clínica. (Movido del webhook.) */
export function getWhatsAppConfig(clinic: Clinic): WhatsAppConfig {
  const DEFAULT: WhatsAppConfig = {
    schedule: {
      start: '07:00',
      end: '20:00',
      days: [1, 2, 3, 4, 5, 6],
      out_of_hours_message: 'Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana.',
    },
    appointment: { default_duration: 30, max_duration: 60 },
    escalation_keywords: DEFAULT_ESCALATION_KEYWORDS,
    doctors: {},
    automations: {
      post_consulta: { enabled: false },
      reactivacion: { enabled: false, days_inactive: 90 },
    },
    crisis: DEFAULT_CRISIS_CONFIG,
  }
  const raw = (clinic.whatsapp_config as WhatsAppConfig | null)
  if (!raw) return DEFAULT
  return { ...DEFAULT, ...raw, automations: { ...DEFAULT.automations, ...(raw.automations ?? {}) }, crisis: { ...DEFAULT_CRISIS_CONFIG, ...(raw.crisis ?? {}) } }
}

/**
 * Obtiene doctores activos, filtrando por la config de WhatsApp.
 * Si un doctor está marcado como inactivo en config.doctors, se excluye.
 * (Movido del webhook.)
 */
export async function findActiveDoctors(clinicId: string, config: WhatsAppConfig): Promise<Doctor[]> {
  const { data } = await supabaseAdmin
    .from('doctors')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const allDoctors = (data ?? []) as Doctor[]

  // Filtrar por config: si doctor tiene config explícita con active=false, excluir
  return allDoctors.filter((doc) => {
    const docConfig = config.doctors[doc.id]
    return docConfig ? docConfig.active : true
  })
}

/** Carga los tipos de consulta activos de la clínica. (Movido del webhook.) */
export async function findActiveConsultationTypes(clinicId: string): Promise<ConsultationType[]> {
  const { data } = await supabaseAdmin
    .from('consultation_types')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('doctor_id, created_at')

  return (data ?? []) as ConsultationType[]
}

/**
 * Construye los datos de paciente recurrente para el agente. (Movido del webhook.)
 * El REGISTRO llega SIEMPRE (para no re-preguntar lo que ya tenemos); el
 * consentimiento gobierna qué se ENUNCIA, no qué SABE el agente. Separación
 * SABER/ENUNCIAR: cédula → bandera (has_document); fecha de nacimiento → edad;
 * nombre y entidad → valor (insurerFromRecord filtra "PARTICULAR" → null).
 */
export function buildExistingPatient(patient: Patient) {
  return (patient.document_number || patient.total_appointments > 0)
    ? {
        name: patient.name,
        phone: patient.phone,
        has_document: !!patient.document_number,
        edad: calculateAgeFromBirthDate(patient.date_of_birth),
        eps: patient.eps ?? insurerFromRecord(patient.entidad),
        email: patient.email,
        total_appointments: patient.total_appointments ?? 0,
        no_show_count: patient.no_show_count ?? 0,
      }
    : null
}

/**
 * Resuelve tratantes activos por especialidad + loguea misses. (Movido del webhook.)
 * Modo por clínica: off/blando/duro. Un miss (clave que ya no matchea una
 * especialidad real) queda VISIBLE en audit_log — no silencioso.
 */
export async function resolveTratantesForClinic(
  clinic: Clinic,
  patient: Patient,
  conversationId: string,
): Promise<{ tratanteMode: 'off' | 'blando' | 'duro'; tratantes: ResolvedTratante[] }> {
  const tratanteMode = ((clinic.feature_config as Record<string, unknown> | null)?.tratante_mode as 'off' | 'blando' | 'duro' | undefined) ?? 'off'
  let resolvedTratantes: ResolvedTratante[] = []
  if (tratanteMode !== 'off' && patient.tratantes) {
    const { data: allDocs } = await supabaseAdmin.from('doctors')
      .select('id, name, specialty, is_active, agenda_closed').eq('clinic_id', clinic.id)
    const doctorsById = new Map<string, DoctorInfo>()
    ;(allDocs ?? []).forEach((d) => { const x = d as { id: string; name: string; specialty: string | null; is_active: boolean; agenda_closed: boolean | null }; doctorsById.set(x.id, { id: x.id, name: x.name, specialty: x.specialty, is_active: x.is_active, agenda_closed: !!x.agenda_closed }) })
    const { resolveActiveTratantes } = await import('@/lib/isalud/tratante-specialty')
    const resolved = resolveActiveTratantes(patient.tratantes, doctorsById)
    resolvedTratantes = resolved.active
    // Misses VISIBLES: una clave que ya no matchea una especialidad real → no silencioso.
    if (resolved.misses.length > 0) {
      console.warn(`[Webhook] ⚠ tratante lookup miss:`, JSON.stringify(resolved.misses))
      try {
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinic.id, action: 'tratante_lookup_miss', actor_type: 'system',
          details: { conversation_id: conversationId, misses: resolved.misses },
        })
      } catch { /* no crítico */ }
    }
  }
  return { tratanteMode, tratantes: resolvedTratantes }
}
