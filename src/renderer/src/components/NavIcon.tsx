// Iconos de línea de la barra de navegación. Un solo lenguaje visual para toda la app, en lugar
// de mezclar emojis con los iconos animados de las herramientas.
import type { ReactNode } from 'react'
import type { View } from '../store'

const ICONS: Record<View | 'more', ReactNode> = {
  dictado: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
    </>
  ),
  prompts: (
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5Z" />
      <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 6h8M8 9h6" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="2" />
      <rect x="17" y="14" width="4" height="6" rx="2" />
    </>
  ),
  lector: (
    <>
      <path d="M12 6.5C10 4.5 7.5 4 4 4v14c3.5 0 6 .5 8 2.5 2-2 4.5-2.5 8-2.5V4c-3.5 0-6 .5-8 2.5Z" />
      <path d="M12 6.5v14" />
    </>
  ),
  reuniones: (
    <>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3.5" />
      <path d="M17 4.5a3.5 3.5 0 0 1 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35" />
    </>
  ),
  traduccion: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 4 6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-6-4-9s1.5-6.5 4-9Z" />
    </>
  ),
  agenda: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </>
  ),
  voces: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  automatizaciones: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="none" />
      <circle cx="15" cy="12" r="2" fill="none" />
      <circle cx="7" cy="18" r="2" fill="none" />
    </>
  ),
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  privacidad: (
    <>
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.5 7.5 9 4.3-1.5 7.5-4.5 7.5-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  manual: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.8-1.7 1.2-1.7 2.7M12 17h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  )
}

export function NavIcon({ id }: { id: View | 'more' }): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[id]}
    </svg>
  )
}
