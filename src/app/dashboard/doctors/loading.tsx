function Pulse({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse" style={{ background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', ...style }} />
}
export default function DoctorsLoading() {
  return (
    <div className="space-y-5">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><Pulse style={{ width: '180px', height: '24px' }} /><Pulse style={{ width: '130px', height: '36px', borderRadius: '12px' }} /></div>
      {[1,2,3].map((i) => <Pulse key={i} style={{ width: '100%', height: '88px', borderRadius: '18px' }} />)}
    </div>
  )
}
