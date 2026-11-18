// Calendario en formato ICS (RFC 5545), el que entienden Google Calendar, Thunderbird, Outlook…
//
// `toIcs` lo usan el escritorio y Android. `parseIcs` es el lector de Android (sin Node); el
// escritorio usa node-ical, que además entiende zonas horarias con nombre y eventos repetidos.
import ical, { ICalAlarmType } from 'ical-generator'
import type { CalendarEvent } from './calendar'

/** Un evento leído de un ICS, antes de guardarlo. */
export interface IcsEvent { title: string; notes: string; start: number; durationMin: number; location: string }

/** Convierte los eventos de DictaFlow en un calendario ICS. */
export function toIcs(events: CalendarEvent[], name = 'DictaFlow'): string {
  const cal = ical({ name, prodId: '-//DictaFlow//ES' })
  for (const e of events) {
    // createEvent ya añade el evento al calendario: llamar a events() otra vez lo duplicaría.
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

/**
 * Fecha de DTSTART/DTEND: UTC (`…Z`), hora local o día completo. Con TZID se toma como hora local
 * del teléfono (lo habitual: el calendario es de tu zona).
 */
function icsDate(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return NaN
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const
  return z ? Date.UTC(...parts) : new Date(...parts).getTime()
}

/** Duración ISO 8601 (`PT1H30M`, `P1D`) en minutos. */
function icsDuration(value: string): number {
  const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim())
  if (!m) return NaN
  const [, w = '0', d = '0', h = '0', mi = '0'] = m
  return Number(w) * 10080 + Number(d) * 1440 + Number(h) * 60 + Number(mi)
}

const unescape = (t: string): string => t.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Lee los eventos de un calendario ICS, ordenados por inicio. */
export function parseIcs(text: string): IcsEvent[] {
  // Las líneas largas siguen en la siguiente, que empieza con un espacio o un tabulador.
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const out: IcsEvent[] = []
  let cur: Record<string, [string, string]> | null = null
  let depth = 0
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue }
    if (!cur) continue
    if (line.startsWith('BEGIN:')) { depth++; continue }
    if (line.startsWith('END:') && line !== 'END:VEVENT') { depth--; continue }
    if (line === 'END:VEVENT') {
      const start = cur.DTSTART ? icsDate(cur.DTSTART[1]) : NaN
      if (!Number.isNaN(start)) {
        const allDay = /VALUE=DATE(?!-)/.test(cur.DTSTART[0])
        const end = cur.DTEND ? icsDate(cur.DTEND[1]) : NaN
        const dur = cur.DURATION ? icsDuration(cur.DURATION[1]) : NaN
        const minutes = !Number.isNaN(end) ? Math.round((end - start) / 60000) : !Number.isNaN(dur) ? dur : allDay ? 1440 : 60
        out.push({
          title: unescape(cur.SUMMARY?.[1] ?? '') || 'Sin título',
          notes: unescape(cur.DESCRIPTION?.[1] ?? ''),
          start,
          durationMin: Math.max(1, minutes),
          location: unescape(cur.LOCATION?.[1] ?? '')
        })
      }
      cur = null
      continue
    }
    if (depth > 0) continue // VALARM y demás bloques dentro del evento
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name, ...params] = line.slice(0, colon).split(';')
    cur[name.toUpperCase()] = [params.join(';'), line.slice(colon + 1)]
  }
  return out.sort((a, b) => a.start - b.start)
}
