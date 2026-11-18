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

/** Nombres y descripción de los pasos disponibles. */
export const STEP_INFO: Record<StepType, { label: string; detail: string }> = {
  summary: { label: 'Resumir', detail: 'Resume el texto con la IA.' },
  notes: { label: 'Convertir en notas', detail: 'Convierte el texto en notas estructuradas en Markdown.' },
  minutes: { label: 'Generar acta', detail: 'Genera el acta con resumen, decisiones y tareas.' },
  pdf: { label: 'Guardar como PDF', detail: 'Escribe el texto en un PDF.' },
  note: { label: 'Guardar como nota', detail: 'Guarda el texto como nota Markdown en tu carpeta de notas.' },
  event: { label: 'Crear evento', detail: 'Crea un evento en la agenda con el texto como descripción.' },
  tts: { label: 'Leer en voz alta', detail: 'Genera el audio del texto con la voz elegida.' }
}
