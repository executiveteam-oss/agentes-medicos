// ============================================================
// API Route: ejecutar scraping de convenios
// POST /api/isalud/convenios → corre scrapeConvenios para la clínica activa
//
// Necesita timeout extendido (Vercel Pro 5min) porque Playwright
// puede tardar 1-2min en cargar todos los convenios.
// ============================================================

import { NextResponse } from 'next/server'
import { runConveniosImport } from '@/app/actions/isalud-convenios'

export const maxDuration = 300

export async function POST() {
  const result = await runConveniosImport()
  return NextResponse.json(result)
}
