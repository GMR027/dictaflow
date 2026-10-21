import { describe, expect, it } from 'vitest'
import { fromIcs, toIcs, type CalendarEvent } from './calendar'

const evento = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'abc',
  title: 'Reunión de equipo',
  notes: 'Agenda del lunes',
  start: new Date('2026-03-02T10:00:00Z').getTime(),
  durationMin: 45,
  location: 'Sala 3',
  reminder: false,
  remindBeforeMin: 0,
  ...over
})

describe('calendario en ICS', () => {
  it('exporta un archivo ICS válido', () => {
    const ics = toIcs([evento()])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:Reunión de equipo')
    // El final se expresa con DTEND (válido en ICS) y no con DURATION.
    expect(ics).toContain('DTEND:')
  })

  it('no repite los mismos eventos', () => {
    const ics = toIcs([evento(), evento({ id: 'def', title: 'Otro' })])
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('lo que exporta se puede volver a leer', () => {
    const ics = toIcs([evento(), evento({ id: 'def', title: 'Otro', start: evento().start + 3600_000 })])
    const leidos = fromIcs(ics)
    expect(leidos).toHaveLength(2)
    expect(leidos[0].title).toBe('Reunión de equipo')
    expect(leidos[0].durationMin).toBe(45)
    expect(leidos[0].location).toBe('Sala 3')
    expect(leidos[1].title).toBe('Otro')
  })

  it('añade la alarma cuando es recordatorio', () => {
    const ics = toIcs([evento({ reminder: true, remindBeforeMin: 15 })])
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:-PT15M')
  })
  it('no pone alarma si no es recordatorio', () => {
    const ics = toIcs([evento()])
    expect(ics).not.toContain('BEGIN:VALARM')
  })

  it('lee un ICS hecho fuera', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Otro//ES',
      'BEGIN:VEVENT',
      'UID:xyz',
      'DTSTAMP:20260302T090000Z',
      'DTSTART:20260302T150000Z',
      'DTEND:20260302T163000Z',
      'SUMMARY:Revisión de código',
      'DESCRIPTION:Traer los informes',
      'LOCATION:Sala 1',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const leidos = fromIcs(ics)
    expect(leidos).toHaveLength(1)
    expect(leidos[0].title).toBe('Revisión de código')
    expect(leidos[0].notes).toBe('Traer los informes')
    expect(leidos[0].durationMin).toBe(90)
  })

  it('un calendario vacío sigue siendo válido', () => {
    const ics = toIcs([])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(fromIcs(ics)).toEqual([])
  })
})
