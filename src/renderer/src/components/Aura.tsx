import { useEffect, useState } from 'react'
import { auraState, onAura, type AuraState } from '../aura'

const LABEL: Record<AuraState, string> = {
  idle: '',
  listen: 'Micrófono o altavoz activo',
  busy: 'Transcribiendo…',
  done: 'Listo'
}

/**
 * Brillo en el borde de toda la pantalla según el audio (ver aura.ts). No intercepta toques y lo
 * anuncia a los lectores de pantalla.
 */
export function Aura(): JSX.Element {
  const [state, setState] = useState<AuraState>(auraState())
  useEffect(() => onAura(setState), [])
  return (
    <>
      <div className={`aura ${state}`} aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">{LABEL[state]}</span>
    </>
  )
}
