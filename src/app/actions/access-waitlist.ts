'use server'

// ============================================================
// Server Action — Solicitud de acceso anticipado (waitlist)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/client'

interface WaitlistInput {
  fullName: string
  clinicName: string
  city: string
  email: string
  whatsapp: string
  specialty: string
  doctorRange: string
}

export async function submitAccessRequest(input: WaitlistInput): Promise<{ ok: boolean; error?: string }> {
  const { fullName, clinicName, city, email, whatsapp, specialty, doctorRange } = input

  if (!fullName || !clinicName || !city || !email || !whatsapp) {
    return { ok: false, error: 'Todos los campos obligatorios son requeridos' }
  }

  // 1. Guardar en DB
  const { error: dbError } = await supabaseAdmin
    .from('access_waitlist')
    .insert({
      full_name: fullName,
      clinic_name: clinicName,
      city,
      email,
      whatsapp,
      specialty: specialty || null,
      doctor_range: doctorRange || null,
      status: 'pending',
    })

  if (dbError) {
    console.error('[AccessWaitlist] DB error:', dbError.message)
    return { ok: false, error: 'Error guardando solicitud. Intenta de nuevo.' }
  }

  // 2. Email al solicitante
  await sendEmail({
    to: email,
    subject: 'Tu solicitud de acceso a Omuwan fue recibida',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
        <p>Hola ${fullName},</p>
        <p>Gracias por tu interés en Omuwan.</p>
        <p>Recibimos tu solicitud para <strong>${clinicName}</strong> y la estamos revisando. Te contactaremos en menos de 24 horas por WhatsApp al número que nos dejaste.</p>
        <p>Mientras tanto, si tienes alguna pregunta puedes escribirnos directamente:</p>
        <p>
          <strong>WhatsApp:</strong> +57 301 552 5881<br/>
          <strong>Email:</strong> executive.team@loncocapital.com
        </p>
        <p style="color: #64748b; margin-top: 2rem;">— El equipo de Omuwan</p>
      </div>
    `,
  })

  // 3. Email de notificación a Juan
  const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
  await sendEmail({
    to: 'executive.team@loncocapital.com',
    subject: `Nueva solicitud de acceso — ${clinicName}`,
    html: `
      <div style="font-family: monospace; font-size: 14px; color: #1e293b;">
        <p><strong>Nueva solicitud de acceso anticipado:</strong></p>
        <table style="border-collapse: collapse;">
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Nombre</td><td>${fullName}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Consultorio</td><td>${clinicName}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Ciudad</td><td>${city}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Email</td><td>${email}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">WhatsApp</td><td>${whatsapp}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Especialidad</td><td>${specialty || '—'}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Médicos</td><td>${doctorRange || '—'}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Fecha</td><td>${now}</td></tr>
        </table>
      </div>
    `,
  })

  return { ok: true }
}
