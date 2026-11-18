import { useEffect, type ReactNode } from 'react'

/** Hoja que sube desde abajo (en escritorio, un diálogo centrado). Se cierra con Escape o tocando fuera. */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }): JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="sheet-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header>
          <h2>{title}</h2>
          <button className="link" onClick={onClose} autoFocus>Cerrar</button>
        </header>
        {children}
      </div>
    </div>
  )
}
