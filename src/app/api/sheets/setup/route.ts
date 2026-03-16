// ============================================================
// API: Crear y vincular Google Sheet a una clínica
// POST /api/sheets/setup { clinicId: "uuid" }
//
// Protegido con CRON_SECRET (para MVP lo llama el developer)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { createClinicSheet, syncClinicSheet } from '@/lib/google-sheets'
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  // Rate limit general
  const ip = getClientIp(request)
  const rateLimit = checkRateLimit(`sheets:${ip}`, RATE_LIMITS.general)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Autenticación: aceptar sesión de usuario O CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const session = await getUserSession()
  const isCronAuth = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !isCronAuth) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { clinicId, sheetId: providedSheetId } = await request.json()

    if (!clinicId) {
      return NextResponse.json({ error: 'clinicId es requerido' }, { status: 400 })
    }

    // Verificar ownership: el clinicId debe coincidir con la sesión del usuario
    if (session && session.clinicId !== clinicId) {
      return NextResponse.json({ error: 'No tienes acceso a esta clínica' }, { status: 403 })
    }

    if (!providedSheetId) {
      return NextResponse.json({
        error: 'sheetId es requerido. Crea un Google Sheet, compártelo con la Service Account como Editor, y envía el ID aquí.',
      }, { status: 400 })
    }

    // 1. Obtener datos de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('id, name, google_sheet_id, doctor_email')
      .eq('id', clinicId)
      .single()

    if (!clinic) {
      return NextResponse.json({ error: 'Clínica no encontrada' }, { status: 404 })
    }

    if (clinic.google_sheet_id) {
      return NextResponse.json({
        error: 'Ya tiene hoja vinculada',
        sheetId: clinic.google_sheet_id,
        url: `https://docs.google.com/spreadsheets/d/${clinic.google_sheet_id}`,
      }, { status: 409 })
    }

    // 2. Configurar el sheet existente con las pestañas y formato
    console.log(`[Sheets:Setup] Configurando hoja para ${clinic.name}...`)
    const sheetId = await createClinicSheet(clinic.name, clinic.doctor_email ?? undefined, providedSheetId)

    // 3. Guardar el ID en la DB
    await supabaseAdmin
      .from('clinics')
      .update({ google_sheet_id: sheetId })
      .eq('id', clinicId)

    // 4. Sync inicial con todos los datos existentes
    console.log(`[Sheets:Setup] Sincronizando datos iniciales...`)
    await syncClinicSheet(clinicId, ['patients', 'appointments', 'finances', 'noshow_stats'])

    console.log(`[Sheets:Setup] Hoja creada y sincronizada para ${clinic.name}`)

    return NextResponse.json({
      status: 'ok',
      sheetId,
      url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    })
  } catch (error) {
    console.error('[Sheets:Setup] Error:', error)
    return NextResponse.json({ error: 'Error creando hoja' }, { status: 500 })
  }
}
