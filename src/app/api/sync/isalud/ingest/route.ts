// ============================================================
// Ingest endpoint — receives scraped data from GitHub Actions
// No Playwright here — only DB operations
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { ingestISaludData } from '@/lib/isalud/sync-agent'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    secret: string
    clinicId: string
    profesionales: Array<{
      nombre: string
      puntos_atencion: string[]
      slots: Array<{ dia_semana: number; hora_inicio: string; hora_fin: string; fecha: string }>
    }>
    admisiones: Array<{
      id: string; identificacion: string; nombre_paciente: string
      procedimiento: string; aseguradora: string; profesional_nombre: string
      ubicacion: string; hora_inicial: string; fase: string; fecha: string
    }>
  }

  // Verify secret
  if (!body.secret || body.secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (!body.clinicId || !body.profesionales || !body.admisiones) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  }

  console.log(`[iSalud Ingest] Received: ${body.profesionales.length} profs, ${body.admisiones.length} admisiones for clinic ${body.clinicId}`)

  const result = await ingestISaludData(body.clinicId, body.profesionales, body.admisiones)

  return NextResponse.json(result)
}
