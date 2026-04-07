// ============================================================
// Conector HIS: Isalud
// Estado: Placeholder — pendiente documentación API
//
// Cuando tengamos la API de Isalud, implementar cada método:
// - createAppointment: POST a su endpoint de citas
// - cancelAppointment: DELETE/PATCH en su API
// - syncPatient: POST/PUT paciente
// - testConnection: GET a endpoint de health/auth
// ============================================================

import type { HISConnector, ExternalAppointmentResult, ExternalPatientResult } from './index'
import { IntegrationNotImplementedError } from './index'
import type { HisCredentials } from '@/types/database'

export class IsaludConnector implements HISConnector {
  name = 'Isalud'
  private credentials: HisCredentials

  constructor(credentials: HisCredentials) {
    this.credentials = credentials
  }

  async createAppointment(): Promise<ExternalAppointmentResult> {
    // TODO: Implementar con API de Isalud
    // Ejemplo esperado:
    //   const response = await fetch(`${this.credentials.api_url}/api/citas`, {
    //     method: 'POST',
    //     headers: { 'Authorization': `Bearer ${this.credentials.api_key}`, 'X-Clinic': this.credentials.clinic_code },
    //     body: JSON.stringify({ paciente, fecha, doctor })
    //   })
    //   const data = await response.json()
    //   return { externalId: data.id, virtualLink: data.link_virtual }
    throw new IntegrationNotImplementedError('Isalud')
  }

  async cancelAppointment(): Promise<void> {
    throw new IntegrationNotImplementedError('Isalud')
  }

  async getVirtualLink(): Promise<string | null> {
    throw new IntegrationNotImplementedError('Isalud')
  }

  async syncPatient(): Promise<ExternalPatientResult> {
    throw new IntegrationNotImplementedError('Isalud')
  }

  async testConnection(credentials: HisCredentials): Promise<boolean> {
    // TODO: Implementar con API de Isalud
    // Ejemplo esperado:
    //   const response = await fetch(`${credentials.api_url}/api/health`, {
    //     headers: { 'Authorization': `Bearer ${credentials.api_key}` }
    //   })
    //   return response.ok
    console.log('[Isalud] testConnection — pendiente de implementación', credentials.api_url)
    throw new IntegrationNotImplementedError('Isalud')
  }
}
