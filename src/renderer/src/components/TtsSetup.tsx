import { useEffect, useState } from 'react'
import type { Lang, TtsStatus, Voice } from '@shared/types'
import { useApp } from '../store'

export type TtsInfo = TtsStatus & { catalog: Voice[] }

export function useTtsStatus(): [TtsInfo | null, () => void] {
  const [info, setInfo] = useState<TtsInfo | null>(null)
  const refresh = (): void => void window.api.ttsStatus().then(setInfo)
  useEffect(refresh, [])
  return [info, refresh]
}

/** Aviso + botones de instalación del motor y la voz local (Piper). No aparece si usas la nube o ya está todo. */
export function TtsSetup({ lang, info, onChanged }: { lang: Lang; info: TtsInfo | null; onChanged: () => void }): JSX.Element | null {
  const { settings } = useApp()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  useEffect(() => window.api.onTtsProgress((p) => setProgress(`${p.what} ${p.pct}%`)), [])

  if (!info || settings.ttsProvider !== 'piper') return null
  const voice = settings.ttsVoice[lang]
  const needEngine = !info.piperInstalled
  const needVoice = !info.voices.includes(voice)
  if (!needEngine && !needVoice) return null

  const vinfo = info.catalog.find((v) => v.id === voice)
  const run = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (needEngine) await window.api.installPiper()
      if (needVoice) await window.api.installVoice(voice)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className="item">
      <p className="warn">Para voz local falta descargar{needEngine ? ' el motor Piper (~25 MB)' : ''}{needEngine && needVoice ? ' y' : ''}{needVoice ? ` la voz ${vinfo?.label ?? voice} (~${vinfo?.sizeMB ?? 60} MB)` : ''}. Se guarda en tu equipo y luego funciona sin conexión.</p>
      <div className="row">
        <button className="primary" onClick={() => void run()} disabled={busy}>{busy ? `Descargando… ${progress}` : '⬇ Descargar'}</button>
        <span className="muted">O usa la nube en Ajustes → Audio.</span>
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
  )
}
