import type { MetadataRoute } from 'next'

// ============================================================
// Manifest de la aplicación — "Agregar a la pantalla de inicio".
//
// PARA QUÉ: la campana del dashboard es el ÚNICO canal por el que el staff se
// entera de una escalación (se quitó el aviso por WhatsApp). Si para mirarla de
// noche hay que abrir el navegador, buscar la URL y loguearse, no lo van a
// hacer. Instalado, es un toque desde la pantalla de inicio.
//
// Y protege la sesión: iOS puede limpiar el storage de sitios que no se visitan
// en 7 días, pero NO el de una app instalada en la pantalla de inicio. Como el
// refresh token de Supabase no vence (verificado contra auth.sessions: 0 con
// `not_after`, una sesión real de 42 días que sobrevivió un hueco de 4,2 días
// sin uso), instalarlo es lo que hace que "abrir y ya estar adentro" se sostenga
// en el tiempo.
//
// ÍCONO DE OMUWAN, NO DE LA CLÍNICA: el manifest es por APLICACIÓN y se sirve
// igual para todos los clientes. Un ícono por clínica exigiría volverlo dinámico
// (ruta por tenant, resolución del subdominio); decisión tomada de no hacerlo.
//
// start_url apunta a la BANDEJA, no al dashboard: es la pantalla por la que se
// abre la app de noche. Si la sesión caducó, el middleware redirige al login.
// ============================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Omuwan — Agente IA para consultorios',
    short_name: 'Omuwan',
    description: 'Bandeja de conversaciones, alertas y agenda del consultorio.',
    start_url: '/dashboard/conversations',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#6B5BFF',
    lang: 'es',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` deja que Android recorte el ícono a la forma del launcher sin
      // comerse el logo. Se declara sobre el mismo archivo a propósito: el logo
      // ya viene con margen suficiente en el PNG de 1024 del que salieron.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
