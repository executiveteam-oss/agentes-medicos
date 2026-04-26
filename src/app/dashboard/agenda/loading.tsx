// Agenda loading skeleton

function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}

export default function AgendaLoading() {
  return (
    <div className="space-y-6">
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header skeleton */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', justifyContent: 'space-between' }}>
          <Pulse style={{ width: '200px', height: '32px' }} />
          <Pulse style={{ width: '180px', height: '32px' }} />
        </div>
        {/* Tabs skeleton */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '8px' }}>
          <Pulse style={{ width: '80px', height: '28px', borderRadius: '999px' }} />
          <Pulse style={{ width: '80px', height: '28px', borderRadius: '999px' }} />
          <Pulse style={{ width: '80px', height: '28px', borderRadius: '999px' }} />
        </div>
        {/* Grid skeleton */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Pulse style={{ width: '50px', height: '16px' }} />
              <Pulse style={{ flex: 1, height: '40px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
