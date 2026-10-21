// Tipos de las automatizaciones.

/** Tipos de paso que puede hacer una automatización. */
export type StepType = 'summary' | 'notes' | 'minutes' | 'pdf' | 'note' | 'event' | 'tts'

export interface AutomationStep {
  type: StepType
  /** Texto de la nota o del evento. */
  text?: string
  /** Minutos de duración (para el evento). */
  minutes?: number
  /** Minutos desde ahora en que empieza (para el evento). */
  inMinutes?: number
}

export interface Automation {
  id: string
  name: string
  steps: AutomationStep[]
  createdAt: number
}
