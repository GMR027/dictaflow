import { useEffect, useState } from 'react'
import type { Lang, TtsStatus } from '@shared/types'
import type { VoiceStatus } from '@shared/voice'
import { mb, speaks } from '@shared/voice'
import { useApp } from '../store'

export type TtsInfo = TtsStatus & { catalog: VoiceStatus[] }

/** Estado del motor y del catálogo de voces. */
export function useTtsStatus(): [TtsInfo | null, () => void] {
  const [info, setInfo] = useState<TtsInfo | null>(null)
  const refresh = (): void => void window.api.ttsStatus().then(setInfo)
  useEffect(refresh, [])
  return [info, refresh]
}

/**
 * Aviso + botones de instalación del motor y la voz local (Piper).
 * No aparece si usas la nube o ya está todo instalado.
 */
export function TtsSetup({ lang, info, onChanged }: { lang: Lang; info: TtsInfo | null; onChanged: () => void }): JSX.Element | null {
  const { settings } = useApp()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  useEffect(() => window.api.onTtsProgress((p) => setProgress(`${p.what} ${p.pct}%`)), [])

  if (!info || settings.ttsProvider !== 'piper') return null
  const voice = settings.ttsVoice[lang]
  // Kokoro corre con sherpa-onnx dentro de la app: no necesita el motor Piper.
  const needEngine = !info.piperInstalled && !voice.startsWith('kokoro:')
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
      <p className="warn">Para voz local falta descargar{needEngine ? ' el motor Piper (~25 MB)' : ''}{needEngine && needVoice ? ' y' : ''}{needVoice ? ` la voz ${vinfo?.label ?? voice} (~${vinfo ? mb(vinfo.sizeBytes) : '60'} MB)` : ''}. Se guarda en tu equipo y luego funciona sin conexión.</p>
      <div className="row">
        <button className="primary" onClick={() => void run()} disabled={busy}>{busy ? `Descargando… ${progress}` : '⬇ Descargar'}</button>
        <span className="muted">O usa la nube en Ajustes → Audio.</span>
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
  )
}

/** Grupos del selector: voces del teléfono (solo Android), Kokoro, Piper y nube. */
const GROUPS: [string[], string][] = [
  [['sistema'], 'Voces del teléfono (sin descargas)'],
  [['kokoro'], 'Kokoro · más naturales'],
  [['piper', 'sherpa-onnx'], 'Piper'],
  [['cloud'], 'Nube']
]

/**
 * Selector de voz del catálogo compartido, con filtro por idioma.
 * Muestra las voces descargadas y deja descargar las que faltan.
 */
export function VoicePicker({ lang, value, onChange, info, onChanged }: {
  lang: Lang
  value: string
  onChange: (id: string) => void
  info: TtsInfo | null
  onChanged: () => void
}): JSX.Element {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState('')
  const voices = (info?.catalog ?? []).filter((v) => speaks(v, lang))
  const current = info?.catalog.find((v) => v.id === value)

  const playSample = async (id: string): Promise<void> => {
    setError('')
    setPlaying(id)
    try {
      const bytes = await window.api.voiceSample(id)
      // Las muestras publicadas son MP3; las que dice el teléfono (Kokoro, voces del sistema), WAV.
      const wav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: wav ? 'audio/wav' : 'audio/mpeg' }))
      const a = new Audio(url)
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); setPlaying('') }
      await a.play()
    } catch (e) {
      setError((e as Error).message)
      setPlaying('')
    }
  }

  const install = async (id: string): Promise<void> => {
    setBusy(id)
    setError('')
    try {
      if (!info?.piperInstalled && !id.startsWith('kokoro:')) await window.api.installPiper()
      await window.api.installVoice(id)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="voice-picker">
      <label>Voz
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!voices.length}>
          {!voices.length && <option value="">Sin voces para este idioma</option>}
          {GROUPS.map(([engines, title]) => {
            const group = voices.filter((v) => engines.includes(v.engine))
            if (!group.length) return null
            return (
              <optgroup key={title} label={title}>
                {group.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}{v.installed ? '' : ' (sin descargar)'}</option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </label>
      {value && (
        <div className="row tight">
          {current?.sampleUrl && (current.installed || current.engine !== 'kokoro') && (
            <button onClick={() => void playSample(value)} disabled={playing === value}>
              {playing === value ? '🔊 Reproduciendo…' : '🔊 Escuchar muestra'}
            </button>
          )}
          {!info?.voices.includes(value) && (
            <button onClick={() => void install(value)} disabled={busy === value}>
              {busy === value ? 'Descargando…' : '⬇ Descargar'}
            </button>
          )}
        </div>
      )}
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
  )
}
