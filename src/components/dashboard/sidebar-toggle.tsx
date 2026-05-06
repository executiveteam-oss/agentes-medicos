'use client'

import { Menu } from 'lucide-react'

export function SidebarToggle() {
  function openSidebar() {
    const sidebar = document.getElementById('sidebar')
    const overlay = document.getElementById('sidebar-overlay')
    if (sidebar) {
      sidebar.classList.remove('hidden')
      sidebar.classList.add('flex')
    }
    if (overlay) {
      overlay.classList.remove('hidden')
    }
  }

  return (
    <button
      onClick={openSidebar}
      className="lg:hidden p-2 rounded-lg"
      style={{
        color: 'var(--v2-text-muted)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      aria-label="Abrir menu"
    >
      <Menu size={20} />
    </button>
  )
}

export function SidebarOverlay() {
  function closeSidebar() {
    const sidebar = document.getElementById('sidebar')
    const overlay = document.getElementById('sidebar-overlay')
    if (sidebar) {
      sidebar.classList.add('hidden')
      sidebar.classList.remove('flex')
    }
    if (overlay) {
      overlay.classList.add('hidden')
    }
  }

  return (
    <div
      id="sidebar-overlay"
      className="fixed inset-0 bg-black/30 z-30 hidden lg:hidden"
      onClick={closeSidebar}
    />
  )
}

export function LogoutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className="sidebar-logout-btn"
        style={{
          width: '100%',
          textAlign: 'left' as const,
          padding: '7px 12px',
          borderRadius: '8px',
          fontSize: '12.5px',
          fontWeight: 500,
          color: 'var(--v2-text-subtle)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-manrope), sans-serif',
          transition: 'all 0.15s',
        }}
      >
        Cerrar sesión
      </button>
    </form>
  )
}
