import { useApp } from '../store'

const BARS: [number, number][] = [[108, 88], [176, 184], [244, 276], [312, 184], [380, 88]]

/** Logo animado: respira en reposo y se agita al grabar, transcribir o redactar. */
export function Logo({ size = 32, active }: { size?: number; active?: boolean }): JSX.Element {
  const busy = useApp((s) => s.recording || s.transcribing > 0 || s.rewriting)
  const live = active ?? busy
  return (
    <svg className={`logo ${live ? 'live' : ''}`} width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="DictaFlow">
      <rect width="512" height="512" rx="112" fill="var(--accent)" />
      {BARS.map(([x, h], i) => (
        <rect key={x} className="bar-anim" x={x} y={256 - h / 2} width="40" height={h} rx="20" fill="#fff" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </svg>
  )
}
