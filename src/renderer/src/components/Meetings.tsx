import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meeting, MeetingTask, Segment } from '@shared/types'
import { Mic, Segmenter } from '../audio'
import { fmtTime, toSubtitles } from '../audioio'
import { download } from '../textutil'
import { useApp } from '../store'

type Source = 'mic' | 'system' | 'both'
const SRC: Record<Source, string> = { mic: '🎤 Micrófono', system: '🔊 Audio del sistema', both: '🎤+🔊 Ambos' }

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
  const mic = useRef<Mic | null>(null)
  const sysSeg = useRef<Segmenter | null>(null)
  const unsub = useRef<(() => void) | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const segs = useRef<Segment[]>([])
  const t0 = useRef(0)
  /** Instante en que arrancó cada fuente, para compartir una sola línea de tiempo. */
  const micOffset = useRef(0)
  const sysOffset = useRef(0)
  /** Id de la grabación en curso. */
  const session = useRef('')
  /** Audio acumulado para no enviar un trozo por cada bloque de 20 ms. */
  const audioBuf = useRef<Float32Array[]>([])

  /** Manda el audio grabado al proceso principal, en bloques de ~1 s. */
  const record = (chunk: Float32Array): void => {
    if (!session.current) return
    audioBuf.current.push(chunk)
    const total = audioBuf.current.reduce((n, c) => n + c.length, 0)
    if (total < 16000) return
    const all = new Float32Array(total)
    let o = 0
    for (const c of audioBuf.current) { all.set(c, o); o += c.length }
    audioBuf.current = []
    void window.api.pushMeetingAudio(session.current, all)
  }

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
    session.current = crypto.randomUUID()
    await window.api.startMeetingAudio(session.current)
    try {
      if (source !== 'system') {
        micOffset.current = (performance.now() - clock) / 1000
        mic.current = new Mic({ deviceId: settings.micDeviceId, mode: 'continuous', onLevel: () => undefined, filters: settings.micFilters, onAudio: record, onSegment: (p, t) => enqueue(p, t, micOffset.current, tag('Yo')) })
        await mic.current.start()
      }
      if (source !== 'mic') {
        sysOffset.current = (performance.now() - clock) / 1000
        sysSeg.current = new Segmenter('continuous', (p, t) => enqueue(p, t, sysOffset.current, tag('Sistema')))
        unsub.current = window.api.onSystemAudio((c) => { record(c); sysSeg.current?.feed(c) })
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
    const audio = await window.api.stopMeetingAudio(session.current)
    if (discard || !segs.current.length) {
      if (discard) await window.api.discardMeetingAudio(session.current)
      return
    }
    const now = new Date()
    const m: Meeting = {
      id: crypto.randomUUID(), title: `Reunión ${now.toLocaleDateString()} ${now.toLocaleTimeString().slice(0, 5)}`,
      createdAt: t0.current, durationSec: (Date.now() - t0.current) / 1000, source, segments: segs.current, summary: '',
      audioPath: audio?.path
    }
    setMeetings((all) => { const next = [m, ...all]; void window.api.saveCollection('meetings', next); return next })
    setSel(m.id); setLive([])
  }

  /** Genera el acta estructurada: resumen, temas, decisiones, acuerdos y tareas. */
  const makeMinutes = async (): Promise<void> => {
    if (!current) return
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
              <b>{m.title}</b><br /><small className="muted">{fmtTime(m.durationSec)} · {m.segments.length} frases{m.minutes ? ' · acta' : ''}</small>
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
        <p className="muted">Todo se procesa en tu equipo. Avisa a los participantes antes de grabar. Con «Ambos» usa auriculares para evitar eco. El audio se guarda para poder volver a transcribirlo.</p>
        {error && <p className="warn" role="alert">{error}</p>}

        {current && !recording && (
          <div className="row">
            <input className="grow title" value={current.title} onChange={(e) => persist(meetings.map((m) => (m.id === current.id ? { ...m, title: e.target.value } : m)))} />
            <button onClick={() => void makeMinutes()} disabled={!!busy}>📋 Generar acta</button>
            <button onClick={async () => flash(`📝 ${await window.api.exportNote(current.title, minutesToMarkdown(current), ['reunion'])}`)}>📝 A notas</button>
            <button onClick={async () => {
              try {
                const f = await window.api.generatePdf(current.title, current.minutes ? minutesToMarkdown(current) : toMarkdown(current), 'reunion')
                flash(`📄 PDF guardado: ${f}`)
              } catch (e) { setError((e as Error).message) }
            }}>📄 PDF</button>
            <button onClick={() => void download(`${current.title}.srt`, toSubtitles(current.segments, 'srt'))}>⬇ .srt</button>
            <button className="danger" onClick={() => { persist(meetings.filter((m) => m.id !== current.id)); setSel(null) }}>🗑</button>
            <span className="muted">{busy}</span>
          </div>
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
          {shown.length === 0 && <p className="muted">{recording ? 'Esperando voz…' : 'Elige una reunión o empieza una nueva.'}</p>}
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
        </div>
      </section>
    </div>
  )
}
