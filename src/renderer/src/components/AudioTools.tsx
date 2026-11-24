import { useEffect, useRef, useState } from 'react'
import type { Lang, Segment } from '@shared/types'
import { createMic, SAMPLE_RATE, concat, type MicLike } from '../audio'
import { decodeToMono16k, encodeWav, fmtTime, toSubtitles, wavToPcm } from '../audioio'
import { Speaker } from '../speech'
import { download, splitText } from '../textutil'
import { useApp } from '../store'
import { TtsSetup, useTtsStatus, VoicePicker } from './TtsSetup'
import { ToolIcon } from './ToolIcon'
import { BotTyping } from './BotTyping'
import { MoreMenu } from './MoreMenu'
import { RecButton } from './RecButton'

const ACTIONS: [string, string][] = [
  ['summary', 'Resumen'], ['chapters', 'Capítulos'], ['post', 'Post para redes'], ['notes', 'Notas'], ['study', 'Apuntes de estudio']
]
// En el teléfono, trozos de 30 s (la ventana de Whisper): 5 minutos de audio en una sola llamada
// pasaban decenas de MB por el puente con la app y se quedaban sin memoria.
const CHUNK_SEC = window.api.platform === 'android' ? 30 : 300

function SpeechToText(): JSX.Element {
  const { settings, flash } = useApp()
  const [name, setName] = useState('')
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pcm, setPcm] = useState<Float32Array | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [text, setText] = useState('')
  const [out, setOut] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  /** Qué está haciendo: transcribir o la acción de IA (para el bot y los bordes). */
  const [phase, setPhase] = useState<'' | 'stt' | 'ai'>('')
  const [part, setPart] = useState('')
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [drag, setDrag] = useState(false)
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  const [prep, setPrep] = useState('')
  const mic = useRef<MicLike | null>(null)
  const lang = settings.primaryLang

  useEffect(() => {
    let alive = true
    const refresh = (): void => { void window.api.sttStatus().then((s) => { if (alive) setModelReady(s.modelInstalled) }) }
    refresh()
    const off = window.api.onSttProgress((p) => {
      if (p.status === 'progress') setPrep(`${p.file?.split('/').pop() ?? 'modelo'} ${Math.round(p.progress ?? 0)}%`)
      if (p.status === 'ready' || p.status === 'done') { setPrep(''); refresh() }
    })
    return () => { alive = false; off() }
  }, [settings.sttModel, settings.sttEngine, settings.sttProvider])

  const prepareModel = async (): Promise<void> => {
    setPrep('Preparando el modelo…')
    try { await window.api.loadStt(); setPrep('Modelo listo.'); setModelReady(true) }
    catch (e) { setPrep(`Error: ${(e as Error).message}`) }
  }

  const load = async (n: string, data: Uint8Array, decoded?: Float32Array): Promise<void> => {
    setStatus('Leyendo audio…')
    try {
      const p = decoded ?? (await decodeToMono16k(data))
      setName(n); setBytes(data); setPcm(p); setSegments([]); setText(''); setOut('')
      setStatus(`${n} · ${fmtTime(p.length / SAMPLE_RATE)}`)
    } catch (e) {
      setStatus(`No se pudo leer el archivo: ${(e as Error).message}`)
    }
  }
  const onFile = async (f: File | undefined): Promise<void> => {
    if (f) await load(f.name, new Uint8Array(await f.arrayBuffer()))
  }

  const toggleRec = async (): Promise<void> => {
    if (mic.current) {
      await mic.current.stop(); mic.current = null; setRecording(false); setLevel(0)
      return
    }
    const m = createMic({
      deviceId: settings.micDeviceId, mode: 'controlled', onLevel: setLevel, filters: settings.micFilters,
      onSegment: (p) => void load(`grabacion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`, encodeWav(p), p),
      onEnded: () => { setRecording(false); setLevel(0) }
    })
    try { await m.start(); mic.current = m; setRecording(true) } catch (e) { setStatus(`Micrófono: ${(e as Error).message}`) }
  }

  const transcribe = async (): Promise<void> => {
    if (!pcm) return
    setBusy(true); setPhase('stt')
    const segs: Segment[] = []
    try {
      const step = CHUNK_SEC * SAMPLE_RATE
      for (let off = 0, i = 1; off < pcm.length; off += step, i++) {
        const n = Math.ceil(pcm.length / step)
        setPart(n > 1 ? `Transcribiendo parte ${i} de ${n}` : 'Transcribiendo')
        const r = await window.api.transcribeDetailed(pcm.subarray(off, off + step), lang, true)
        const base = off / SAMPLE_RATE
        const parts = r.segments.length ? r.segments : [{ start: 0, end: 0, text: r.text }]
        segs.push(...parts.map((s) => ({ ...s, start: s.start + base, end: s.end + base })))
        setSegments([...segs])
        setText(segs.map((s) => s.text).join(' '))
      }
      setStatus(`${name} · ${fmtTime(pcm.length / SAMPLE_RATE)} · transcrito`)
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    } finally {
      setBusy(false); setPhase(''); setPart('')
    }
  }

  const ai = async (action: string): Promise<void> => {
    setBusy(true); setPhase('ai'); setOut('')
    try {
      const timed = segments.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join('\n')
      setOut(await window.api.generate(action, timed || text, lang))
    } catch (e) { setOut(`Error: ${(e as Error).message}`) } finally { setBusy(false); setPhase('') }
  }
  const translate = async (): Promise<void> => {
    const to: Lang = settings.secondaryLang ?? (lang === 'es' ? 'en' : 'es')
    setBusy(true); setPhase('ai'); setOut('')
    try { setOut(await window.api.translate(text, to)) } catch (e) { setOut(`Error: ${(e as Error).message}`) } finally { setBusy(false); setPhase('') }
  }

  const base = name.replace(/\.[^.]+$/, '') || 'transcripcion'
  const saved = async (p: Promise<string>): Promise<void> => { const f = await p; if (f) flash(`Guardado: ${f}`) }

  return (
    <>
      <div className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]) }}>
        <div className="source-pick">
          <label className="btn big">📁 Elegir archivo<input type="file" accept="audio/*,video/webm,video/mp4,.m4a,.flac,.opus" hidden onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <span className="muted">o</span>
          <RecButton recording={recording} level={level} onClick={() => void toggleRec()} idle="Grabar" active="Detener grabación" disabled={busy} />
        </div>
        <p className="muted">{status || (window.api.platform === 'android' ? 'Elige un audio (mp3, wav, ogg, m4a…) o graba con el micrófono.' : 'Arrastra aquí un audio (mp3, wav, ogg, flac, m4a…), elige un archivo o graba con el micrófono.')}</p>
      </div>

      {settings.sttProvider === 'local' && settings.sttEngine === 'transformers' && modelReady === false && (
        <div className="row">
          <button onClick={() => void prepareModel()} disabled={!!prep}>⬇ Preparar modelo de voz ({settings.sttModel.split('/').pop()})</button>
          <span className="muted">{prep || 'Se descarga una sola vez y luego funciona sin conexión.'}</span>
        </div>
      )}
      {settings.sttProvider === 'local' && settings.sttEngine === 'whispercpp' && (
        <p className="muted">Motor whisper.cpp seleccionado. Sus modelos se gestionan en Ajustes → Rendimiento.</p>
      )}

      <div className="actions">
        <button className="primary" onClick={() => void transcribe()} disabled={!pcm || busy}>✍ Transcribir</button>
        <button onClick={() => void window.api.copy(text)} disabled={!text}>📋 Copiar</button>
        <button onClick={async () => flash(`📝 ${await window.api.exportNote(base, text, ['audio'])}`)} disabled={!text}>📝 A notas</button>
        <MoreMenu label="⬇ Exportar" items={[
          { label: '💾 Audio original', onClick: () => void saved(download(name || `${base}.wav`, bytes!)), disabled: !bytes },
          { label: 'Texto (.txt)', onClick: () => void saved(download(`${base}.txt`, text)), disabled: !text },
          { label: 'Subtítulos (.srt)', onClick: () => void saved(download(`${base}.srt`, toSubtitles(segments, 'srt'))), disabled: !segments.length },
          { label: 'Subtítulos (.vtt)', onClick: () => void saved(download(`${base}.vtt`, toSubtitles(segments, 'vtt'))), disabled: !segments.length }
        ]} />
      </div>

      <div className={`field ${phase === 'stt' ? 'live' : ''}`}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Aquí aparecerá la transcripción." />
        {phase === 'stt' && <BotTyping label={part || 'Transcribiendo'} />}
      </div>

      {text && (
        <>
          <h3>Con IA</h3>
          <div className="chips scroll">
            {ACTIONS.map(([k, v]) => <button className="chip" key={k} onClick={() => void ai(k)} disabled={busy}>{v}</button>)}
            <button className="chip" onClick={() => void translate()} disabled={busy}>🌐 Traducir</button>
          </div>
          {(out || phase === 'ai') && (
            <div className={`field ${phase === 'ai' ? 'live' : 'done'}`}>
              <textarea value={out} onChange={(e) => setOut(e.target.value)} />
              {phase === 'ai' && <BotTyping label="Generando" />}
            </div>
          )}
          {out && phase !== 'ai' && <div className="actions"><button onClick={() => void window.api.copy(out)}>📋 Copiar resultado</button><button onClick={() => void saved(download(`${base}-resultado.md`, out))}>⬇ Guardar .md</button></div>}
        </>
      )}
    </>
  )
}

function TextToSpeech(): JSX.Element {
  const { settings, patchSettings, flash } = useApp()
  const [text, setText] = useState('')
  const [lang, setLang] = useState<Lang>(settings.primaryLang)
  const [info, refresh] = useTtsStatus()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const speaker = useRef(new Speaker())
  const cloud = settings.ttsProvider === 'openai'

  const play = async (): Promise<void> => {
    setError(''); setBusy('Reproduciendo…')
    try { await speaker.current.readAll(splitText(text), lang, 0, () => undefined) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const render = async (fmt: 'wav' | 'mp3'): Promise<void> => {
    setError('')
    try {
      if (fmt === 'mp3') {
        // El MP3 lo hace el proceso principal: se escribe a disco sin cargar el audio en memoria.
        setBusy('Sintetizando…')
        const file = await window.api.exportAudio(text, lang, settings.ttsVoice[lang], 'dictaflow-voz')
        flash(`Guardado: ${file}`)
        return
      }
      const parts = splitText(text)
      const pcms: Float32Array[] = []
      let rate = 22050
      for (let i = 0; i < parts.length; i++) {
        setBusy(`Sintetizando ${i + 1}/${parts.length}…`)
        const r = await wavToPcm(await window.api.synthesize(parts[i], lang))
        rate = r.rate
        pcms.push(r.pcm, new Float32Array(Math.round(rate * 0.25)))
      }
      setBusy('Codificando…')
      const all = concat(pcms)
      const file = await download(`dictaflow-voz.${fmt}`, encodeWav(all, rate))
      if (file) flash(`Guardado: ${file}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  return (
    <>
      <TtsSetup lang={lang} info={info} onChanged={refresh} />
      <div className="row">
        <label>Idioma
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="es">Español</option><option value="en">English</option>
          </select>
        </label>
        {!cloud && (
          <VoicePicker
            lang={lang}
            value={settings.ttsVoice[lang]}
            onChange={(id) => void patchSettings({ ttsVoice: { ...settings.ttsVoice, [lang]: id } })}
            info={info}
            onChanged={refresh}
          />
        )}
        <label>Velocidad {settings.ttsSpeed.toFixed(1)}×
          <input type="range" min="0.6" max="1.6" step="0.1" value={settings.ttsSpeed} onChange={(e) => void patchSettings({ ttsSpeed: Number(e.target.value) })} />
        </label>
        <span className="muted">{cloud ? '☁ Voz en la nube' : '🟢 Voz local (Piper)'}</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe o pega el texto que quieres convertir en voz." />
      <div className="row">
        <button className="primary" onClick={() => void play()} disabled={!text.trim() || !!busy}>▶ Escuchar</button>
        <button onClick={() => speaker.current.stop()}>■ Detener</button>
        <button onClick={() => void render('wav')} disabled={!text.trim() || !!busy}>⬇ Descargar WAV</button>
        <button onClick={() => void render('mp3')} disabled={!text.trim() || !!busy}>⬇ Descargar MP3</button>
        <span className="muted">{busy}</span>
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
    </>
  )
}

export function AudioTools(): JSX.Element {
  const [tab, setTab] = useState<'stt' | 'tts'>('stt')
  const notice = useApp((s) => s.notice)
  return (
    <div className="view">
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="card grow">
        <div className="seg tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'stt'} className={tab === 'stt' ? 'on' : ''} onClick={() => setTab('stt')}><ToolIcon tool="audio" /> Voz → Texto</button>
          <button role="tab" aria-selected={tab === 'tts'} className={tab === 'tts' ? 'on' : ''} onClick={() => setTab('tts')}>🔊 Texto → Voz</button>
        </div>
        {tab === 'stt' ? <SpeechToText /> : <TextToSpeech />}
      </section>
    </div>
  )
}
