// ============================================================
// GET /api/reports/resolucion-256?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns xlsx con 2 hojas.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { isValid, parseISO, differenceInDays } from 'date-fns'
import { checkReadPermission } from '@/lib/actions-helpers'
import { fetchSourceRows } from '@/lib/reports/resolucion-256/query'
import { mapSourceRowToRes256Row } from '@/lib/reports/resolucion-256/column-mapping'
import { dedupFirstOfYear } from '@/lib/reports/resolucion-256/dedup'
import { validateRes256Row } from '@/lib/reports/resolucion-256/validate'
import { generateRes256Xlsx } from '@/lib/reports/resolucion-256/xlsx-generator'
import type { Res256ReportResult } from '@/lib/reports/resolucion-256/types'

export async function GET(request: NextRequest) {
  const clinicId = await checkReadPermission('whatsapp')

  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')

  // Validar rango
  if (!from || !to) {
    return NextResponse.json({ error: 'Parámetros "from" y "to" requeridos (YYYY-MM-DD)' }, { status: 400 })
  }
  const fromDate = parseISO(`${from}T12:00:00-05:00`)
  const toDate = parseISO(`${to}T12:00:00-05:00`)
  if (!isValid(fromDate) || !isValid(toDate)) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: '"to" debe ser >= "from"' }, { status: 400 })
  }
  if (differenceInDays(toDate, fromDate) > 366) {
    return NextResponse.json({ error: 'Rango máximo: 1 año' }, { status: 400 })
  }
  if (toDate > new Date()) {
    return NextResponse.json({ error: '"to" no puede ser fecha futura' }, { status: 400 })
  }

  // Query
  const sourceRows = await fetchSourceRows({ clinicId, fromDate: from, toDate: to })

  // Dedup
  const dedupped = dedupFirstOfYear(sourceRows)

  // Map a Res256Row
  const mapped = dedupped.map(mapSourceRowToRes256Row)

  // Validar y separar
  const ready = mapped.filter((r) => validateRes256Row(r).valid)
  const incomplete = mapped
    .map((r) => ({ row: r, validation: validateRes256Row(r) }))
    .filter((x) => !x.validation.valid)
    .map((x) => ({ row: x.row, missingFields: x.validation.missingFields.map((f) => String(f)) }))

  const result: Res256ReportResult = {
    ready,
    incomplete,
    fromDate: from,
    toDate: to,
    generatedAt: new Date().toISOString(),
  }

  // Generar xlsx
  const buf = await generateRes256Xlsx(result)
  const filename = `oportunidad-256-${from}-a-${to}.xlsx`

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Res256-Ready': String(ready.length),
      'X-Res256-Incomplete': String(incomplete.length),
    },
  })
}
