// ============================================================
// Generate .ics (iCalendar) files for appointment events
// RFC 5545 compliant with VTIMEZONE, VALARM, ORGANIZER
// ============================================================

export interface ICSInput {
  appointmentId: string
  startsAt: string       // ISO timestamp
  endsAt: string         // ISO timestamp
  doctorName: string
  consultationType?: string | null
  clinicName: string
  clinicAddress?: string | null
  clinicCity?: string | null
  sequence: number       // 0 = new, 1+ = updated
  isVirtual?: boolean
}

/**
 * Generate a CONFIRMED/REQUEST .ics for a new or rescheduled appointment.
 */
export function generateConfirmICS(input: ICSInput): string {
  const summary = buildSummary(input.consultationType, input.doctorName)
  const location = input.isVirtual ? null : buildLocation(input.clinicAddress, input.clinicCity)
  const description = buildDescription(input.doctorName, input.consultationType, input.clinicName, location, input.isVirtual)

  return buildICS({
    uid: `${input.appointmentId}@omuwan.co`,
    method: 'REQUEST',
    status: 'CONFIRMED',
    summary,
    location,
    description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    sequence: input.sequence,
    clinicName: input.clinicName,
    alarms: [
      { trigger: '-P1D', text: `Cita mañana: ${summary}` },
      { trigger: '-PT1H', text: `Cita en 1 hora: ${summary}` },
    ],
  })
}

/**
 * Generate a CANCELLED .ics to remove the event from patient's calendar.
 */
export function generateCancelICS(input: ICSInput): string {
  const summary = `CANCELADA: ${buildSummary(input.consultationType, input.doctorName)}`

  return buildICS({
    uid: `${input.appointmentId}@omuwan.co`,
    method: 'CANCEL',
    status: 'CANCELLED',
    summary,
    location: null,
    description: null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    sequence: input.sequence,
    clinicName: input.clinicName,
    alarms: [],
  })
}

// ---- Internal helpers ----

function buildSummary(consultationType: string | null | undefined, doctorName: string): string {
  if (consultationType) return `Cita: ${consultationType} - ${doctorName}`
  return `Cita médica - ${doctorName}`
}

function buildLocation(address: string | null | undefined, city: string | null | undefined): string | null {
  if (!address) return null
  return city ? `${address}, ${city}` : address
}

function buildDescription(
  doctorName: string,
  consultationType: string | null | undefined,
  clinicName: string,
  location: string | null,
  isVirtual?: boolean,
): string {
  const lines: string[] = []
  lines.push(`Cita médica con ${doctorName}`)
  if (consultationType) lines.push(consultationType)
  lines.push('')
  lines.push(clinicName)
  if (location) lines.push(location)
  if (isVirtual) lines.push('Cita virtual — recibirás el enlace 30 min antes')
  lines.push('')
  lines.push('Si necesitas cambiar tu cita, escríbenos por WhatsApp.')
  return lines.join('\\n')
}

function formatICSDate(isoStr: string): string {
  // Convert ISO timestamp to local Colombia time formatted as YYYYMMDDTHHMMSS
  const d = new Date(isoStr)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000) // UTC-5
  const y = col.getUTCFullYear()
  const mo = String(col.getUTCMonth() + 1).padStart(2, '0')
  const da = String(col.getUTCDate()).padStart(2, '0')
  const h = String(col.getUTCHours()).padStart(2, '0')
  const mi = String(col.getUTCMinutes()).padStart(2, '0')
  const s = String(col.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${da}T${h}${mi}${s}`
}

function formatDStamp(): string {
  const d = new Date()
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeICS(str: string): string {
  return str.replace(/,/g, '\\,').replace(/;/g, '\\;')
}

interface ICSEvent {
  uid: string
  method: 'REQUEST' | 'CANCEL'
  status: 'CONFIRMED' | 'CANCELLED'
  summary: string
  location: string | null
  description: string | null
  startsAt: string
  endsAt: string
  sequence: number
  clinicName: string
  alarms: { trigger: string; text: string }[]
}

function buildICS(event: ICSEvent): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Omuwan//Cita Medica//ES',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
    // VTIMEZONE for America/Bogota (no DST)
    'BEGIN:VTIMEZONE',
    'TZID:America/Bogota',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'TZNAME:COT',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatDStamp()}`,
    `DTSTART;TZID=America/Bogota:${formatICSDate(event.startsAt)}`,
    `DTEND;TZID=America/Bogota:${formatICSDate(event.endsAt)}`,
    `SUMMARY:${escapeICS(event.summary)}`,
    `STATUS:${event.status}`,
    `SEQUENCE:${event.sequence}`,
    `ORGANIZER;CN=${escapeICS(event.clinicName)}:mailto:noreply@omuwan.co`,
  ]

  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`)
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`)
  }

  for (const alarm of event.alarms) {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:${alarm.trigger}`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeICS(alarm.text)}`,
      'END:VALARM',
    )
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.join('\r\n')
}
