import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/update'

export function Updates(): JSX.Element {
  const [version, setVersion] = useState('')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState<'' | 'check' | 'apply'>('')
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    return window.api.onUpdateProgress(setPct)
  }, [])

  const check = async (): Promise<void> => {
    setBusy('check'); setMsg(''); setInfo(null)
    try { setInfo(await window.api.checkUpdate()) } catch (e) { setMsg((e as Error).message) }
    setBusy('')
  }
  const apply = async (): Promise<void> => {
    setBusy('apply'); setMsg(''); setPct(0)
    try {
      const r = await window.api.applyUpdate()
      if (r === 'downloaded') setMsg('✓ Descargada. Sigue los pasos del instalador del sistema y reabre DictaFlow.')
      if (r === 'opened') setMsg('Se abrió la página de descargas: instala la nueva versión desde allí.')
    } catch (e) { setMsg((e as Error).message) }
    setBusy(''); setPct(null)
  }

  return (
    <section className="card">
      <h2>Actualizaciones</h2>
      <p className="muted">Versión instalada: <b>{version || '…'}</b>. Solo se consulta GitHub cuando pulsas el botón (no funciona con el modo offline estricto).</p>
      <div className="row">
        <button onClick={() => void check()} disabled={busy !== ''}>{busy === 'check' ? 'Buscando…' : 'Buscar actualizaciones'}</button>
        {info?.available && (
          <button className="primary" onClick={() => void apply()} disabled={busy !== ''}>
            {busy === 'apply' ? `Descargando… ${pct ?? 0}%` : `Actualizar a ${info.latest}`}
          </button>
        )}
        {info && !info.available && <span className="ok">✓ Tienes la última versión</span>}
      </div>
      {info?.available && (
        <>
          <p>Hay una versión nueva: <b>{info.latest}</b>.{!info.asset && ' Esta instalación no se puede actualizar sola: se abrirá la página de descargas.'}</p>
          {info.notes && <pre className="notes">{info.notes}</pre>}
        </>
      )}
      {msg && <p className={msg.startsWith('✓') ? 'ok' : 'warn'} role="status">{msg}</p>}
    </section>
  )
}
