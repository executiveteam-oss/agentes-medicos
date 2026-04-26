function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="card-v2 p-5">
        <Pulse style={{ width: '180px', height: '14px', marginBottom: '8px' }} />
        <Pulse style={{ width: '280px', height: '10px', marginBottom: '20px' }} />
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map((i) => <Pulse key={i} style={{ width: '100%', height: '40px' }} />)}
        </div>
      </div>
      <div className="card-v2 p-5">
        <Pulse style={{ width: '160px', height: '14px', marginBottom: '12px' }} />
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4,5,6].map((i) => <Pulse key={i} style={{ width: '100%', height: '40px' }} />)}
        </div>
      </div>
    </div>
  )
}
