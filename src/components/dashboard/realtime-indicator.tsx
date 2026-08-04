'use client'

// Banner de "sin conexión en vivo". El caller lo muestra según el `connected`
// de useRealtimeConnection. Cuando está conectado no renderiza nada.
export function RealtimeIndicator({ connected }: { connected: boolean }): React.JSX.Element | null {
  if (connected) return null
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 14px', borderRadius: '8px',
        background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412',
        fontSize: '13px', fontWeight: 600, marginBottom: '12px',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ea580c', display: 'inline-block', flexShrink: 0 }} />
      Sin conexión en vivo — reintentando… Puede que no veas mensajes nuevos hasta reconectar.
    </div>
  )
}
