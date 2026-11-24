import { useEffect, useRef, useState } from 'react'
import type { Lang, LibraryDoc, LibraryMeta } from '@shared/types'
import { concat } from '../audio'
import { ensureService } from '../services'
import { Speaker } from '../speech'
import { splitText } from '../textutil'
import { useApp } from '../store'
import { TtsSetup, useTtsStatus, VoicePicker } from './TtsSetup'
import { ToolIcon } from './ToolIcon'
import { BotTyping } from './BotTyping'
import { MoreMenu } from './MoreMenu'

export function Reader(): JSX.Element {
  const { settings, flash, notice } = useApp()
  const [metas, setMetas] = useState<LibraryMeta[]>([])
  const [doc, setDoc] = useState<LibraryDoc | null>(null)
  const [lang, setLang] = useState<Lang>(settings.primaryLang)
  const [font, setFont] = useState(17)
  const [playing, setPlaying] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [ai, setAi] = useState('')
  const [question, setQuestion] = useState('')
  const [info, refresh] = useTtsStatus()
  const speaker = useRef(new Speaker())
  const activeEl = useRef<HTMLParagraphElement | null>(null)

  const refreshList = (): void => void window.api.listLibrary().then(setMetas)
  useEffect(refreshList, [])
  useEffect(() => () => { void speaker.current.dispose() }, [])

  const chapter = doc?.chapters[doc.progress.chapter]
  const units = chapter ? splitText(chapter.text, 350) : []

  /** El punto de lectura se guarda aparte: no se reescribe el texto del libro. */
  const setProgress = (patch: Partial<LibraryDoc['progress']>): void => {
    if (!doc) return
    const progress = { ...doc.progress, ...patch }
    setDoc({ ...doc, progress })
    void window.api.setLibraryProgress(doc.id, progress)
  }

  const add = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setError(''); setBusy('Importando…')
    try {
      // PDF.js y JSZip solo se cargan al importar un documento, no al abrir el lector.
      const { importDocument } = await import('../docs')
      const d = await importDocument(f.name, new Uint8Array(await f.arrayBuffer()))
      await window.api.saveLibraryDoc(d)
      refreshList()
      setDoc(d)
      flash(`Documento añadido: ${d.title}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  const open = async (id: string): Promise<void> => {
    stop()
    setActive(-1); setAi('')
    const d = await window.api.getLibraryDoc(id)
    setDoc(d)
  }

  const stop = (): void => { speaker.current.stop(); setPlaying(false) }
  const play = async (from: number): Promise<void> => {
    if (!doc) return
    if (!(await ensureService('tts', { lang }))) return
    stop(); setError(''); setPlaying(true)
    try {
      await speaker.current.readAll(units, lang, from, (i) => { setActive(i); setProgress({ paragraph: i }) })
    } catch (e) { setError((e as Error).message) } finally { setPlaying(false) }
  }

  /**
   * Audiolibro: un capítulo por fichero, hecho en segundo plano. Se puede
   * cancelar y se reanuda si se para: los capítulos ya hechos se saltan.
   */
  const audiobook = async (): Promise<void> => {
    if (!doc) return
    if (!(await ensureService('tts', { lang }))) return
    setError('')
    try {
      const job = await window.api.startAudiobook(doc.id, lang, settings.ttsVoice[lang])
      flash(`Audiolibro en marcha: ${job.title}. Se puede cancelar desde la barra lateral.`)
    } catch (e) { setError((e as Error).message) }
  }

  const ask = async (kind: 'summary' | 'ask' | 'translate'): Promise<void> => {
    if (!chapter) return
    if (!(await ensureService('ai'))) return
    setBusy('Consultando a la IA…'); setAi('')
    try {
      if (kind === 'summary') setAi(await window.api.generate('summary', chapter.text, lang))
      else if (kind === 'translate') setAi(await window.api.translate(units[Math.max(active, 0)] ?? chapter.text.slice(0, 2000), settings.secondaryLang ?? (lang === 'es' ? 'en' : 'es')))
      else setAi(await window.api.chat('Responde la pregunta usando SOLO el texto del capítulo. Si no está en el texto, dilo.', [{ role: 'user', content: `Capítulo:\n${chapter.text.slice(0, 14000)}\n\nPregunta: ${question}` }]))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  return (
    <div className="view split">
      <section className="card side">
        <header><h2><ToolIcon tool="lector" /> Biblioteca</h2></header>
        <label className="btn">+ Añadir documento
          <input type="file" accept=".pdf,.epub,.txt,.md" hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <div className="list">
          {metas.length === 0 && <p className="muted">Añade un libro o documento para leerlo o convertirlo en audio.</p>}
          {metas.map((m) => (
            <div key={m.id} className={`item pick ${m.id === doc?.id ? 'sel' : ''}`} onClick={() => void open(m.id)}>
              <b>{m.title}</b><br /><small className="muted">{m.kind.toUpperCase()} · {m.chapters.length} partes</small>
              <button className="link" onClick={(e) => { e.stopPropagation(); void window.api.removeLibraryDoc(m.id).then(refreshList) }}>quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card wide">
        {notice && <div className="notice" role="status">{notice}</div>}
        {!doc || !chapter ? <p className="muted">{window.api.platform === 'android' ? 'Elige un documento de la biblioteca (arriba).' : 'Elige un documento de la izquierda.'}</p> : (
          <>
            <TtsSetup lang={lang} info={info} onChanged={refresh} />
            <div className="reader-pick">
              <select value={doc.progress.chapter} onChange={(e) => { stop(); setActive(-1); setProgress({ chapter: Number(e.target.value), paragraph: 0 }) }} aria-label="Capítulo">
                {doc.chapters.map((c, i) => <option key={i} value={i}>{i + 1}. {c.title.slice(0, 60)}</option>)}
              </select>
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Idioma de lectura">
                <option value="es">Leer en español</option><option value="en">Read in English</option>
              </select>
            </div>
            <details className="opts">
              <summary>Voz, tamaño del texto y velocidad</summary>
              <VoicePicker
                lang={lang}
                value={settings.ttsVoice[lang]}
                onChange={(id) => void useApp.getState().patchSettings({ ttsVoice: { ...settings.ttsVoice, [lang]: id } })}
                info={info}
                onChanged={refresh}
              />
              <div className="form-grid">
                <label>Tamaño del texto <input type="range" min="13" max="26" value={font} onChange={(e) => setFont(Number(e.target.value))} /></label>
                <label>Velocidad {settings.ttsSpeed.toFixed(1)}× <input type="range" min="0.6" max="1.6" step="0.1" value={settings.ttsSpeed} onChange={(e) => void useApp.getState().patchSettings({ ttsSpeed: Number(e.target.value) })} /></label>
              </div>
            </details>
            <div className="player">
              {playing
                ? <>
                  <button className="round" onClick={() => speaker.current.pause()} aria-label="Pausa" title="Pausa">⏸</button>
                  <button className="round primary" onClick={() => speaker.current.resume()} aria-label="Seguir" title="Seguir">▶</button>
                  <button className="round" onClick={stop} aria-label="Parar" title="Parar">■</button>
                </>
                : <button className="primary" onClick={() => void play(Math.max(active, doc.progress.paragraph, 0))}>▶ Leer en voz alta</button>}
              <MoreMenu items={[{ label: '⬇ Crear audiolibro (en segundo plano)', onClick: () => void audiobook(), disabled: !!busy }]} />
            </div>
            {busy && <BotTyping small label={busy.replace(/…$/, '')} />}
            {error && <p className="warn" role="alert">{error}</p>}
            <article className="page" style={{ fontSize: font }}>
              {units.map((u, i) => (
                <p key={i} ref={i === active ? activeEl : null} className={i === active ? 'hl' : ''} onClick={() => void play(i)} title="Toca para leer desde aquí">{u}</p>
              ))}
            </article>
            <h3>Con IA</h3>
            <div className="actions">
              <button onClick={() => void ask('summary')} disabled={!!busy}>📝 Resumir capítulo</button>
              <button onClick={() => void ask('translate')} disabled={!!busy}>🌐 Traducir párrafo</button>
            </div>
            <div className="ask-row">
              <input placeholder="Pregunta sobre este capítulo…" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && question.trim() && !busy) void ask('ask') }} />
              <button className="primary" onClick={() => void ask('ask')} disabled={!!busy || !question.trim()}>Preguntar</button>
            </div>
            {ai && <pre className="ai">{ai}</pre>}
          </>
        )}
      </section>
    </div>
  )
}
