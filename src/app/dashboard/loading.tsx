// ============================================================
// Dashboard loading skeleton — v2
// ============================================================

function Pulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }}
    />
  )
}

function SkeletonCard({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        padding: '20px',
        ...style,
      }}
    >
      <Pulse style={{ width: '36px', height: '36px', borderRadius: '12px', marginBottom: '12px' }} />
      <Pulse style={{ width: '80px', height: '10px', marginBottom: '8px' }} />
      <Pulse style={{ width: '48px', height: '24px', marginBottom: '6px' }} />
      <Pulse style={{ width: '100px', height: '10px' }} />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--v2-border-soft)' }}>
      <Pulse style={{ width: '60px', height: '14px' }} />
      <Pulse style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
      <div style={{ flex: 1 }}>
        <Pulse style={{ width: '120px', height: '12px', marginBottom: '6px' }} />
        <Pulse style={{ width: '180px', height: '10px' }} />
      </div>
      <Pulse style={{ width: '50px', height: '18px', borderRadius: '999px' }} />
    </div>
  )
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Pulse style={{ width: '260px', height: '28px', marginBottom: '8px' }} />
          <Pulse style={{ width: '200px', height: '14px' }} />
        </div>
        <Pulse style={{ width: '180px', height: '36px', borderRadius: '12px' }} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Upcoming */}
        <div
          style={{
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <Pulse style={{ width: '120px', height: '14px' }} />
          </div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Escalated */}
          <div
            style={{
              background: 'var(--v2-bg-card)',
              border: '1px solid var(--v2-border-soft)',
              borderRadius: 'var(--v2-radius-lg)',
              padding: '20px',
            }}
          >
            <Pulse style={{ width: '160px', height: '14px', marginBottom: '16px' }} />
            <Pulse style={{ width: '100%', height: '40px', marginBottom: '8px' }} />
            <Pulse style={{ width: '100%', height: '40px' }} />
          </div>

          {/* Agent */}
          <div
            style={{
              background: 'var(--v2-bg-card)',
              border: '1px solid var(--v2-border-soft)',
              borderRadius: 'var(--v2-radius-lg)',
              padding: '20px',
            }}
          >
            <Pulse style={{ width: '140px', height: '14px', marginBottom: '16px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <Pulse style={{ width: '40px', height: '24px', margin: '0 auto 6px' }} />
                <Pulse style={{ width: '60px', height: '10px', margin: '0 auto' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <Pulse style={{ width: '40px', height: '24px', margin: '0 auto 6px' }} />
                <Pulse style={{ width: '60px', height: '10px', margin: '0 auto' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <Pulse style={{ width: '40px', height: '24px', margin: '0 auto 6px' }} />
                <Pulse style={{ width: '60px', height: '10px', margin: '0 auto' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
