import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@shared/types'
import { Mic, Segmenter } from '../audio'
import { Speaker } from '../speech'
import { useApp } from '../store'

interface Pair { src: string; dst: string }
const NAME: Record<Lang, string> = { es: 'Español', en: 'English' }

export function Translate(): JSX.Element {
  const { settings } = useApp()
  const [from, setFrom] = useState<Lang>(settings.primaryLang)
  const to: Lang = from === 'es' ? 'en' : 'es'
  const [source, setSource] = useState<'mic' | 'system'>('mic')
  const [speak, setSpeak] = useState(false)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const mic = useRef<Mic | null>(null)
  const seg = useRef<Segmenter | null>(null)
  const unsub = useRef<(() => void) | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const speaker = useRef(new Speaker())
  const opts = useRef({ from, to, speak })
  opts.current = { from, to, speak }

  useEffect(() => () => { void stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handle = (pcm: Float32Array): void => {
    queue.current = queue.current.then(async () => {
      try {
        const { from: f, to: t, speak: sp } = opts.current
        const { text } = await window.api.transcribeDetailed(pcm, f)
        if (!text) return
        const dst = await window.api.translate(text, t)
        setPairs((p) => [...p, { src: text, dst }])
        if (sp) await speaker.current.say(dst, t)
      } catch (e) { setError((e as Error).message) }
    })
  }

  const start = async (): Promise<void> => {
    setError('')
    try {
      if (source === 'mic') {
        mic.current = new Mic({ deviceId: settings.micDeviceId, mode: 'continuous', onLevel: () => undefined, onSegment: handle })
        await mic.current.start()
      } else {
        seg.current = new Segmenter('continuous', handle)
        unsub.current = window.api.onSystemAudio((c) => seg.current?.feed(c))
        await window.api.startSystemAudio()
      }
      setOn(true)
    } catch (e) { setError((e as Error).message) }
  }
  const stop = async (): Promise<void> => {
    await mic.current?.stop(); mic.current = null
    if (seg.current) { await window.api.stopSystemAudio(); unsub.current?.(); seg.current = null }
    speaker.current.stop()
    setOn(false)
  }

  return (
    <div className="view">
      <section className="card grow">
        <header><h2>🌐 Traducción en vivo</h2></header>
        <div className="row">
          <label>Hablo / suena en
            <select value={from} onChange={(e) => setFrom(e.target.value as Lang)} disabled={on}>
              {(Object.keys(NAME) as Lang[]).map((l) => <option key={l} value={l}>{NAME[l]}</option>)}
            </select>
          </label>
          <span>→ {NAME[to]}</span>
          <label>Fuente
            <select value={source} onChange={(e) => setSource(e.target.value as 'mic' | 'system')} disabled={on}>
              <option value="mic">🎤 Mi micrófono (conversación)</option>
              <option value="system">🔊 Audio del sistema (subtítulos)</option>
            </select>
          </label>
          <label className="inline check"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Leer la traducción en voz alta</label>
          <button className={`mic ${on ? 'rec' : ''}`} onClick={() => void (on ? stop() : start())}>{on ? '■ Detener' : '● Empezar'}</button>
          <button onClick={() => setPairs([])} disabled={!pairs.length}>Limpiar</button>
        </div>
        <p className="muted">Hay un retraso de unos segundos: se traduce cada frase al terminar. La calidad depende del modelo de redacción elegido. Si lees en voz alta con altavoces, el micrófono captará la traducción: usa auriculares.</p>
        {error && <p className="warn" role="alert">{error}</p>}
        <div className="pairs">
          {pairs.length === 0 && <p className="muted">{on ? 'Escuchando…' : 'Pulsa empezar.'}</p>}
          {pairs.map((p, i) => (
            <div key={i} className="pair"><p className="muted">{p.src}</p><p><b>{p.dst}</b></p></div>
          ))}
        </div>
      </section>
    </div>
  )
}
