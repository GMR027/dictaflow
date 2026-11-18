import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MoreItem {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hidden?: boolean
}

/**
 * Menú «⋯ Más» para las acciones secundarias: en el teléfono no caben diez botones en una fila.
 * Se cierra al elegir, al tocar fuera o con Escape; las flechas recorren las opciones.
 */
export function MoreMenu({ items, label = '⋯ Más' }: { items: MoreItem[]; label?: string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const visible = items.filter((i) => !i.hidden)

  useEffect(() => {
    if (!open) return
    const away = (e: Event): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])]
      const i = btns.indexOf(document.activeElement as HTMLButtonElement)
      btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus()
      e.preventDefault()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    box.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus()
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])

  if (!visible.length) return null
  return (
    <div className="more" ref={box}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div className="more-menu" role="menu">
          {visible.map((it, i) => (
            <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
