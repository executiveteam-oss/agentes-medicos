'use client'

import { useState, useEffect } from 'react'

/**
 * Fuerza un re-render cada `intervalMs` (default 60s) para que los cálculos de
 * tiempo relativo ("esperando hace Xh") se recalculen solos, sin depender de un
 * evento de realtime. Cero red — solo re-render.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
