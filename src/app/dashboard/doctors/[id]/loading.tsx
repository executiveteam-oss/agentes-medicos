function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function DoctorDetailLoading() {
  return (
    <div className="space-y-5">
      <Pulse style={{ width: '200px', height: '14px' }} />
      <Pulse style={{ width: '100%', height: '120px', borderRadius: '22px' }} />
      <div style={{ display: 'flex', gap: '6px' }}>{[1,2,3,4].map((i) => <Pulse key={i} style={{ width: '100px', height: '34px', borderRadius: '999px' }} />)}</div>
      <Pulse style={{ width: '100%', height: '300px', borderRadius: '18px' }} />
    </div>
  )
}
