import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meeting, Segment } from '@shared/types'
import { Mic, Segmenter } from '../audio'
import { fmtTime, toSubtitles } from '../audioio'
import { download } from '../textutil'
import { useApp } from '../store'

type Source = 'mic' | 'system' | 'both'
const SRC: Record<Source, string> = { mic: '🎤 Micrófono', system: '🔊 Audio del sistema', both: '🎤+🔊 Ambos' }

const toMarkdown = (m: Meeting): string =>
  `# ${m.title}\n\n_${new Date(m.createdAt).toLocaleString()} · ${fmtTime(m.durationSec)}_\n\n${m.summary ? m.summary + '\n\n---\n\n' : ''}## Transcripción\n\n` +
  m.segments.map((s) => `**[${fmtTime(s.start)}]${s.speaker ? ' ' + s.speaker : ''}:** ${s.text}`).join('\n\n')

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
  const mic = useRef<Mic | null>(null)
  const sysSeg = useRef<Segmenter | null>(null)
  const unsub = useRef<(() => void) | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const segs = useRef<Segment[]>([])
  const t0 = useRef(0)
  /** Instante en que arrancó cada fuente, para compartir una sola línea de tiempo. */
  const micOffset = useRef(0)
  const sysOffset = useRef(0)

  useEffect(() => { void window.api.getCollection<Meeting>('meetings').then(setMeetings) }, [])
  useEffect(() => () => { void stop(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: Meeting[]): void => { setMeetings(next); void window.api.saveCollection('meetings', next) }
  const current = meetings.find((m) => m.id === sel) ?? null

  /**
   * Encola un fragmento para transcribir. `offset` es el instante en que arrancó
   * esa fuente: con un reloj común, las marcas de tiempo del micrófono y del
   * audio del sistema quedan en la misma escala y se pueden ordenar.
   */
  const enqueue = (pcm: Float32Array, start: number, offset: number, speaker?: string): void => {
    setPending((n) => n + 1)
    queue.current = queue.current.then(async () => {
      try {
        const r = await window.api.transcribeDetailed(pcm, settings.primaryLang)
        if (r.text) {
          const at = offset + start
          segs.current = [...segs.current, { start: at, end: at + pcm.length / 16000, text: r.text, speaker }].sort((a, b) => a.start - b.start)
          setLive(segs.current)
        }
      } catch (e) { setError((e as Error).message) } finally { setPending((n) => n - 1) }
    })
  }

  const start = async (): Promise<void> => {
    setError(''); segs.current = []; setLive([]); setSel(null)
    t0.current = Date.now()
    const tag = (s: string): string | undefined => (source === 'both' ? s : undefined)
    const clock = performance.now()
    try {
      if (source !== 'mic') {
        micOffset.current = (performance.now() - clock) / 1000
        mic.current = new Mic({ deviceId: settings.micDeviceId, mode: 'continuous', onLevel: () => undefined, filters: settings.micFilters, onSegment: (p, t) => enqueue(p, t, micOffset.current, tag('Yo')) })
        await mic.current.start()
      }
      if (source !== 'mic') {
        sysOffset.current = (performance.now() - clock) / 1000
        sysSeg.current = new Segmenter('continuous', (p, t) => enqueue(p, t, sysOffset.current, tag('Sistema')))
        unsub.current = window.api.onSystemAudio((c) => sysSeg.current?.feed(c))
        await window.api.startSystemAudio()
      }
      setRecording(true)
    } catch (e) { setError((e as Error).message); await stop(true) }
  }

  const stop = async (discard = false): Promise<void> => {
    await mic.current?.stop(); mic.current = null
    if (sysSeg.current) { await window.api.stopSystemAudio(); unsub.current?.(); sysSeg.current.flush(); sysSeg.current = null }
    setRecording(false)
    await queue.current
    if (discard || !segs.current.length) return
    const now = new Date()
    const m: Meeting = {
      id: crypto.randomUUID(), title: `Reunión ${now.toLocaleDateString()} ${now.toLocaleTimeString().slice(0, 5)}`,
      createdAt: t0.current, durationSec: (Date.now() - t0.current) / 1000, source, segments: segs.current, summary: ''
    }
    setMeetings((all) => { const next = [m, ...all]; void window.api.saveCollection('meetings', next); return next })
    setSel(m.id); setLive([])
  }

  const makeMinutes = async (kind: 'meeting' | 'study'): Promise<void> => {
    if (!current) return
    setBusy('Generando…'); setError('')
    try {
      const text = current.segments.map((s) => `[${fmtTime(s.start)}]${s.speaker ? ' ' + s.speaker : ''}: ${s.text}`).join('\n')
      const summary = await window.api.generate(kind, text, settings.primaryLang)
      persist(meetings.map((m) => (m.id === current.id ? { ...m, summary } : m)))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return meetings.flatMap((m) => m.segments.filter((s) => s.text.toLowerCase().includes(t)).map((s) => ({ m, s })))
  }, [q, meetings])

  const shown = recording ? live : current?.segments ?? []

  return (
    <div className="view split">
      <section className="card side">
        <header><h2>🗂 Reuniones</h2></header>
        <input placeholder="Buscar en todas…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {q && hits.map(({ m, s }, i) => (
            <div key={i} className="item pick" onClick={() => { setSel(m.id); setQ('') }}>
              <small className="muted">{m.title} · {fmtTime(s.start)}</small><br />{s.text.slice(0, 120)}
            </div>
          ))}
          {!q && meetings.map((m) => (
            <div key={m.id} className={`item pick ${m.id === sel ? 'sel' : ''}`} onClick={() => !recording && setSel(m.id)}>
              <b>{m.title}</b><br /><small className="muted">{fmtTime(m.durationSec)} · {m.segments.length} frases</small>
            </div>
          ))}
          {!q && !meetings.length && <p className="muted">Aún no hay reuniones grabadas.</p>}
        </div>
      </section>

      <section className="card wide">
        {notice && <div className="notice" role="status">{notice}</div>}
        <div className="row">
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={recording} aria-label="Fuente de audio">
            {Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className={`mic ${recording ? 'rec' : ''}`} onClick={() => void (recording ? stop() : start())}>
            {recording ? '■ Terminar y guardar' : '● Empezar a transcribir'}
          </button>
          <span className="muted">{recording ? `Grabando… ${pending ? '(transcribiendo)' : ''}` : pending ? 'Terminando de transcribir…' : ''}</span>
        </div>
        <p className="muted">Todo se procesa en tu equipo. Avisa a los participantes antes de grabar. Con «Ambos» usa auriculares para evitar eco.</p>
        {error && <p className="warn" role="alert">{error}</p>}

        {current && !recording && (
          <div className="row">
            <input className="grow title" value={current.title} onChange={(e) => persist(meetings.map((m) => (m.id === current.id ? { ...m, title: e.target.value } : m)))} />
            <button onClick={() => void makeMinutes('meeting')} disabled={!!busy}>📋 Generar acta</button>
            <button onClick={() => void makeMinutes('study')} disabled={!!busy}>🎓 Apuntes de clase</button>
            <button onClick={async () => flash(`📝 ${await window.api.exportNote(current.title, toMarkdown(current), ['reunion'])}`)}>📝 A notas</button>
            <button onClick={async () => {
              try {
                const f = await window.api.generatePdf(current.title, current.summary || toMarkdown(current), 'reunion')
                flash(`📄 PDF guardado: ${f}`)
              } catch (e) { setError((e as Error).message) }
            }}>📄 PDF</button>
            <button onClick={() => void download(`${current.title}.srt`, toSubtitles(current.segments, 'srt'))}>⬇ .srt</button>
            <button className="danger" onClick={() => { persist(meetings.filter((m) => m.id !== current.id)); setSel(null) }}>🗑</button>
            <span className="muted">{busy}</span>
          </div>
        )}
        {current?.summary && !recording && <pre className="ai">{current.summary}</pre>}

        <div className="page transcript">
          {shown.length === 0 && <p className="muted">{recording ? 'Esperando voz…' : 'Elige una reunión o empieza una nueva.'}</p>}
          {shown.map((s, i) => (
            <p key={i}><span className="ts">{fmtTime(s.start)}</span>{s.speaker && <b> {s.speaker}: </b>} {s.text}</p>
          ))}
        </div>
      </section>
    </div>
  )
}
