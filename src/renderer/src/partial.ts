import { SAMPLE_RATE } from './audio'

export interface PartialOptions {
  /** audio acumulado de la frase en curso, o null si no hay */
  snapshot: () => Float32Array | null
  transcribe: (pcm: Float32Array) => Promise<string>
  onDraft: (text: string) => void
  /** true si hay una transcripción definitiva en curso: tiene prioridad */
  busy: () => boolean
  intervalMs?: number
  /** audio mínimo (s) para intentar un borrador */
  minSec?: number
}

/**
 * Texto provisional mientras se habla: transcribe periódicamente lo acumulado de la frase en curso.
 * Nunca se solapan dos peticiones y se descarta todo borrador anterior a un reset() (frase cerrada).
 */
export class PartialTranscriber {
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight = false
  private gen = 0
  private lastLen = 0
  private nextAt = 0

  constructor(private o: PartialOptions) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? 1500)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.reset()
  }

  /** La frase terminó (o se descartó): el borrador deja de valer. */
  reset(): void {
    this.gen++
    this.lastLen = 0
    this.nextAt = 0
    this.o.onDraft('')
  }

  async tick(): Promise<void> {
    if (this.inflight || this.o.busy() || Date.now() < this.nextAt) return
    const pcm = this.o.snapshot()
    if (!pcm || pcm.length / SAMPLE_RATE < (this.o.minSec ?? 0.8) || pcm.length === this.lastLen) return
    const gen = this.gen
    this.inflight = true
    this.lastLen = pcm.length
    const t0 = Date.now()
    try {
      const text = await this.o.transcribe(pcm)
      if (gen === this.gen) this.o.onDraft(text.trim())
    } catch {
      /* un borrador fallido no es un error: llegará la transcripción definitiva */
    } finally {
      this.inflight = false
      // El coste de Whisper es casi fijo por petición: dejar el motor libre el mismo tiempo que ocupó
      // limita su uso al 50 % y reduce lo que espera la transcripción definitiva detrás de un borrador.
      this.nextAt = Date.now() + (Date.now() - t0)
    }
  }
}
