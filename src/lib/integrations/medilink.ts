// ============================================================
// Conector HIS: Medilink
// Estado: Placeholder — pendiente documentación API
//
// Credenciales esperadas:
//   subdomain: subdominio de la instancia Medilink
//   token: token de autenticación
// ============================================================

import type { HISConnector, ExternalAppointmentResult, ExternalPatientResult } from './index'
import { IntegrationNotImplementedError } from './index'
import type { HisCredentials } from '@/types/database'

export class MedilinkConnector implements HISConnector {
  name = 'Medilink'
  private credentials: HisCredentials

  constructor(credentials: HisCredentials) {
    this.credentials = credentials
  }

  async createAppointment(): Promise<ExternalAppointmentResult> {
    throw new IntegrationNotImplementedError('Medilink')
  }

  async cancelAppointment(): Promise<void> {
    throw new IntegrationNotImplementedError('Medilink')
  }

  async getVirtualLink(): Promise<string | null> {
    throw new IntegrationNotImplementedError('Medilink')
  }

  async syncPatient(): Promise<ExternalPatientResult> {
    throw new IntegrationNotImplementedError('Medilink')
  }

  async testConnection(credentials: HisCredentials): Promise<boolean> {
    console.log('[Medilink] testConnection — pendiente de implementación', credentials.subdomain)
    throw new IntegrationNotImplementedError('Medilink')
  }
}
