import { useEffect, useRef, useState } from 'react'
import { TRANS_LANGS, type Lang, type TransLang } from '@shared/types'
import { applyDictionary } from '@shared/dictionary'
import { createMic, Segmenter, type MicLike } from '../audio'
import { LiveTranscriber } from '../live'
import { PartialTranscriber } from '../partial'
import { ensureMicPermission, phoneSttBias, phoneSttDisponible } from '../phone-mic'
import { Speaker } from '../speech'
import { useApp } from '../store'
import { keepAwake } from '../wakelock'
import { BotTyping } from './BotTyping'
import { RecButton } from './RecButton'
import { ToolIcon } from './ToolIcon'

type Step = 'transcribing' | 'translating' | 'done' | 'error'
interface Pair { id: number; src: string; dst: string; step: Step }
const CODES = Object.keys(TRANS_LANGS) as TransLang[]
const hasVoice = (l: TransLang): l is Lang => l === 'es' || l === 'en'
const ANDROID = window.api.platform === 'android'
/** Pausa que cierra una frase: algo más corta que en el dictado, para que la traducción llegue antes. */
const PAUSE_MS = 700

/**
 * Traducción en vivo, frase a frase: mientras hablas se ve lo que vas diciendo (texto en vivo) y,
 * en cada pausa, la frase se transcribe con Whisper, se traduce y (si se pide) se lee en voz alta.
 * No hace falta pulsar Detener para ver la traducción.
 */
function LiveTranslate(): JSX.Element {
  const { settings } = useApp()
  const [from, setFrom] = useState<TransLang>(settings.primaryLang)
  const [to, setTo] = useState<TransLang>(settings.primaryLang === 'es' ? 'en' : 'es')
  const [source, setSource] = useState<'mic' | 'system'>('mic')
  const [speak, setSpeak] = useState(false)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)
  const [draft, setDraftState] = useState('')
  /** El texto en vivo también en una referencia: al cerrarse la frase pasa a su burbuja. */
  const draftRef = useRef('')
  const setDraft = (t: string): void => { draftRef.current = t; setDraftState(t) }
  const mic = useRef<MicLike | null>(null)
  const seg = useRef<Segmenter | null>(null)
  const unsub = useRef<(() => void) | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pendingCount = useRef(0)
  const speaker = useRef(new Speaker())
  const live = useRef<LiveTranscriber | null>(null)
  const partial = useRef<PartialTranscriber | null>(null)
  const phone = useRef<{ unsub: () => void } | null>(null)
  const release = useRef<(() => void) | null>(null)
  const nextId = useRef(1)
  const list = useRef<HTMLDivElement>(null)
  const opts = useRef({ from, to, speak })
  opts.current = { from, to, speak }

  useEffect(() => () => { void stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // La conversación sigue al último mensaje.
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [pairs, draft])

  const update = (id: number, p: Partial<Pair>): void => setPairs((all) => all.map((x) => (x.id === id ? { ...x, ...p } : x)))

  /** Una frase ya transcrita por el motor del teléfono: se añade y se traduce. */
  const translateFinal = (text: string): void => {
    if (!text.trim()) return
    const id = nextId.current++
    setPairs((p) => [...p, { id, src: text, dst: '', step: 'translating' }])
    pendingCount.current++
    queue.current = queue.current.then(async () => {
      try {
        const { to: t, speak: sp } = opts.current
        const dst = await window.api.translate(text, t)
        update(id, { dst, step: 'done' })
        if (sp && hasVoice(t)) await speaker.current.say(dst, t)
      } catch (e) {
        update(id, { step: 'error' })
        setError((e as Error).message)
      } finally { pendingCount.current-- }
    })
  }

  const handle = (pcm: Float32Array): void => {
    // La frase se cerró: lo que se veía en vivo pasa a una burbuja que se va completando.
    const id = nextId.current++
    const preview = draftRef.current
    setDraft('')
    live.current?.reset(); partial.current?.reset()
    setPairs((p) => [...p, { id, src: preview, dst: '', step: 'transcribing' }])
    pendingCount.current++
    queue.current = queue.current.then(async () => {
      try {
        const { from: f, to: t, speak: sp } = opts.current
        const { text } = await window.api.transcribeDetailed(pcm, f)
        if (!text) { setPairs((all) => all.filter((x) => x.id !== id)); return }
        update(id, { src: text, step: 'translating' })
        const dst = await window.api.translate(text, t)
        update(id, { dst, step: 'done' })
        if (sp && hasVoice(t)) await speaker.current.say(dst, t)
      } catch (e) {
        update(id, { step: 'error' })
        setError((e as Error).message)
      } finally { pendingCount.current-- }
    })
  }

  const start = async (): Promise<void> => {
    setError(''); setDraft('')
    try {
      if (source === 'mic') {
        // En Android, el motor on-device traduce la frase en cuanto se cierra, sin Whisper.
        if ((from === 'es' || from === 'en') && await phoneSttDisponible(settings)) {
          let unsub: (() => void) | null = null
          let fallo = false
          try {
            unsub = await window.api.phoneStt.on({
              onPartial: setDraft,
              onLevel: setLevel,
              onFinal: (t) => {
                setDraft('')
                const text = applyDictionary(t, settings.dictionary)
                if (text.trim()) translateFinal(text)
              },
              onError: (m) => {
                fallo = true
                unsub?.()
                setError(`Voz del teléfono: ${m}`)
                void stop()
              }
            })
            await ensureMicPermission()
            await window.api.phoneStt.start({ lang: from, continuous: true, bias: phoneSttBias(settings) })
            if (fallo) throw new Error('El motor de voz del teléfono falló al arrancar.')
            phone.current = { unsub }
            release.current = keepAwake()
            setOn(true)
            return
          } catch {
            // Si el motor del teléfono falla al arrancar, se usa el micrófono normal.
            unsub?.()
            await window.api.phoneStt.cancel().catch(() => undefined)
          }
        }
        const m = createMic({
          deviceId: settings.micDeviceId, mode: 'continuous', pauseMs: PAUSE_MS, onLevel: setLevel, filters: settings.micFilters,
          onAudio: (c) => live.current?.feed(c), onSegment: handle,
          onEnded: () => { void stop() }
        })
        mic.current = m
        await m.start()
        live.current = await LiveTranscriber.create(from, setDraft)
        // Sin modelo de texto en vivo: borradores de Whisper, solo cuando no hay nada traduciéndose.
        if (!live.current && settings.sttProvider === 'local' && settings.draftsEnabled) {
          partial.current = new PartialTranscriber({
            snapshot: () => m.snapshot(),
            transcribe: async (pcm) => (await window.api.transcribe(pcm, opts.current.from, 'draft')).text,
            onDraft: setDraft,
            busy: () => pendingCount.current > 0
          })
          partial.current.start()
        }
      } else {
        seg.current = new Segmenter('continuous', handle, PAUSE_MS)
        unsub.current = window.api.onSystemAudio((c) => seg.current?.feed(c))
        await window.api.startSystemAudio()
      }
      release.current = keepAwake()
      setOn(true)
    } catch (e) { setError((e as Error).message); await stop() }
  }
  const stop = async (): Promise<void> => {
    release.current?.(); release.current = null
    if (phone.current) {
      const { unsub } = phone.current
      phone.current = null
      try {
        await window.api.phoneStt.stop()
      } catch {
        // El motor ya estaba detenido.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 120))
      unsub()
      speaker.current.stop()
      setOn(false); setLevel(0); setDraft('')
      await queue.current
      return
    }
    live.current?.stop(); live.current = null
    partial.current?.stop(); partial.current = null
    await mic.current?.stop(); mic.current = null
    if (seg.current) { await window.api.stopSystemAudio(); unsub.current?.(); seg.current.flush(); seg.current = null }
    speaker.current.stop()
    setOn(false); setLevel(0); setDraft('')
  }

  const pick = (label: string, value: TransLang, set: (v: TransLang) => void): JSX.Element => (
    <select value={value} onChange={(e) => set(e.target.value as TransLang)} disabled={on} aria-label={label}>
      {CODES.map((l) => <option key={l} value={l}>{TRANS_LANGS[l].name}</option>)}
    </select>
  )

  return (
    <section className="card grow translate-live">
      <header>
        <h2><ToolIcon tool="traduccion" /> Traducción en vivo</h2>
        <button className="link" onClick={() => setPairs([])} disabled={!pairs.length || on}>Limpiar</button>
      </header>
      <div className="lang-bar">
        {pick('Hablo en', from, (v) => { setFrom(v); if (v === to) setTo(from) })}
        <button className="chip" title="Intercambiar idiomas" aria-label="Intercambiar idiomas" disabled={on} onClick={() => { setFrom(to); setTo(from) }}>⇄</button>
        {pick('Traducir a', to, (v) => { setTo(v); if (v === from) setFrom(to) })}
      </div>
      {!ANDROID && (
        <div className="seg" role="radiogroup" aria-label="Fuente">
          <button role="radio" aria-checked={source === 'mic'} className={source === 'mic' ? 'on' : ''} disabled={on} onClick={() => setSource('mic')}>🎤 Conversación</button>
          <button role="radio" aria-checked={source === 'system'} className={source === 'system' ? 'on' : ''} disabled={on} onClick={() => setSource('system')}>🔊 Audio del sistema</button>
        </div>
      )}
      {error && <p className="warn" role="alert">{error} <button className="link" onClick={() => setError('')}>cerrar</button></p>}

      <div className="bubbles" ref={list} aria-live="polite">
        {pairs.length === 0 && !draft && (
          <p className="muted center">{on ? 'Habla: verás lo que dices y, en cada pausa, su traducción.' : 'Pulsa el micrófono y habla con normalidad. Cada frase se traduce al hacer una pausa, sin detener.'}</p>
        )}
        {pairs.map((p) => (
          <div key={p.id} className="bubble-msg">
            <p className="src">{p.src || '…'}</p>
            {p.step === 'done' && <p className="dst">{p.dst}</p>}
            {(p.step === 'transcribing' || p.step === 'translating') && <BotTyping small label={p.step === 'transcribing' ? 'Transcribiendo' : 'Traduciendo'} />}
            {p.step === 'error' && <p className="warn">No se pudo traducir esta frase.</p>}
          </div>
        ))}
        {on && draft && <div className="bubble-msg live"><p className="src">{draft}</p></div>}
      </div>

      <div className="recorder">
        <RecButton recording={on} level={level} onClick={() => void (on ? stop() : start())} idle="Empezar" active="Detener" />
        <label className="inline switch">
          <input type="checkbox" role="switch" checked={speak} disabled={!hasVoice(to)} onChange={(e) => setSpeak(e.target.checked)} />
          <span className="slider" aria-hidden="true" /> Leer en voz alta{!hasVoice(to) && ' (solo español e inglés)'}
        </label>
      </div>
      <p className="muted center small">La calidad depende del modelo de redacción. Si lees en voz alta con altavoz, usa auriculares para que el micrófono no capte la traducción.</p>
    </section>
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
