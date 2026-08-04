// ============================================================
// Ruta pública /cita/{token} — link del .ics que le llega al paciente.
//
// No expone el signed URL crudo: al tocar el link, genera un signed URL de
// 60s y redirige (302). Si la cita ya pasó (archivo purgado) o el token no
// existe, muestra una página amable en vez del error JSON de Supabase.
//
// Sin auth (el paciente no está logueado). Seguridad = token UUID aleatorio
// de 122 bits, imposible de adivinar. Acceso a Storage vía service_role.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const BUCKET = 'calendar-invites'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Página amable para link vencido/purgado/inválido. Sin datos del paciente.
function gonePage(): NextResponse {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enlace no disponible</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: -apple-system, system-ui, sans-serif; background:#f5f5f4; color:#1c1917; padding:24px; }
  @media (prefers-color-scheme: dark){ body{ background:#1c1917; color:#f5f5f4; } }
  .card { max-width:340px; text-align:center; }
  .emoji { font-size:44px; }
  h1 { font-size:20px; margin:12px 0 8px; }
  p { font-size:15px; line-height:1.5; opacity:.8; margin:0; }
</style></head>
<body><div class="card">
  <div class="emoji">📅</div>
  <h1>Este enlace ya no está disponible</h1>
  <p>Si necesitas tu cita, escríbenos por WhatsApp y con gusto te la reenviamos.</p>
</div></body></html>`
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params
  if (!UUID_RE.test(token)) return gonePage()

  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, calendar_ics_path')
    .eq('calendar_ics_path', `${token}.ics`)
    .maybeSingle()

  // No existe (purgado o inválido) o la cita ya pasó → página amable.
  if (!apt?.calendar_ics_path || new Date(apt.starts_at).getTime() < Date.now()) {
    return gonePage()
  }

  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(`${token}.ics`, 60, { download: 'cita.ics' })

  if (error || !signed?.signedUrl) return gonePage()

  return NextResponse.redirect(signed.signedUrl, 302)
}
