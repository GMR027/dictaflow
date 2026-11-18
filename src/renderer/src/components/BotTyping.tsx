// Bot que escribe: se muestra centrado sobre un campo de texto mientras la app transcribe o redacta.
// Es la señal de «estoy trabajando» de todas las herramientas de voz (Dictado, Audio, Reuniones,
// Traducción), con los mismos colores que el aura. Con «reducir movimiento» se queda quieto.

export function BotTyping({ label, small = false }: { label: string; small?: boolean }): JSX.Element {
  return (
    <div className={`bot-typing ${small ? 'small' : ''}`} role="status" aria-live="polite">
      <svg className="bot" viewBox="0 0 64 64" aria-hidden="true">
        {/* antena */}
        <line x1="32" y1="6" x2="32" y2="13" className="bot-line" />
        <circle cx="32" cy="5" r="3" className="bot-led" />
        {/* cabeza */}
        <rect x="14" y="13" width="36" height="26" rx="9" className="bot-head" />
        <rect x="19" y="18" width="26" height="15" rx="6" className="bot-face" />
        <g className="bot-eyes">
          <circle cx="27" cy="25.5" r="2.6" />
          <circle cx="37" cy="25.5" r="2.6" />
        </g>
        {/* hoja con renglones que se van escribiendo */}
        <rect x="10" y="43" width="44" height="18" rx="3" className="bot-paper" />
        <line x1="15" y1="49" x2="45" y2="49" className="bot-ink i1" />
        <line x1="15" y1="55" x2="38" y2="55" className="bot-ink i2" />
        {/* brazo con lápiz */}
        <g className="bot-pen">
          <line x1="46" y1="36" x2="40" y2="50" className="bot-line" />
          <path d="M38.6 49.2 l3 1.4 -2.4 3.2 z" className="bot-tip" />
        </g>
      </svg>
      <span className="bot-label">{label}<span className="bot-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
    </div>
  )
}
