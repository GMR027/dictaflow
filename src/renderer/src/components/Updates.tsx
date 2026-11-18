import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/update'
import { useApp } from '../store'

const ANDROID = window.api.platform === 'android'
const SKIP_KEY = 'dictaflow:omitir-version'

/** Versión que el usuario pidió no volver a ofrecer al abrir la app («Ahora no»). */
const skipped = (): string => { try { return localStorage.getItem(SKIP_KEY) ?? '' } catch { return '' } }
const skip = (v: string): void => { try { localStorage.setItem(SKIP_KEY, v) } catch { /* sin almacenamiento: se volverá a ofrecer */ } }

/**
 * Android: al abrir la app se consulta la web de DictaFlow una vez y, si hay una versión nueva,
 * se ofrece con sus novedades («Actualizar ahora» / «Ahora no»). Sin conexión, en modo offline
 * estricto o si ya se dijo «Ahora no» a esa versión, no aparece nada.
 */
const INSTALLED_MSG = '✓ Descargada y verificada. Confirma «Instalar» en la ventana de Android: tus datos y modelos se conservan.'

export function UpdatePrompt(): JSX.Element | null {
  const strict = useApp((s) => s.settings.strictOffline)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  useEffect(() => window.api.onUpdateProgress(setPct), [])

  const check = (): void => {
    setMsg('')
    void window.api.checkUpdate().then((i) => setInfo(i.available && i.latest !== skipped() ? i : null), () => undefined)
  }
  useEffect(() => { if (ANDROID && !strict) check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return null
  const apply = async (): Promise<void> => {
    setBusy(true); setMsg('')
    try {
      await window.api.applyUpdate()
      setMsg(INSTALLED_MSG)
    } catch (e) { setMsg((e as Error).message) }
    setBusy(false); setPct(null)
  }
  return (
    <div className="update-prompt" role="dialog" aria-modal="true" aria-labelledby="upd-title">
      <section className="card">
        <h2 id="upd-title">Hay una versión nueva de DictaFlow</h2>
        <p>Tienes la <b>{info.current}</b>; la nueva es la <b>{info.latest}</b>.</p>
        {info.notes && <pre className="notes">{info.notes}</pre>}
        {msg && <p className={msg.startsWith('✓') ? 'ok' : 'warn'} role="status">{msg}</p>}
        <div className="row">
          {msg && !msg.startsWith('✓')
            ? <button className="primary" onClick={() => void apply()} disabled={busy}>{busy ? `Descargando… ${pct ?? 0}%` : 'Reintentar'}</button>
            : !msg && <button className="primary" onClick={() => void apply()} disabled={busy}>{busy ? `Descargando… ${pct ?? 0}%` : 'Actualizar ahora'}</button>}
          <button onClick={() => { if (!msg) skip(info.latest); setInfo(null) }}>{msg.startsWith('✓') ? 'Cerrar' : 'Ahora no'}</button>
        </div>
      </section>
    </div>
  )
}

export function Updates(): JSX.Element {
  const [version, setVersion] = useState('')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState<'' | 'check' | 'apply'>('')
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [server, setServer] = useState('')
  const [serverMsg, setServerMsg] = useState('')

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    if (ANDROID) void window.api.updateServer().then(setServer)
    return window.api.onUpdateProgress(setPct)
  }, [])

  const saveServer = async (): Promise<void> => {
    try { setServer(await window.api.updateServer(server)); setServerMsg('✓ Guardado'); setInfo(null) } catch (e) { setServerMsg((e as Error).message) }
  }

  const check = async (): Promise<void> => {
    setBusy('check'); setMsg(''); setInfo(null)
    try { setInfo(await window.api.checkUpdate()) } catch (e) { setMsg((e as Error).message) }
    setBusy('')
  }
  const apply = async (): Promise<void> => {
    setBusy('apply'); setMsg(''); setPct(0)
    try {
      const r = await window.api.applyUpdate()
      if (r === 'downloaded') setMsg(ANDROID ? INSTALLED_MSG : '✓ Descargada. Sigue los pasos del instalador del sistema y reabre DictaFlow.')
      if (r === 'opened') setMsg('Se abrió la página de descargas: instala la nueva versión desde allí.')
    } catch (e) { setMsg((e as Error).message) }
    setBusy(''); setPct(null)
  }

  return (
    <section className="card">
      <h2>Actualizaciones</h2>
      <p className="muted">Versión instalada: <b>{version || '…'}</b>. {ANDROID
        ? 'Se consulta la web de DictaFlow al abrir la app y cuando pulsas el botón (no con el modo offline estricto).'
        : 'Solo se consulta la web de DictaFlow (o GitHub, si no responde) cuando pulsas el botón (no funciona con el modo offline estricto).'}</p>
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
      {ANDROID && (
        <details>
          <summary className="muted">Servidor de actualizaciones</summary>
          <div className="row">
            <input className="grow" value={server} onChange={(e) => { setServer(e.target.value); setServerMsg('') }} aria-label="Servidor de actualizaciones" />
            <button onClick={() => void saveServer()}>Guardar</button>
          </div>
          <p className="muted">Solo https:// (http únicamente para localhost). {serverMsg && <span className={serverMsg.startsWith('✓') ? 'ok' : 'warn'}>{serverMsg}</span>}</p>
        </details>
      )}
    </section>
  )
}
