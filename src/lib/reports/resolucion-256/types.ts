// ============================================================
// Interfaces del reporte Resolución 256/16.
// Las 12 columnas en orden exacto que PISIS espera.
// ============================================================

import type { Patient, Appointment, ConsultationType, Doctor } from '@/types/database'

/** Un row del reporte, en formato interno (antes de serializar a xlsx) */
export interface Res256Row {
  identificacion: string                  // 'CC' | 'TI' | 'RC' | 'CE' | 'PA' | 'MS' | 'AS' | ''
  numero: string                          // sin ceros a la izquierda; '' si no hay
  fecha_nacimiento: string                // YYYY-MM-DD; '' si no hay
  genero: string                          // 'M' | 'F' | ''
  primer_nombre: string
  segundo_nombre: string                  // puede estar vacío
  primer_apellido: string
  segundo_apellido: string                // puede estar vacío
  codigo_eapb: string                     // 6-char code o 'NA' o ''
  fecha_solicitud_cita: string            // YYYY-MM-DD
  fecha_asignacion: string                // YYYY-MM-DD
  fecha_deseada: string                   // YYYY-MM-DD
}

/** Input para los mappers — appointment + relaciones cargadas */
export interface Res256SourceRow {
  appointment: Pick<Appointment, 'id' | 'starts_at' | 'created_at' | 'requested_at' | 'desired_at' | 'payment_type' | 'eps_name' | 'consultation_type_id' | 'doctor_id'>
  patient: Pick<Patient, 'id' | 'document_type' | 'document_number' | 'date_of_birth' | 'gender' | 'first_name' | 'middle_name' | 'first_last_name' | 'second_last_name' | 'eps' | 'eapb_code' | 'name'> | null
  consultationType: Pick<ConsultationType, 'id' | 'name' | 'res256_category'> | null
  doctor: Pick<Doctor, 'id' | 'name' | 'specialty'> | null
}

/** Resultado del reporte completo */
export interface Res256ReportResult {
  ready: Res256Row[]                      // Pasan validación PISIS
  incomplete: { row: Res256Row; missingFields: string[] }[]
  fromDate: string                        // YYYY-MM-DD
  toDate: string                          // YYYY-MM-DD
  generatedAt: string                     // ISO timestamp
}
