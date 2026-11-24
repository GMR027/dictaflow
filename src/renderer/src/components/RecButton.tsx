import type { CSSProperties } from 'react'

// Botón de micrófono grande y redondo: la acción principal de cada herramienta de voz. Un anillo
// alrededor sigue el nivel del micrófono mientras graba, para saber que te está oyendo.

export function RecButton({ recording, onClick, level = 0, idle, active, disabled, hint }: {
  recording: boolean
  onClick: () => void
  /** Nivel del micrófono (0–1 aprox., el mismo que usa el medidor). */
  level?: number
  /** Texto accesible y etiqueta bajo el botón. */
  idle: string
  active: string
  disabled?: boolean
  /** Texto pequeño bajo la etiqueta (p. ej. el cronómetro). */
  hint?: string
}): JSX.Element {
  const ring = Math.min(1, level * 6)
  return (
    <div className="recbox">
      <button className={`recbtn ${recording ? 'rec' : ''}`} onClick={onClick} disabled={disabled}
        aria-pressed={recording} aria-label={recording ? active : idle}
        style={{ '--lvl': ring } as CSSProperties}>
        <span className="recbtn-ring" aria-hidden="true" />
        <span className="recbtn-icon" aria-hidden="true">
          {recording
            ? <svg viewBox="0 0 24 24" fill="currentColor" focusable="false"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
            : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
              </svg>
            )}
        </span>
      </button>
      <span className="recbox-label">{recording ? active : idle}</span>
      {hint && <span className="muted recbox-hint">{hint}</span>}
    </div>
  )
}
