// Iconos de interfaz (línea), para no mezclar emojis con el resto del lenguaje visual.
import type { ReactNode } from 'react'

export type UiGlyph = 'monitor' | 'moon' | 'sun' | 'sparkles' | 'gauge' | 'sliders'

const GLYPHS: Record<UiGlyph, ReactNode> = {
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M8 20h8M12 16.5V20" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 3.5 12.9 9l5.5 1.9-5.5 1.9L11 18.3 9.1 12.8 3.6 10.9 9.1 9Z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8.5 8.5 0 1 1 16 0" />
      <path d="m12 14 4.2-4.2" />
      <circle cx="12" cy="14" r="1.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  )
}

export function UiIcon({ id, size = 16 }: { id: UiGlyph; size?: number }): JSX.Element {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {GLYPHS[id]}
    </svg>
  )
}
