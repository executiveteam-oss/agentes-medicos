// ============================================================
// Middleware de Next.js — Autenticación y permisos por ruta
// Refresca la sesión de Supabase en cada request
// Redirige si no hay sesión o si faltan permisos
// ============================================================

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Mapeo de rutas a módulos de permisos
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/dashboard/noshow': 'noshow',
  '/dashboard/cartera': 'cartera',
  '/dashboard/facturacion': 'facturacion',
  '/dashboard/espera': 'espera',
  '/dashboard/patients': 'patients',
  '/dashboard/conversations': 'conversations',
  '/dashboard/settings': 'user_management',
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  // Crear cliente Supabase con cookies para refrescar el token automáticamente
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refrescar sesión (importante para tokens expirados)
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Rutas que requieren sesión
  const requiresAuth =
    pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding')

  // Rutas solo para no-autenticados
  const authOnlyRoutes = pathname === '/login' || pathname === '/register'

  // /invite/accept con ?token= NO requiere sesión (flujo token propio)
  // /invite/accept sin ?token= SÍ requiere sesión (flujo legacy Supabase)
  const isInviteWithToken = pathname.startsWith('/invite/accept') && request.nextUrl.searchParams.has('token')
  const isInviteLegacy = pathname.startsWith('/invite/accept') && !request.nextUrl.searchParams.has('token')

  if (!user && (requiresAuth || isInviteLegacy)) {
    // Sin sesión → redirigir a login
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  // Token invites pasan sin sesión — se ignora el check
  if (isInviteWithToken && !user) {
    return response
  }

  if (user && authOnlyRoutes) {
    // Ya autenticado → redirigir al dashboard
    const dashboardUrl = request.nextUrl.clone()
    dashboardUrl.pathname = '/dashboard'
    return NextResponse.redirect(dashboardUrl)
  }

  // Verificar permisos por módulo (solo si hay sesión)
  // Nota: la verificación completa de permisos se hace en el layout del dashboard
  // porque el middleware no tiene acceso al supabaseAdmin (evitamos service_role en edge)

  return response
}

export const config = {
  matcher: [
    // Excluir archivos estáticos, imágenes y rutas de API internas
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
