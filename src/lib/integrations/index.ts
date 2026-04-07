// ============================================================
// Capa de integración genérica para sistemas HIS externos
//
// Cada conector implementa HISConnector. Cuando tengamos la
// documentación API de un sistema, solo hay que llenar los
// métodos del conector correspondiente.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { HisCredentials, HisIntegrationConfig } from '@/types/database'

// --- Tipos compartidos ---

export interface ExternalAppointmentResult {
  externalId: string
  virtualLink?: string | null
}

export interface ExternalPatientResult {
  externalId: string
}

export interface HISConnector {
  /** Nombre visible del software */
  name: string

  /** Crear cita en el sistema externo */
  createAppointment(params: {
    appointmentId: string
    patientName: string
    patientPhone: string
    patientDocumentNumber?: string | null
    doctorName: string
    startsAt: string
    endsAt: string
    reason?: string | null
  }): Promise<ExternalAppointmentResult>

  /** Cancelar cita en el sistema externo */
  cancelAppointment(externalId: string): Promise<void>

  /** Obtener link de videollamada del sistema externo */
  getVirtualLink(externalId: string): Promise<string | null>

  /** Sincronizar/crear paciente en el sistema externo */
  syncPatient(params: {
    patientName: string
    patientPhone: string
    documentType?: string | null
    documentNumber?: string | null
    email?: string | null
    eps?: string | null
  }): Promise<ExternalPatientResult>

  /** Probar que las credenciales son correctas */
  testConnection(credentials: HisCredentials): Promise<boolean>
}

// --- Error personalizado ---

export class IntegrationNotImplementedError extends Error {
  constructor(softwareName: string) {
    super(
      `Integración con ${softwareName} pendiente de configuración. ` +
      `Contacta a executive.team@loncocapital.com`
    )
    this.name = 'IntegrationNotImplementedError'
  }
}

// --- Registry de conectores ---

import { IsaludConnector } from './isalud'
import { AsdrualConnector } from './asdrual'
import { MedilinkConnector } from './medilink'

const CONNECTORS: Record<string, new (credentials: HisCredentials) => HISConnector> = {
  isalud: IsaludConnector,
  'asdrual gutierrez': AsdrualConnector,
  'asdrual gutiérrez': AsdrualConnector,
  medilink: MedilinkConnector,
}

/**
 * Obtener el conector HIS para una clínica.
 * Retorna null si la clínica no tiene integración activa.
 */
export function getConnector(config: HisIntegrationConfig | undefined): HISConnector | null {
  if (!config) return null
  if (config.status !== 'active') return null

  const key = config.software.toLowerCase()
  const ConnectorClass = CONNECTORS[key]
  if (!ConnectorClass) return null

  return new ConnectorClass(config.credentials)
}

/**
 * Obtener la config de integración HIS para una clínica.
 * Lee directamente de la columna integrations JSONB.
 */
export async function getClinicHisConfig(clinicId: string): Promise<HisIntegrationConfig | undefined> {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('integrations')
    .eq('id', clinicId)
    .single()

  if (!data) return undefined
  const integrations = data.integrations as Record<string, unknown> | null
  return integrations?.his as HisIntegrationConfig | undefined
}

// ============================================================
// Hook: sincronizar cita con HIS externo (fire-and-forget)
// Nunca bloquea el flujo principal de Omuwan
// ============================================================

export async function syncAppointmentToHis(
  clinicId: string,
  appointmentId: string,
  params: {
    patientName: string
    patientPhone: string
    patientDocumentNumber?: string | null
    doctorName: string
    startsAt: string
    endsAt: string
    reason?: string | null
  }
): Promise<void> {
  try {
    const hisConfig = await getClinicHisConfig(clinicId)
    const connector = getConnector(hisConfig)
    if (!connector) return

    const result = await connector.createAppointment({
      appointmentId,
      ...params,
    })

    // Guardar external ID y virtual link (si lo devuelve)
    const updateData: Record<string, unknown> = {
      external_his_id: result.externalId,
    }
    if (result.virtualLink) {
      updateData.virtual_link = result.virtualLink
    }

    await supabaseAdmin
      .from('appointments')
      .update(updateData)
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)

    // Actualizar last_sync
    await updateLastSync(clinicId)

    console.log(`[HIS:Sync] Cita ${appointmentId} sincronizada → external_id: ${result.externalId}`)
  } catch (error) {
    console.error(`[HIS:Sync] Error sincronizando cita ${appointmentId}:`, error)
    // NO lanzar — Omuwan sigue funcionando
  }
}

export async function syncCancelToHis(
  clinicId: string,
  appointmentId: string
): Promise<void> {
  try {
    const hisConfig = await getClinicHisConfig(clinicId)
    const connector = getConnector(hisConfig)
    if (!connector) return

    // Buscar external_his_id de la cita
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('external_his_id')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .single()

    if (!apt?.external_his_id) return

    await connector.cancelAppointment(apt.external_his_id)
    await updateLastSync(clinicId)

    console.log(`[HIS:Sync] Cancelación sincronizada → external_id: ${apt.external_his_id}`)
  } catch (error) {
    console.error(`[HIS:Sync] Error sincronizando cancelación ${appointmentId}:`, error)
  }
}

async function updateLastSync(clinicId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('integrations')
    .eq('id', clinicId)
    .single()

  if (!data) return
  const integrations = (data.integrations ?? {}) as Record<string, unknown>
  const his = (integrations.his ?? {}) as Record<string, unknown>

  await supabaseAdmin
    .from('clinics')
    .update({
      integrations: {
        ...integrations,
        his: { ...his, last_sync: new Date().toISOString() },
      },
    })
    .eq('id', clinicId)
}
