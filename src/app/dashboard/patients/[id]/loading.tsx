function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function PatientDetailLoading() {
  return (
    <div className="space-y-6">
      <Pulse style={{ width: '180px', height: '14px' }} />
      <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-xl)', padding: '28px' }}>
        <div className="flex gap-6">
          <Pulse style={{ width: '80px', height: '80px', borderRadius: '24px' }} />
          <div style={{ flex: 1 }}>
            <Pulse style={{ width: '200px', height: '24px', marginBottom: '8px' }} />
            <Pulse style={{ width: '300px', height: '12px', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '6px' }}><Pulse style={{ width: '60px', height: '20px', borderRadius: '999px' }} /><Pulse style={{ width: '80px', height: '20px', borderRadius: '999px' }} /></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map((i) => <div key={i} style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', padding: '18px' }}><Pulse style={{ width: '80px', height: '10px', marginBottom: '8px' }} /><Pulse style={{ width: '50px', height: '22px' }} /></div>)}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>{[1,2,3,4].map((i) => <Pulse key={i} style={{ width: '100px', height: '34px', borderRadius: '999px' }} />)}</div>
      <Pulse style={{ width: '100%', height: '300px', borderRadius: 'var(--v2-radius-lg)' }} />
    </div>
  )
}
