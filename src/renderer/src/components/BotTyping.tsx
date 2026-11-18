// Robot que escribe: aparece centrado sobre un campo de texto mientras la app transcribe o redacta.
// Es la señal de «estoy trabajando» de todas las herramientas de voz (Dictado, Audio, Reuniones,
// Traducción). Estilo de caricatura: cabeza con orejas y antena, ojos grandes, chip «AI» en el
// pecho y brazos con pinzas. Saluda con una mano y con la otra escribe renglones en una hoja, con
// la mirada siguiendo el lápiz. El trazo del brazo usa SMIL (sigue a la punta del lápiz); con
// «reducir movimiento» se dibuja quieto.

const STILL = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Recorrido de la punta del lápiz: tres renglones y vuelta al inicio. */
const T = '0;.25;.3;.55;.6;.85;1'
const PEN_X = [76, 100, 76, 96, 76, 102, 76]
const PEN_Y = [60, 60, 68, 68, 76, 76, 60]
const DUR = '3.6s'

export function BotTyping({ label, small = false }: { label: string; small?: boolean }): JSX.Element {
  // La mano queda 4 px a la izquierda y 7 px arriba de la punta del lápiz.
  const handX = PEN_X.map((x) => x - 4)
  const handY = PEN_Y.map((y) => y - 7)
  return (
    <div className={`bot-typing ${small ? 'small' : ''}`} role="status" aria-live="polite">
      <svg className="bot" viewBox="0 0 120 104" aria-hidden="true">
        <ellipse cx="38" cy="99" rx="22" ry="3" className="bot-shadow" />

        {/* hoja con renglones que se van escribiendo */}
        <g className="bot-paper">
          <rect x="68" y="48" width="46" height="40" rx="4" className="paper" />
          <line x1="76" y1="60" x2="100" y2="60" className="ink" strokeDasharray="24" strokeDashoffset={STILL ? 0 : 24}>
            {!STILL && <animate attributeName="stroke-dashoffset" values="24;0;0;24" keyTimes="0;.25;.95;1" dur={DUR} repeatCount="indefinite" />}
          </line>
          <line x1="76" y1="68" x2="96" y2="68" className="ink" strokeDasharray="20" strokeDashoffset={STILL ? 0 : 20}>
            {!STILL && <animate attributeName="stroke-dashoffset" values="20;20;0;0;20" keyTimes="0;.3;.55;.95;1" dur={DUR} repeatCount="indefinite" />}
          </line>
          <line x1="76" y1="76" x2="102" y2="76" className="ink" strokeDasharray="26" strokeDashoffset={STILL ? 0 : 26}>
            {!STILL && <animate attributeName="stroke-dashoffset" values="26;26;0;0;26" keyTimes="0;.6;.85;.95;1" dur={DUR} repeatCount="indefinite" />}
          </line>
        </g>

        {/* piernas */}
        <g className="bot-joint-stroke">
          <line x1="31" y1="80" x2="29" y2="92" />
          <line x1="45" y1="80" x2="47" y2="92" />
        </g>
        <ellipse cx="27" cy="94" rx="6" ry="3" className="bot-dark" />
        <ellipse cx="49" cy="94" rx="6" ry="3" className="bot-dark" />

        {/* brazo que saluda (gira desde el hombro) */}
        <g className="bot-wave">
          <polyline points="22,58 13,52 11,42" className="bot-arm" />
          <circle cx="13" cy="52" r="2.6" className="bot-joint" />
          <path d="M7.5 41.5 a4 4 0 1 1 7 0" className="bot-claw" />
        </g>

        {/* cuerpo con el chip «AI» */}
        <rect x="31" y="46" width="14" height="5" rx="1.5" className="bot-joint" />
        <rect x="21" y="50" width="34" height="31" rx="7" className="bot-body" />
        <g className="bot-chip">
          {[56, 60, 64, 68].map((y) => <line key={`l${y}`} x1="27" y1={y + 1} x2="30" y2={y + 1} />)}
          {[56, 60, 64, 68].map((y) => <line key={`r${y}`} x1="46" y1={y + 1} x2="49" y2={y + 1} />)}
          <rect x="30" y="55" width="16" height="16" rx="3" className="chip" />
          <text x="38" y="66" textAnchor="middle">AI</text>
        </g>

        {/* cabeza: orejas, cara, ojos que siguen el lápiz y antena */}
        <g className="bot-head">
          <line x1="38" y1="8" x2="38" y2="16" className="bot-arm thin" />
          <circle cx="38" cy="6" r="4" className="bot-led" />
          <rect x="15" y="23" width="6" height="13" rx="2.5" className="bot-joint" />
          <rect x="55" y="23" width="6" height="13" rx="2.5" className="bot-joint" />
          <rect x="19" y="15" width="38" height="29" rx="10" className="bot-body" />
          <g className="bot-eyes">
            <circle cx="30" cy="28" r="6.2" className="eye" />
            <circle cx="46" cy="28" r="6.2" className="eye" />
            <g className="pupils">
              <circle cx="31" cy="29" r="3.2" />
              <circle cx="47" cy="29" r="3.2" />
              {!STILL && <animateTransform attributeName="transform" type="translate" values="0 0;1.6 0;0 .6;1.4 .6;0 1;1.6 1;0 0" keyTimes={T} dur={DUR} repeatCount="indefinite" />}
            </g>
            <circle cx="29.6" cy="27" r="1.1" className="glint" />
            <circle cx="45.6" cy="27" r="1.1" className="glint" />
          </g>
          <path d="M32 37 q6 4 12 0" className="bot-mouth" />
        </g>

        {/* brazo que escribe: el antebrazo sigue a la mano */}
        <polyline points="55,58 62,66" className="bot-arm" />
        <line x1="62" y1="66" x2={handX[0]} y2={handY[0]} className="bot-arm">
          {!STILL && <animate attributeName="x2" values={handX.join(';')} keyTimes={T} dur={DUR} repeatCount="indefinite" />}
          {!STILL && <animate attributeName="y2" values={handY.join(';')} keyTimes={T} dur={DUR} repeatCount="indefinite" />}
        </line>
        <circle cx="62" cy="66" r="2.6" className="bot-joint" />
        <g transform={`translate(${handX[0]} ${handY[0]})`}>
          {!STILL && <animateTransform attributeName="transform" type="translate" values={handX.map((x, i) => `${x} ${handY[i]}`).join(';')} keyTimes={T} dur={DUR} repeatCount="indefinite" />}
          <line x1="0" y1="0" x2="4" y2="7" className="bot-pen" />
          <path d="M3.2 5.6 l1.6 2.6 l-2.4 -0.6 z" className="bot-tip" />
          <circle cx="0" cy="0" r="3.2" className="bot-hand" />
        </g>
      </svg>
      <span className="bot-label">{label}<span className="bot-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
    </div>
  )
}
