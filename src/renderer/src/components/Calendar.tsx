import { useEffect, useState } from 'react'
import type { CalendarEvent, Reminder } from '@shared/calendar'
import { useApp } from '../store'

const fecha = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Campo de fecha y hora local, en el formato que usa `<input type="datetime-local">`. */
const toLocalInput = (ms: number): string => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
const fromLocalInput = (v: string): number => new Date(v).getTime()

/**
 * Agenda y recordatorios.
 *
 * Los eventos se guardan en el equipo y se pueden exportar en .ics, que es lo
 * que entienden los calendarios de Google, Thunderbird, GNOME u Outlook. Los
 * recordatorios avisan con una notificación del sistema.
 */
export function Calendar(): JSX.Element {
  const { flash, notice } = useApp()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000))
  const [duration, setDuration] = useState(60)
  const [notes, setNotes] = useState('')
  const [remind, setRemind] = useState(10)
  const [asReminder, setAsReminder] = useState(false)

  const [remText, setRemText] = useState('')
  const [remAt, setRemAt] = useState(() => toLocalInput(Date.now() + 3600_000))

  const refresh = (): void => {
    void window.api.listEvents().then(setEvents)
    void window.api.listReminders().then(setReminders)
  }
  useEffect(refresh, [])

  const addEvent = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true); setError('')
    try {
      await window.api.saveEvent({
        id: crypto.randomUUID(),
        title: title.trim(),
        notes,
        start: fromLocalInput(when),
        durationMin: duration,
        location: '',
        reminder: asReminder,
        remindBeforeMin: asReminder ? remind : 0
      })
      setTitle(''); setNotes('')
      refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const addReminder = async (): Promise<void> => {
    if (!remText.trim()) return
    await window.api.saveReminder({ id: crypto.randomUUID(), text: remText.trim(), at: fromLocalInput(remAt), done: false })
    setRemText('')
    refresh()
  }

  const exportIcs = async (): Promise<void> => {
    const f = await window.api.exportCalendar()
    flash(`Calendario exportado: ${f}`)
  }

  const importIcs = async (f: File | undefined): Promise<void> => {
    if (!f) return
    const n = await window.api.importCalendar(await f.text())
    flash(`${n} eventos importados`)
    refresh()
  }

  const pendientes = reminders.filter((r) => !r.done)

  return (
    <div className="view split">
      <section className="card side">
        <header><h2>🗓 Agenda</h2></header>
        <div className="row">
          <button onClick={() => void exportIcs()} disabled={!events.length}>⬇ Exportar .ics</button>
          <label className="btn">⬆ Importar .ics
            <input type="file" accept=".ics" hidden onChange={(e) => { void importIcs(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        <p className="muted">El archivo .ics se puede importar en Google Calendar, Thunderbird, GNOME Calendar u Outlook.</p>
        <div className="list">
          {events.length === 0 && <p className="muted">Todavía no hay eventos.</p>}
          {events.map((e) => (
            <div key={e.id} className="item pick">
              <b>{e.title}</b><br />
              <small className="muted">{fecha(e.start)} · {e.durationMin} min{e.reminder ? ` · avisa ${e.remindBeforeMin} min antes` : ''}</small>
              {e.notes && <><br /><small>{e.notes.slice(0, 120)}</small></>}
              <button className="link" onClick={() => void window.api.removeEvent(e.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card wide">
        {notice && <div className="notice" role="status">{notice}</div>}
        <h2>Nuevo evento</h2>
        <div className="row">
          <input className="grow" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Cuando <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          <label>Duración <input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /> min</label>
        </div>
        <textarea value={notes} placeholder="Descripción (opcional)" onChange={(e) => setNotes(e.target.value)} />
        <div className="row">
          <label className="inline check">
            <input type="checkbox" checked={asReminder} onChange={(e) => setAsReminder(e.target.checked)} /> También es un recordatorio
          </label>
          {asReminder && (
            <label>Avisar <input type="number" min={0} step={5} value={remind} onChange={(e) => setRemind(Number(e.target.value))} /> min antes</label>
          )}
          <button className="primary" onClick={() => void addEvent()} disabled={busy || !title.trim()}>Añadir evento</button>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}

        <h2>🔔 Recordatorios</h2>
        <p className="muted">Avisos del sistema cuando toca. No salen de tu equipo.</p>
        <div className="row">
          <input className="grow" placeholder="¿Qué hay que recordar?" value={remText} onChange={(e) => setRemText(e.target.value)} />
          <label>Cuando <input type="datetime-local" value={remAt} onChange={(e) => setRemAt(e.target.value)} /></label>
          <button onClick={() => void addReminder()} disabled={!remText.trim()}>Añadir</button>
        </div>
        <div className="list">
          {pendientes.length === 0 && <p className="muted">No hay recordatorios pendientes.</p>}
          {pendientes.map((r) => (
            <div key={r.id} className="item pick">
              <b>{r.text}</b><br /><small className="muted">{fecha(r.at)}</small>
              <button className="link" onClick={() => void window.api.removeReminder(r.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
