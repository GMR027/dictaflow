// Tipos de los trabajos en segundo plano.
// Están en `shared` porque la interfaz los muestra y los cancela.

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  /** Tipo de trabajo: cada vista sabe qué mostrar. */
  kind: string
  title: string
  state: JobState
  /** 0-100 */
  progress: number
  /** Qué está pasando ahora mismo. */
  detail: string
  createdAt: number
  updatedAt: number
  error?: string
  /** Resultado: normalmente la ruta del fichero producido. */
  result?: string
  /** Punto de reanudación. */
  resume?: Record<string, unknown>
  /** Datos del trabajo (por ejemplo, qué documento se está convirtiendo). */
  payload?: Record<string, unknown>
}
