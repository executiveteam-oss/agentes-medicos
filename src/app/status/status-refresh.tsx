'use client'

// ============================================================
// Auto-refresh: recarga la página de estado cada 60 segundos
// ============================================================

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function StatusAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 60_000)

    return () => clearInterval(interval)
  }, [router])

  return null
}
