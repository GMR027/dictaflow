import { describe, expect, it } from 'vitest'
import { parseIcs, toIcs } from './ics'
import type { CalendarEvent } from './calendar'

const evento = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'abc', title: 'Reunión de equipo', notes: 'Agenda del lunes', start: Date.UTC(2026, 2, 2, 10), durationMin: 45,
  location: 'Sala 3', reminder: true, remindBeforeMin: 15, ...over
})

describe('lector ICS de Android', () => {
  it('lee lo que exporta DictaFlow (la alarma no se confunde con el evento)', () => {
    const leidos = parseIcs(toIcs([evento({ title: 'Otro', start: evento().start + 3600_000, notes: 'a, b; c\nd' }), evento()]))
    expect(leidos).toHaveLength(2)
    expect(leidos[0]).toEqual({ title: 'Reunión de equipo', notes: 'Agenda del lunes', start: Date.UTC(2026, 2, 2, 10), durationMin: 45, location: 'Sala 3' })
    expect(leidos[1].title).toBe('Otro')
    expect(leidos[1].notes).toBe('a, b; c\nd')
  })

  it('lee un ICS hecho fuera: líneas partidas, DURATION, hora local y día completo', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'DTSTART:20260302T150000Z', 'DTEND:20260302T163000Z', 'SUMMARY:Revisión de ', ' código', 'DESCRIPTION:Traer los informes', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;TZID=America/Mexico_City:20260303T090000', 'DURATION:PT1H15M', 'SUMMARY:Llamada', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260304', 'SUMMARY:Feriado', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Sin fecha', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const [a, b, c] = parseIcs(ics)
    expect(parseIcs(ics)).toHaveLength(3)
    expect(a).toMatchObject({ title: 'Revisión de código', notes: 'Traer los informes', durationMin: 90 })
    expect(b).toMatchObject({ title: 'Llamada', start: new Date(2026, 2, 3, 9).getTime(), durationMin: 75 })
    expect(c).toMatchObject({ title: 'Feriado', start: new Date(2026, 2, 4).getTime(), durationMin: 1440 })
  })

  it('un calendario vacío no tiene eventos', () => {
    expect(parseIcs(toIcs([]))).toEqual([])
    expect(parseIcs('basura')).toEqual([])
  })
})
