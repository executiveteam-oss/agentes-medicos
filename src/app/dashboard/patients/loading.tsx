function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}

export default function PatientsLoading() {
  return (
    <div className="space-y-6">
      <div><Pulse style={{ width: '220px', height: '28px', marginBottom: '8px' }} /><Pulse style={{ width: '160px', height: '14px' }} /></div>
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}><Pulse style={{ width: '100%', height: '38px' }} /></div>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '6px' }}>
          {[1,2,3,4].map((i) => <Pulse key={i} style={{ width: '90px', height: '30px', borderRadius: '999px' }} />)}
        </div>
        {[1,2,3,4,5,6].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <Pulse style={{ width: '44px', height: '44px', borderRadius: '50%' }} />
            <div style={{ flex: 1 }}><Pulse style={{ width: '140px', height: '14px', marginBottom: '6px' }} /><Pulse style={{ width: '200px', height: '10px' }} /></div>
            <Pulse style={{ width: '40px', height: '24px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
