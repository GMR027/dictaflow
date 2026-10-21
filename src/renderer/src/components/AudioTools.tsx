import { useRef, useState } from 'react'
import type { Lang, Segment } from '@shared/types'
import { Mic, SAMPLE_RATE, concat } from '../audio'
import { decodeToMono16k, encodeMp3, encodeWav, fmtTime, toSubtitles, wavToPcm } from '../audioio'
import { Speaker } from '../speech'
import { download, splitText } from '../textutil'
import { useApp } from '../store'
import { TtsSetup, useTtsStatus, VoicePicker } from './TtsSetup'

const ACTIONS: [string, string][] = [
  ['summary', 'Resumen'], ['chapters', 'Capítulos'], ['post', 'Post para redes'], ['notes', 'Notas'], ['study', 'Apuntes de estudio']
]
const CHUNK_SEC = 300

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
  const [recording, setRecording] = useState(false)
  const [drag, setDrag] = useState(false)
  const mic = useRef<Mic | null>(null)
  const lang = settings.primaryLang

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
      await mic.current.stop(); mic.current = null; setRecording(false)
      return
    }
    const m = new Mic({
      deviceId: settings.micDeviceId, mode: 'controlled', onLevel: () => undefined,
      onSegment: (p) => void load(`grabacion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`, encodeWav(p), p)
    })
    try { await m.start(); mic.current = m; setRecording(true) } catch (e) { setStatus(`Micrófono: ${(e as Error).message}`) }
  }

  const transcribe = async (): Promise<void> => {
    if (!pcm) return
    setBusy(true)
    const segs: Segment[] = []
    try {
      const step = CHUNK_SEC * SAMPLE_RATE
      for (let off = 0, i = 1; off < pcm.length; off += step, i++) {
        setStatus(`Transcribiendo parte ${i} de ${Math.ceil(pcm.length / step)}…`)
        const r = await window.api.transcribeDetailed(pcm.subarray(off, off + step), lang, true)
        const base = off / SAMPLE_RATE
        const parts = r.segments.length ? r.segments : [{ start: 0, end: 0, text: r.text }]
        segs.push(...parts.map((s) => ({ ...s, start: s.start + base, end: s.end + base })))
        setSegments([...segs])
        setText(segs.map((s) => s.text).join(' '))
      }
      setStatus('Listo')
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const ai = async (action: string): Promise<void> => {
    setBusy(true); setOut('Generando…')
    try {
      const timed = segments.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join('\n')
      setOut(await window.api.generate(action, timed || text, lang))
    } catch (e) { setOut(`Error: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  const translate = async (): Promise<void> => {
    const to: Lang = settings.secondaryLang ?? (lang === 'es' ? 'en' : 'es')
    setBusy(true); setOut('Traduciendo…')
    try { setOut(await window.api.translate(text, to)) } catch (e) { setOut(`Error: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const base = name.replace(/\.[^.]+$/, '') || 'transcripcion'
  const saved = async (p: Promise<string>): Promise<void> => { const f = await p; if (f) flash(`Guardado: ${f}`) }

  return (
    <>
      <div className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]) }}>
        <p>Arrastra aquí un audio (mp3, wav, ogg, flac, m4a, webm…) o</p>
        <div className="row">
          <label className="btn">Elegir archivo<input type="file" accept="audio/*,video/webm,video/mp4,.m4a,.flac,.opus" hidden onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <button className={`mic ${recording ? 'rec' : ''}`} onClick={() => void toggleRec()}>{recording ? '■ Detener grabación' : '🎤 Grabar con el micrófono'}</button>
        </div>
        <p className="muted">{status}</p>
      </div>

      <div className="row">
        <button className="primary" onClick={() => void transcribe()} disabled={!pcm || busy}>{busy ? 'Trabajando…' : 'Transcribir'}</button>
        <button onClick={() => void saved(download(name || `${base}.wav`, bytes!))} disabled={!bytes}>💾 Guardar audio</button>
        <button onClick={() => void saved(download(`${base}.txt`, text))} disabled={!text}>⬇ .txt</button>
        <button onClick={() => void saved(download(`${base}.srt`, toSubtitles(segments, 'srt')))} disabled={!segments.length}>⬇ .srt</button>
        <button onClick={() => void saved(download(`${base}.vtt`, toSubtitles(segments, 'vtt')))} disabled={!segments.length}>⬇ .vtt</button>
        <button onClick={() => void window.api.copy(text)} disabled={!text}>📋 Copiar</button>
        <button onClick={async () => flash(`📝 ${await window.api.exportNote(base, text, ['audio'])}`)} disabled={!text}>📝 A notas</button>
      </div>

      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Aquí aparecerá la transcripción." />

      {text && (
        <>
          <div className="row">
            <span className="muted">Con IA:</span>
            {ACTIONS.map(([k, v]) => <button key={k} onClick={() => void ai(k)} disabled={busy}>{v}</button>)}
            <button onClick={() => void translate()} disabled={busy}>Traducir</button>
          </div>
          {out && <textarea value={out} onChange={(e) => setOut(e.target.value)} />}
          {out && <div className="row"><button onClick={() => void window.api.copy(out)}>📋 Copiar resultado</button><button onClick={() => void saved(download(`${base}-resultado.md`, out))}>⬇ Guardar .md</button></div>}
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
      const file = await download(`dictaflow-voz.${fmt}`, fmt === 'wav' ? encodeWav(all, rate) : encodeMp3(all, rate))
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
          <button role="tab" aria-selected={tab === 'stt'} className={tab === 'stt' ? 'on' : ''} onClick={() => setTab('stt')}>🎧 Voz → Texto</button>
          <button role="tab" aria-selected={tab === 'tts'} className={tab === 'tts' ? 'on' : ''} onClick={() => setTab('tts')}>🔊 Texto → Voz</button>
        </div>
        {tab === 'stt' ? <SpeechToText /> : <TextToSpeech />}
      </section>
    </div>
  )
}
