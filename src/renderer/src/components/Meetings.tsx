import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meeting, MeetingTask, Segment } from '@shared/types'
import { createMic, Segmenter, type MicLike } from '../audio'
import { fmtTime, toSubtitles } from '../audioio'
import { download } from '../textutil'
import { useApp } from '../store'
import { takeNext, withRetry, type Pending } from '../meeting-queue'
import { ensureService, ensureWhisper } from '../services'
import { keepAwake } from '../wakelock'
import { LiveTranscriber } from '../live'
import { ToolIcon } from './ToolIcon'
import { BotTyping } from './BotTyping'
import { MoreMenu } from './MoreMenu'
import { RecButton } from './RecButton'
import { Sheet } from './Sheet'

type Source = 'mic' | 'system' | 'both'
const SRC: Record<Source, string> = { mic: '🎤 Micrófono', system: '🔊 Audio del sistema', both: '🎤+🔊 Ambos' }
/** Android no deja captar el audio de otras apps: en el teléfono las reuniones son por micrófono. */
const SOURCES = (Object.keys(SRC) as Source[]).filter((k) => window.api.platform !== 'android' || k === 'mic')
/** En Android el micrófono es nativo y el WAV lo escribe el servicio de captura. */
const NATIVE = window.api.platform === 'android'

const toMarkdown = (m: Meeting): string =>
  `# ${m.title}\n\n_${new Date(m.createdAt).toLocaleString()} · ${fmtTime(m.durationSec)}_\n\n${m.summary ? m.summary + '\n\n---\n\n' : ''}## Transcripción\n\n` +
  m.segments.map((s) => `**[${fmtTime(s.start)}]${s.speaker ? ' ' + s.speaker : ''}:** ${s.text}`).join('\n\n')

/** El acta estructurada en Markdown. */
const minutesToMarkdown = (m: Meeting): string => {
  const min = m.minutes
  if (!min) return toMarkdown(m)
  const partes: string[] = [`# ${m.title}`, `_${new Date(m.createdAt).toLocaleString()} · ${fmtTime(m.durationSec)}_`, '', '## Resumen ejecutivo', min.summary || '(sin resumen)']
  if (min.topics.length) partes.push('', '## Temas tratados', ...min.topics.map((t) => `- ${t}`))
  if (min.decisions.length) partes.push('', '## Decisiones', ...min.decisions.map((t) => `- ${t}`))
  if (min.agreements.length) partes.push('', '## Acuerdos', ...min.agreements.map((t) => `- ${t}`))
  if (min.tasks.length) {
    partes.push('', '## Tareas pendientes')
    for (const t of min.tasks) {
      const extra = [t.owner && `Responsable: ${t.owner}`, t.due && `Fecha: ${t.due}`].filter(Boolean).join(' · ')
      partes.push(`- [${t.done ? 'x' : ' '}] ${t.text}${extra ? ` (${extra})` : ''}`)
    }
  }
  partes.push('', '---', '', '## Transcripción', '', m.segments.map((s) => `**[${fmtTime(s.start)}]${s.speaker ? ' ' + s.speaker : ''}:** ${s.text}`).join('\n\n'))
  return partes.join('\n')
}

const ANDROID = window.api.platform === 'android'

export function Meetings(): JSX.Element {
  const { settings, flash, notice } = useApp()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [source, setSource] = useState<Source>('mic')
  const [recording, setRecording] = useState(false)
  const [live, setLive] = useState<Segment[]>([])
  const [pending, setPending] = useState(0)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [history, setHistory] = useState(false)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [draft, setDraft] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioError, setAudioError] = useState('')
  const mic = useRef<MicLike | null>(null)
  const sysSeg = useRef<Segmenter | null>(null)
  const unsub = useRef<(() => void) | null>(null)
  const backlog = useRef<Pending[]>([])
  const worker = useRef<Promise<void> | null>(null)
  const segs = useRef<Segment[]>([])
  const t0 = useRef(0)
  /** Instante en que arrancó cada fuente, para compartir una sola línea de tiempo. */
  const micOffset = useRef(0)
  const sysOffset = useRef(0)
  /** Id de la grabación en curso (también es el id de la reunión que se va guardando). */
  const session = useRef('')
  const lastSave = useRef(0)
  const release = useRef<(() => void) | null>(null)
  const live$ = useRef<LiveTranscriber | null>(null)
  /** Audio acumulado para no enviar un trozo por cada bloque de 20 ms. */
  const audioBuf = useRef<Float32Array[]>([])

  /** Manda el audio grabado al proceso principal, en bloques de ~1 s. */
  const record = (chunk: Float32Array): void => {
    if (!session.current) return
    live$.current?.feed(chunk)
    // En Android el WAV lo escribe CapturaService; no hay que mandar audio por el puente.
    if (NATIVE) return
    audioBuf.current.push(chunk)
    const total = audioBuf.current.reduce((n, c) => n + c.length, 0)
    if (total < 16000) return
    const all = new Float32Array(total)
    let o = 0
    for (const c of audioBuf.current) { all.set(c, o); o += c.length }
    audioBuf.current = []
    void window.api.pushMeetingAudio(session.current, all)
  }

  useEffect(() => {
    void window.api.getCollection<Meeting>('meetings').then((all) => {
      // Una reunión que quedó «en curso» es de una sesión que se cerró a mitad: se recupera lo guardado.
      const cut = all.filter((m) => m.inProgress)
      if (!cut.length) { setMeetings(all); return }
      const fixed = all.filter((m) => !m.inProgress || m.segments.length).map((m) => (m.inProgress ? { ...m, inProgress: false } : m))
      setMeetings(fixed)
      void window.api.saveCollection('meetings', fixed)
      if (cut.some((m) => m.segments.length)) flash('🗂 Se recuperó una reunión que se interrumpió; está en el historial.')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Al salir de la pantalla en mitad de una reunión se guarda (antes se descartaba).
  useEffect(() => () => { void stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((Date.now() - t0.current) / 1000), 1000)
    return () => clearInterval(id)
  }, [recording])

  const persist = (next: Meeting[]): void => { setMeetings(next); void window.api.saveCollection('meetings', next) }
  const current = meetings.find((m) => m.id === sel) ?? null

  /** El WAV de la reunión se lee al abrirla y se reproduce dentro de la app. */
  useEffect(() => {
    let url = ''
    let vivo = true
    setAudioUrl('')
    setAudioError('')
    if (!current?.audioPath) return
    void window.api.meetingAudio(current.audioPath).then((bytes) => {
      if (!vivo) return
      // Copia a un ArrayBuffer normal: el tipo de `Uint8Array` de Tauri puede ser ArrayBufferLike.
      const buffer = bytes.slice().buffer as ArrayBuffer
      url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
      setAudioUrl(url)
    }).catch(() => {
      if (vivo) setAudioError('No se pudo cargar el audio de la reunión.')
    })
    return () => {
      vivo = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [current?.id, current?.audioPath])

  /** Guarda la reunión en curso tal como va (cada pocas frases), para no perderla si Android cierra la app. */
  const checkpoint = (force = false): void => {
    if (!session.current || (!force && Date.now() - lastSave.current < 10000)) return
    lastSave.current = Date.now()
    const id = session.current
    const snapshot = { segments: segs.current, durationSec: (Date.now() - t0.current) / 1000 }
    setMeetings((all) => {
      const next = all.map((m) => (m.id === id ? { ...m, ...snapshot } : m))
      void window.api.saveCollection('meetings', next)
      return next
    })
  }

  /** Transcribe las frases pendientes, de una en una (o juntas si hay atraso). */
  const drain = (): Promise<void> => {
    worker.current ??= (async () => {
      let item: Pending | undefined
      while ((item = takeNext(backlog.current))) {
        const it = item
        setPending(backlog.current.length + 1)
        try {
          const r = await withRetry(() => window.api.transcribeDetailed(it.pcm, settings.primaryLang))
          if (r.text) {
            segs.current = [...segs.current, { start: it.start, end: it.start + it.pcm.length / 16000, text: r.text, speaker: it.speaker }].sort((a, b) => a.start - b.start)
            setLive(segs.current)
            checkpoint()
          }
        } catch (e) {
          setError(`No se pudo transcribir el fragmento de ${fmtTime(it.start)}: ${(e as Error).message}`)
        }
      }
      setPending(0)
      worker.current = null
    })()
    return worker.current
  }

  /**
   * Encola un fragmento para transcribir. `offset` es el instante en que arrancó
   * esa fuente: con un reloj común, las marcas de tiempo del micrófono y del
   * audio del sistema quedan en la misma escala y se pueden ordenar.
   */
  const enqueue = (pcm: Float32Array, start: number, offset: number, speaker?: string): void => {
    setDraft(''); live$.current?.reset()
    backlog.current.push({ pcm, start: offset + start, speaker })
    setPending(backlog.current.length)
    void drain()
  }

  const start = async (): Promise<void> => {
    // Las reuniones se transcriben con Whisper (archivo/reunión), no con el motor del teléfono.
    if (!(await ensureWhisper())) return
    setError(''); segs.current = []; setLive([]); setSel(null); setElapsed(0); setDraft('')
    backlog.current = []
    t0.current = Date.now()
    const tag = (s: string): string | undefined => (source === 'both' ? s : undefined)
    const clock = performance.now()
    session.current = crypto.randomUUID()
    // En Android el WAV lo escribe el micrófono nativo; en escritorio, el proceso principal.
    if (!NATIVE) await window.api.startMeetingAudio(session.current)
    const now = new Date()
    const m: Meeting = {
      id: session.current, title: `Reunión ${now.toLocaleDateString()} ${now.toLocaleTimeString().slice(0, 5)}`,
      createdAt: t0.current, durationSec: 0, source, segments: [], summary: '', inProgress: true
    }
    setMeetings((all) => { const next = [m, ...all]; void window.api.saveCollection('meetings', next); return next })
    lastSave.current = Date.now()
    try {
      if (source !== 'system') {
        micOffset.current = (performance.now() - clock) / 1000
        mic.current = createMic({
          deviceId: settings.micDeviceId, mode: 'continuous', onLevel: setLevel, filters: settings.micFilters,
          onAudio: record, onSegment: (p, t) => enqueue(p, t, micOffset.current, tag('Yo')),
          wav: NATIVE, session: session.current,
          onEnded: () => { void stop() }
        })
        await mic.current.start()
        live$.current = settings.features.liveText
          ? await LiveTranscriber.create(settings.primaryLang, setDraft)
          : null
      }
      if (source !== 'mic') {
        sysOffset.current = (performance.now() - clock) / 1000
        sysSeg.current = new Segmenter('continuous', (p, t) => enqueue(p, t, sysOffset.current, tag('Sistema')))
        unsub.current = window.api.onSystemAudio((c) => { record(c); sysSeg.current?.feed(c) })
        await window.api.startSystemAudio()
      }
      release.current = keepAwake()
      setRecording(true)
    } catch (e) { setError((e as Error).message); await stop(true) }
  }

  const stop = async (discard = false): Promise<void> => {
    if (!session.current) return
    const id = session.current
    release.current?.(); release.current = null
    const micResult = await mic.current?.stop(discard); mic.current = null
    live$.current?.stop(); live$.current = null
    if (sysSeg.current) { await window.api.stopSystemAudio(); unsub.current?.(); sysSeg.current.flush(); sysSeg.current = null }
    setRecording(false); setLevel(0); setDraft('')
    await drain()
    const nativeAudio = micResult && typeof micResult === 'object' && micResult.wavPath
      ? { path: micResult.wavPath, durationSec: micResult.durationSec ?? 0 }
      : null
    const audio = NATIVE ? nativeAudio : await window.api.stopMeetingAudio(id)
    session.current = ''
    if (discard || !segs.current.length) {
      if (discard && !NATIVE) await window.api.discardMeetingAudio(id)
      setMeetings((all) => { const next = all.filter((m) => m.id !== id); void window.api.saveCollection('meetings', next); return next })
      return
    }
    const final = { segments: segs.current, durationSec: (Date.now() - t0.current) / 1000, audioPath: audio?.path, inProgress: false }
    setMeetings((all) => { const next = all.map((m) => (m.id === id ? { ...m, ...final } : m)); void window.api.saveCollection('meetings', next); return next })
    setSel(id); setLive([])
  }

  /** Genera el acta estructurada: resumen, temas, decisiones, acuerdos y tareas. */
  const makeMinutes = async (): Promise<void> => {
    if (!current) return
    if (!(await ensureService('ai'))) return
    setBusy('Generando el acta…'); setError('')
    try {
      const text = current.segments.map((s) => `[${fmtTime(s.start)}]${s.speaker ? ' ' + s.speaker : ''}: ${s.text}`).join('\n')
      const minutes = await window.api.minutes(text, settings.primaryLang)
      if (!minutes) {
        setError('El modelo no devolvió un acta en formato válido. Prueba con otro modelo o revisa la conexión.')
        return
      }
      persist(meetings.map((m) => (m.id === current.id ? { ...m, minutes, summary: minutes.summary } : m)))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  const toggleTask = (i: number): void => {
    if (!current?.minutes) return
    const tasks = current.minutes.tasks.map((t, j) => (j === i ? { ...t, done: !t.done } : t))
    persist(meetings.map((m) => (m.id === current.id ? { ...m, minutes: { ...current.minutes!, tasks } } : m)))
  }

  /** Renombra al hablante de un fragmento: la atribución pasa a ser del usuario. */
  const rename = (index: number): void => {
    if (!current || !newName.trim()) return
    const segments = current.segments.map((s, i) => (i === index ? { ...s, speaker: newName.trim(), speakerConfirmed: true } : s))
    persist(meetings.map((m) => (m.id === current.id ? { ...m, segments } : m)))
    setRenaming(null); setNewName('')
  }

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return meetings.flatMap((m) => m.segments.filter((s) => s.text.toLowerCase().includes(t)).map((s) => ({ m, s })))
  }, [q, meetings])

  const shown = recording ? live : current?.segments ?? []
  const done = meetings.filter((m) => m.id !== session.current)

  /** En Android el WAV vive en `archivos/capturas`; se pasa la ruta relativa al selector. */
  const saveAudio = async (m: Meeting): Promise<void> => {
    if (!m.audioPath) return
    try {
      const ruta = NATIVE ? (m.audioPath.split('/archivos/')[1] ?? m.audioPath) : m.audioPath
      const nombre = await window.api.exportFile(ruta)
      if (nombre) flash(`💾 Audio guardado: ${nombre}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const exportPdf = async (m: Meeting): Promise<void> => {
    try {
      const f = await window.api.generatePdf(m.title, m.minutes ? minutesToMarkdown(m) : toMarkdown(m), 'reunion')
      flash(`📄 PDF guardado: ${f}`)
    } catch (e) { setError((e as Error).message) }
  }

  const list = (
    <>
      <input placeholder="Buscar en todas las reuniones…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en las reuniones" />
      <div className="list">
        {q && hits.map(({ m, s }, i) => (
          <div key={i} className="item pick" onClick={() => { setSel(m.id); setQ(''); setHistory(false) }}>
            <small className="muted">{m.title} · {fmtTime(s.start)}</small><br />{s.text.slice(0, 120)}
          </div>
        ))}
        {!q && done.map((m) => (
          <div key={m.id} className={`item pick ${m.id === sel ? 'sel' : ''}`} onClick={() => { if (!recording) { setSel(m.id); setHistory(false) } }}>
            <b>{m.title}</b><br /><small className="muted">{fmtTime(m.durationSec)} · {m.segments.length} frases{m.minutes ? ' · acta' : ''}</small>
          </div>
        ))}
        {!q && !done.length && <p className="muted">Aún no hay reuniones grabadas.</p>}
      </div>
    </>
  )

  return (
    <div className={`view ${ANDROID ? '' : 'split'}`}>
      {!ANDROID && (
        <section className="card side">
          <header><h2><ToolIcon tool="reuniones" /> Reuniones</h2></header>
          {list}
        </section>
      )}
      {history && <Sheet title="🗂 Historial de reuniones" onClose={() => setHistory(false)}>{list}</Sheet>}

      <section className="card wide grow">
        {notice && <div className="notice" role="status">{notice}</div>}
        {ANDROID && (
          <header>
            <h2><ToolIcon tool="reuniones" /> Reuniones</h2>
            <button className="chip" onClick={() => setHistory(true)} disabled={recording}>🗂 Historial ({done.length})</button>
          </header>
        )}

        <div className="recorder">
          {SOURCES.length > 1 && (
            <div className="seg" role="radiogroup" aria-label="Fuente de audio">
              {SOURCES.map((k) => (
                <button key={k} role="radio" aria-checked={source === k} className={source === k ? 'on' : ''}
                  disabled={recording} onClick={() => setSource(k)}>{SRC[k]}</button>
              ))}
            </div>
          )}
          <RecButton recording={recording} level={level} onClick={() => void (recording ? stop() : start())}
            idle={current ? 'Nueva reunión' : 'Empezar a transcribir'} active="Terminar y guardar"
            hint={recording ? fmtTime(elapsed) : undefined} />
          {pending > 0 && <BotTyping small label={recording ? `Transcribiendo (${pending} en cola)` : 'Terminando de transcribir'} />}
        </div>
        {!recording && !current && (
          <p className="muted center">Todo se procesa en tu {ANDROID ? 'teléfono' : 'equipo'}. Avisa a los participantes antes de grabar.{ANDROID ? ' La pantalla se mantiene encendida mientras grabas y la reunión se guarda poco a poco.' : ' Con «Ambos» usa auriculares para evitar eco.'}</p>
        )}
        {error && <p className="warn" role="alert">{error} <button className="link" onClick={() => setError('')}>cerrar</button></p>}

        {current && !recording && (
          <>
            <input className="title" value={current.title} aria-label="Título de la reunión"
              onChange={(e) => persist(meetings.map((m) => (m.id === current.id ? { ...m, title: e.target.value } : m)))} />
            <div className="actions">
              <button className="primary" onClick={() => void makeMinutes()} disabled={!!busy}>📋 {current.minutes ? 'Rehacer acta' : 'Generar acta'}</button>
              <button onClick={async () => flash(`📝 ${await window.api.exportNote(current.title, minutesToMarkdown(current), ['reunion'])}`)}>📝 A notas</button>
              <MoreMenu items={[
                { label: '📄 Exportar PDF', onClick: () => void exportPdf(current) },
                { label: '⬇ Subtítulos (.srt)', onClick: () => void download(`${current.title}.srt`, toSubtitles(current.segments, 'srt')) },
                ...(current.audioPath ? [{ label: '💾 Guardar audio', onClick: () => void saveAudio(current) }] : []),
                { label: '🗑 Eliminar reunión', danger: true, onClick: () => { persist(meetings.filter((m) => m.id !== current.id)); setSel(null) } }
              ]} />
            </div>
            {current.audioPath && (
              <div className="player">
                {audioUrl
                  ? <audio controls preload="metadata" src={audioUrl} aria-label="Audio de la reunión" />
                  : audioError
                    ? <span className="warn">{audioError}</span>
                    : <span className="muted">Cargando audio…</span>}
              </div>
            )}
            {busy && <BotTyping label={busy.replace(/…$/, '')} />}
          </>
        )}

        {current?.minutes && (
          <div className="minutes">
            {current.minutes.summary && <><h3>Resumen ejecutivo</h3><p>{current.minutes.summary}</p></>}
            {current.minutes.topics.length > 0 && (<><h3>Temas tratados</h3><ul>{current.minutes.topics.map((t, i) => <li key={i}>{t}</li>)}</ul></>)}
            {current.minutes.decisions.length > 0 && (<><h3>Decisiones</h3><ul>{current.minutes.decisions.map((t, i) => <li key={i}>{t}</li>)}</ul></>)}
            {current.minutes.agreements.length > 0 && (<><h3>Acuerdos</h3><ul>{current.minutes.agreements.map((t, i) => <li key={i}>{t}</li>)}</ul></>)}
            {current.minutes.tasks.length > 0 && (
              <>
                <h3>Tareas pendientes</h3>
                <ul className="tasks">
                  {current.minutes.tasks.map((t: MeetingTask, i: number) => (
                    <li key={i}>
                      <label className="inline check">
                        <input type="checkbox" checked={t.done} onChange={() => toggleTask(i)} /> {t.text}
                      </label>
                      {(t.owner || t.due) && <small className="muted">{(t.owner && `Responsable: ${t.owner}`)}${(t.owner && t.due) && ' · '}{(t.due && `Fecha: ${t.due}`)}</small>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="page transcript">
          {shown.length === 0 && !draft && <p className="muted">{recording ? 'Esperando voz…' : ANDROID ? 'Pulsa el micrófono para empezar o abre el historial.' : 'Elige una reunión o empieza una nueva.'}</p>}
          {shown.map((s, i) => (
            <p key={i}>
              <span className="ts">{fmtTime(s.start)}</span>
              {s.speaker && (
                renaming === i
                  ? <input className="speaker-input" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onBlur={() => rename(i)} onKeyDown={(e) => { if (e.key === 'Enter') rename(i); if (e.key === 'Escape') setRenaming(null) }} />
                  : <b onClick={() => { setRenaming(i); setNewName(s.speaker ?? '') }} title="Cambiar el nombre de quien habla" style={{ cursor: 'pointer' }}> {s.speaker}: </b>
              )}
              {s.text}
            </p>
          ))}
          {recording && draft && <p className="live-line" aria-live="polite"><span className="ts">{fmtTime(elapsed)}</span>{draft}</p>}
        </div>
      </section>
    </div>
  )
}
