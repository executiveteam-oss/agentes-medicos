function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function Loading() {
  return (
    <div className="space-y-6">
      <Pulse style={{ width: '220px', height: '28px' }} />
      <Pulse style={{ width: '100%', height: '200px', borderRadius: '18px' }} />
      <Pulse style={{ width: '100%', height: '300px', borderRadius: '18px' }} />
    </div>
  )
}
