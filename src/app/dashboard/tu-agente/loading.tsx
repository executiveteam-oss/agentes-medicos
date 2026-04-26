function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function TuAgenteLoading() {
  return (
    <div className="space-y-6" style={{ maxWidth: '1100px' }}>
      <div><Pulse style={{ width: '180px', height: '28px', marginBottom: '8px' }} /><Pulse style={{ width: '280px', height: '14px' }} /></div>
      <Pulse style={{ width: '100%', height: '240px', borderRadius: '22px' }} />
      <Pulse style={{ width: '100%', height: '160px', borderRadius: '18px' }} />
      <Pulse style={{ width: '100%', height: '300px', borderRadius: '18px' }} />
      <Pulse style={{ width: '100%', height: '200px', borderRadius: '18px' }} />
    </div>
  )
}
