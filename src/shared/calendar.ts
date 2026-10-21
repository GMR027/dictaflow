// Calendario y recordatorios: tipos compartidos con la interfaz.

export interface CalendarEvent {
  id: string
  title: string
  /** Descripción opcional. */
  notes: string
  /** Inicio en epoch ms. */
  start: number
  /** Duración en minutos. */
  durationMin: number
  /** Lugar. */
  location: string
  /** true si además de evento es un recordatorio. */
  reminder: boolean
  /** Minutos antes del inicio en que avisa. */
  remindBeforeMin: number
  /** Si ya se avisó, para no repetir. */
  notified?: boolean
}

export interface Reminder {
  id: string
  text: string
  /** Cuándo avisar, en epoch ms. */
  at: number
  done: boolean
}
