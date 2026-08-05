'use client'

// ============================================================
// <RelativeTime> — texto de tiempo relativo ("hace 3 horas") sin romper la
// hidratación.
//
// EL PROBLEMA: `formatDistanceToNow` depende del RELOJ. El servidor lo calcula
// cuando renderiza y el navegador cuando hidrata; entre esos dos instantes
// pasan segundos, y cruzando un borde ("hace 59 minutos" → "hace 1 hora") los
// dos textos no coinciden → mismatch de hidratación (React #418), que puede
// tirar abajo los efectos del subárbol.
//
// LA SOLUCIÓN (no es suppressHydrationWarning): el servidor y el PRIMER render
// del cliente muestran el timestamp ABSOLUTO en hora Colombia — determinista,
// idéntico de los dos lados. Recién después de montar, un efecto cambia el
// estado al texto relativo y lo refresca solo cada minuto.
// ============================================================

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatUI } from '@/lib/utils/format-time-ui'

export function RelativeTime({
  iso,
  /** Lo que se ve en SSR y en el primer paint (y si el timestamp es inválido). */
  fallbackPattern = 'd MMM, h:mm a',
  addSuffix = true,
  refreshMs = 60_000,
}: {
  iso: string
  fallbackPattern?: string
  addSuffix?: boolean
  refreshMs?: number
}) {
  const [relative, setRelative] = useState<string | null>(null)

  useEffect(() => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return
    const tick = () => setRelative(formatDistanceToNow(d, { addSuffix, locale: es }))
    tick()
    const id = setInterval(tick, refreshMs)
    return () => clearInterval(id)
  }, [iso, addSuffix, refreshMs])

  // null = todavía no montó → mismo string que el servidor.
  return <>{relative ?? formatUI(iso, fallbackPattern)}</>
}
