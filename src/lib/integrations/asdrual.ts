// ============================================================
// Conector HIS: Asdrual Gutiérrez
// Estado: Placeholder — pendiente documentación API
//
// Credenciales esperadas:
//   api_url: URL del servidor Asdrual
//   username: usuario de acceso
//   password: contraseña
// ============================================================

import type { HISConnector, ExternalAppointmentResult, ExternalPatientResult } from './index'
import { IntegrationNotImplementedError } from './index'
import type { HisCredentials } from '@/types/database'

export class AsdrualConnector implements HISConnector {
  name = 'Asdrual Gutiérrez'
  private credentials: HisCredentials

  constructor(credentials: HisCredentials) {
    this.credentials = credentials
  }

  async createAppointment(): Promise<ExternalAppointmentResult> {
    throw new IntegrationNotImplementedError('Asdrual Gutiérrez')
  }

  async cancelAppointment(): Promise<void> {
    throw new IntegrationNotImplementedError('Asdrual Gutiérrez')
  }

  async getVirtualLink(): Promise<string | null> {
    throw new IntegrationNotImplementedError('Asdrual Gutiérrez')
  }

  async syncPatient(): Promise<ExternalPatientResult> {
    throw new IntegrationNotImplementedError('Asdrual Gutiérrez')
  }

  async testConnection(credentials: HisCredentials): Promise<boolean> {
    console.log('[Asdrual] testConnection — pendiente de implementación', credentials.api_url)
    throw new IntegrationNotImplementedError('Asdrual Gutiérrez')
  }
}
