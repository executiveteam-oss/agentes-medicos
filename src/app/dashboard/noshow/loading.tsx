function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}

export default function NoShowLoading() {
  return (
    <div className="space-y-6">
      {/* Header + range */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Pulse style={{ width: '240px', height: '30px' }} />
        <Pulse style={{ width: '260px', height: '34px', borderRadius: '12px' }} />
      </div>

      {/* Hero */}
      <Pulse style={{ width: '100%', height: '260px', borderRadius: '22px' }} />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', padding: '20px' }}>
            <Pulse style={{ width: '36px', height: '36px', borderRadius: '10px', marginBottom: '12px' }} />
            <Pulse style={{ width: '80px', height: '10px', marginBottom: '8px' }} />
            <Pulse style={{ width: '60px', height: '24px' }} />
          </div>
        ))}
      </div>

      {/* Chart + risk */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', padding: '22px' }}>
          <Pulse style={{ width: '200px', height: '14px', marginBottom: '16px' }} />
          <Pulse style={{ width: '100%', height: '240px' }} />
        </div>
        <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <Pulse style={{ width: '180px', height: '14px' }} />
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}>
              <Pulse style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
              <div style={{ flex: 1 }}>
                <Pulse style={{ width: '120px', height: '12px', marginBottom: '6px' }} />
                <Pulse style={{ width: '80px', height: '10px' }} />
              </div>
              <Pulse style={{ width: '30px', height: '24px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
