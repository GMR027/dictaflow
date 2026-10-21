// Calendario y recordatorios.
//
// Los eventos se guardan en el propio equipo y se pueden exportar en formato
// ICS (RFC 5545), que es el que entienden Google Calendar, Thunderbird, GNOME
// Calendar, Outlook… y los calendarios del sistema. También se pueden importar
// los que ya tengas.
//
// Los recordatorios son avisos locales: suenan cuando toca y no salen de tu
// equipo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import ical, { ICalAlarmType } from 'ical-generator'
import nodeIcal from 'node-ical'
import { dataDir } from './paths'
import type { CalendarEvent, Reminder } from '@shared/calendar'

export type { CalendarEvent, Reminder }


const eventsFile = join(dataDir, 'calendar.json')
const remindersFile = join(dataDir, 'reminders.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export const listEvents = (): CalendarEvent[] => readJson<CalendarEvent[]>(eventsFile, [])
export const saveEvent = (e: CalendarEvent): void => {
  const all = listEvents()
  const i = all.findIndex((x) => x.id === e.id)
  if (i >= 0) all[i] = e
  else all.push(e)
  all.sort((a, b) => a.start - b.start)
  writeJson(eventsFile, all)
}
export const removeEvent = (id: string): void => writeJson(eventsFile, listEvents().filter((e) => e.id !== id))

export const listReminders = (): Reminder[] => readJson<Reminder[]>(remindersFile, [])
export const saveReminder = (r: Reminder): void => {
  const all = listReminders()
  const i = all.findIndex((x) => x.id === r.id)
  if (i >= 0) all[i] = r
  else all.push(r)
  all.sort((a, b) => a.at - b.at)
  writeJson(remindersFile, all)
}
export const removeReminder = (id: string): void => writeJson(remindersFile, listReminders().filter((r) => r.id !== id))

/** Convierte los eventos de DictaFlow en un calendario ICS. */
export function toIcs(events: CalendarEvent[], name = 'DictaFlow'): string {
  const cal = ical({
    name,
    prodId: '-//DictaFlow//ES'
  })
  for (const e of events) {
    // createEvent ya añade el evento al calendario: calling events() otra vez lo duplicaría.
    const ev = cal.createEvent({
      summary: e.title,
      start: new Date(e.start),
      end: new Date(e.start + Math.max(1, e.durationMin) * 60000),
      description: e.notes || undefined,
      location: e.location || undefined
    })
    ev.uid(`${e.id}@dictaflow`)
    if (e.reminder && e.remindBeforeMin > 0) {
      // El disparador en segundos: 15 minutos son 900.
      ev.alarms([{ type: ICalAlarmType.display, triggerBefore: e.remindBeforeMin * 60, description: e.title }])
    }
  }
  return cal.toString()
}

/** Lee un calendario ICS y devuelve sus eventos. */
export function fromIcs(text: string): { title: string; notes: string; start: number; durationMin: number; location: string }[] {
  const parsed = nodeIcal.sync.parseICS(text)
  const out: { title: string; notes: string; start: number; durationMin: number; location: string }[] = []
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key]
    if (!ev || ev.type !== 'VEVENT') continue
    const start = ev.start instanceof Date ? ev.start.getTime() : new Date(String(ev.start)).getTime()
    if (Number.isNaN(start)) continue
    const end = ev.end instanceof Date ? ev.end.getTime() : start + 3600_000
    out.push({
      title: String(ev.summary ?? 'Sin título'),
      notes: String(ev.description ?? ''),
      start,
      durationMin: Math.max(1, Math.round((end - start) / 60000)),
      location: String(ev.location ?? '')
    })
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Los recordatorios que tocan ahora. Se marcan como avisados para no
 * repetir el aviso.
 */
export function dueReminders(now = Date.now()): Reminder[] {
  const all = listReminders()
  const due = all.filter((r) => !r.done && r.at <= now)
  if (due.length) {
    const ids = new Set(due.map((r) => r.id))
    writeJson(remindersFile, all.map((r) => (ids.has(r.id) ? { ...r, done: true } : r)))
  }
  return due
}

/** Los eventos de recordatorio que aún no han avisado. */
export function dueEventReminders(now = Date.now()): CalendarEvent[] {
  const all = listEvents()
  const due = all.filter((e) => e.reminder && !e.notified && e.start - e.remindBeforeMin * 60000 <= now)
  if (due.length) {
    const ids = new Set(due.map((e) => e.id))
    writeJson(eventsFile, all.map((e) => (ids.has(e.id) ? { ...e, notified: true } : e)))
  }
  return due
}
