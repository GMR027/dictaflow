// Cola de transcripciones con prioridad.
//
// Dos reglas:
//  1. Solo se manda una transcripción al motor a la vez. El modelo de Whisper
//     usa una única sesión de onnxruntime, que no admite inferencias en
//     paralelo; además, en CPU, dos inferencias simultáneas se roban el tiempo.
//  2. La transcripción definitiva va siempre antes que el borrador, y cuando
//     llega una definitiva se descartan los borradores en cola: ya están
//     obsoletos, porque la definitiva transcribe el mismo audio.

/** Prioridad de una transcripción: la definitiva nunca espera a un borrador. */
export type SttPriority = 'final' | 'draft'

export interface QueueJob<T> {
  id: number
  priority: SttPriority
  exec: () => Promise<T>
}

export interface QueueResult<T> {
  value: T
  /** Milisegundos que tardó la ejecución (sin contar la espera en cola). */
  ms: number
}

const rank = (p: SttPriority): number => (p === 'final' ? 0 : 1)

interface Pending<T> extends QueueJob<T> {
  resolve: (r: QueueResult<T>) => void
  reject: (e: Error) => void
}

export class PriorityQueue<T> {
  private queue: Pending<T>[] = []
  private inFlight: Pending<T> | null = null

  /** Peticiones esperando turno. */
  get pending(): number {
    return this.queue.length
  }

  /** true si hay algo ejecutándose ahora mismo. */
  get busy(): boolean {
    return this.inFlight !== null
  }

  /**
   * Encola un trabajo. Si es definitivo, los borradores que quedaban en la
   * cola se descartan: sus resultados ya no sirven de nada.
   */
  enqueue(job: QueueJob<T>): Promise<QueueResult<T>> {
    return new Promise<QueueResult<T>>((resolve, reject) => {
      if (job.priority === 'final') {
        const descartados = this.queue.filter((j) => j.priority === 'draft')
        this.queue = this.queue.filter((j) => j.priority === 'final')
        // Los descartados no pueden quedarse colgados: su promesa se cierra ya.
        for (const d of descartados) d.reject(new Error('Descartado: llegó antes la transcripción definitiva.'))
      }
      this.queue.push({ ...job, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    if (this.inFlight || !this.queue.length) return
    this.queue.sort((a, b) => rank(a.priority) - rank(b.priority))
    const job = this.queue.shift()!
    this.inFlight = job
    const t0 = performance.now()
    job.exec()
      .then((value) => job.resolve({ value, ms: Math.round(performance.now() - t0) }))
      .catch((e) => job.reject(e as Error))
      .finally(() => {
        this.inFlight = null
        // El siguiente trabajo se lanza al terminar este: nunca hay dos a la vez.
        this.pump()
      })
  }
}
