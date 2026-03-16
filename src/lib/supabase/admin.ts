// ============================================================
// Cliente Supabase con service_role — acceso TOTAL a la DB
// SOLO usar en el servidor (API routes, webhooks, cron jobs)
// NUNCA importar en código del cliente/navegador
// ============================================================

import { createClient } from '@supabase/supabase-js'

// Usar placeholders en build-time para que no falle la compilación.
// En runtime las variables reales deben estar configuradas en Vercel.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'

// Singleton: se crea UNA sola vez y se reutiliza en toda la app
// auth: autoRefreshToken y persistSession desactivados porque es server-side
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
