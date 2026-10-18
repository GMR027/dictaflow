import { useEffect, useRef, useState } from 'react'
import { TRANS_LANGS, type Lang, type TransLang } from '@shared/types'
import { Mic, Segmenter } from '../audio'
import { Speaker } from '../speech'
import { useApp } from '../store'

interface Pair { src: string; dst: string }
const CODES = Object.keys(TRANS_LANGS) as TransLang[]
const hasVoice = (l: TransLang): l is Lang => l === 'es' || l === 'en'

function LiveTranslate(): JSX.Element {
  const { settings } = useApp()
  const [from, setFrom] = useState<TransLang>(settings.primaryLang)
  const [to, setTo] = useState<TransLang>(settings.primaryLang === 'es' ? 'en' : 'es')
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
        if (sp && hasVoice(t)) await speaker.current.say(dst, t)
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
            <select value={from} onChange={(e) => { const v = e.target.value as TransLang; setFrom(v); if (v === to) setTo(from) }} disabled={on}>
              {CODES.map((l) => <option key={l} value={l}>{TRANS_LANGS[l].name}</option>)}
            </select>
          </label>
          <button title="Intercambiar idiomas" aria-label="Intercambiar idiomas" disabled={on}
            onClick={() => { setFrom(to); setTo(from) }}>⇄</button>
          <label>Traducir a
            <select value={to} onChange={(e) => { const v = e.target.value as TransLang; setTo(v); if (v === from) setFrom(to) }} disabled={on}>
              {CODES.map((l) => <option key={l} value={l}>{TRANS_LANGS[l].name}</option>)}
            </select>
          </label>
          <label>Fuente
            <select value={source} onChange={(e) => setSource(e.target.value as 'mic' | 'system')} disabled={on}>
              <option value="mic">🎤 Mi micrófono (conversación)</option>
              <option value="system">🔊 Audio del sistema (subtítulos)</option>
            </select>
          </label>
          <label className="inline check"><input type="checkbox" checked={speak} disabled={!hasVoice(to)} onChange={(e) => setSpeak(e.target.checked)} /> Leer la traducción en voz alta{!hasVoice(to) && ' (solo español e inglés)'}</label>
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

function TextTranslate(): JSX.Element {
  const { settings } = useApp()
  const [to, setTo] = useState<TransLang>(settings.primaryLang === 'es' ? 'en' : 'es')
  const [text, setText] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (): Promise<void> => {
    setBusy(true); setError('')
    try { setResult(await window.api.translate(text.trim(), to)) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <section className="card grow">
      <header><h2>📝 Traducir texto</h2></header>
      <div className="row">
        <label>Traducir a
          <select value={to} onChange={(e) => setTo(e.target.value as TransLang)}>
            {CODES.map((l) => <option key={l} value={l}>{TRANS_LANGS[l].name}</option>)}
          </select>
        </label>
        <button className="primary" onClick={() => void run()} disabled={busy || !text.trim()}>{busy ? 'Traduciendo…' : 'Traducir'}</button>
        <button onClick={() => { setText(''); setResult(''); setError('') }} disabled={!text && !result}>Limpiar</button>
      </div>
      <p className="muted">El idioma original se detecta automáticamente.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe o pega el texto a traducir…" aria-label="Texto original" />
      {error && <p className="warn" role="alert">{error}</p>}
      {result && (
        <>
          <textarea value={result} readOnly aria-label="Traducción" />
          <div className="row"><button onClick={() => void window.api.copy(result)}>Copiar traducción</button></div>
        </>
      )}
    </section>
  )
}

export function Translate(): JSX.Element {
  const [tab, setTab] = useState<'live' | 'text'>('live')
  return (
    <div className="view">
      <div className="seg tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>🌐 En vivo</button>
        <button role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>📝 Texto</button>
      </div>
      {/* la traducción en vivo sigue montada para no cortar la captura al cambiar de pestaña */}
      <div className="view" hidden={tab !== 'live'} style={{ display: tab === 'live' ? undefined : 'none' }}><LiveTranslate /></div>
      {tab === 'text' && <TextTranslate />}
    </div>
  )
}
