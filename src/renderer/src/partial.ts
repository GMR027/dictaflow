import { SAMPLE_RATE } from './audio'
import { record } from './metrics'

export interface PartialOptions {
  /** audio acumulado de la frase en curso, o null si no hay */
  snapshot: () => Float32Array | null
  /** transcribe el audio; devuelve el texto provisional */
  transcribe: (pcm: Float32Array) => Promise<string>
  onDraft: (text: string) => void
  /** true si hay una transcripción definitiva en curso: tiene prioridad */
  busy: () => boolean
  intervalMs?: number
  /** audio mínimo (s) para intentar un borrador */
  minSec?: number
  /** audio máximo (s) que se reescribe en cada borrador */
  maxSec?: number
  /** true mientras la frase está en el silencio que la va a cerrar */
  closing?: () => boolean
}
/**
 * Texto provisional mientras se habla: transcribe periódicamente lo acumulado de la frase en curso.
 *
 * Claves para que no estorbe:
 *  - Nunca se solapan dos peticiones.
 *  - Los borradores van al motor con prioridad baja: cuando llega la
 *    transcripción definitiva, el borrador en cola se descarta. Es la medida
 *    que más acelera el dictado, porque la definitiva no espera.
 *  - Solo se reescribe un tramo acotado del final de la frase. Ojo: acortar el
 *    audio casi no abarata la inferencia (Whisper siempre procesa una ventana
 *    de 30 s), pero mantiene la petición barata cuando la frase es muy larga.
 */
export class PartialTranscriber {
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight = false
  private gen = 0
  private lastLen = 0
  private nextAt = 0

  constructor(private o: PartialOptions) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? 2000)
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
    if (this.o.closing?.()) return
    const all = this.o.snapshot()
    if (!all) return
    // Se reescribe el final de la frase: es lo que el usuario está leyendo ahora.
    const maxSamples = (this.o.maxSec ?? 25) * SAMPLE_RATE
    const pcm = all.length > maxSamples ? all.subarray(all.length - maxSamples) : all
    if (pcm.length / SAMPLE_RATE < (this.o.minSec ?? 0.8) || pcm.length === this.lastLen) return
    const gen = this.gen
    this.inflight = true
    this.lastLen = pcm.length
    const t0 = Date.now()
    try {
      const text = await this.o.transcribe(pcm)
      record('draft_ms', Date.now() - t0)
      if (gen === this.gen) this.o.onDraft(text.trim())
    } catch {
      /* un borrador fallido no es un error: llegará la transcripción definitiva */
    } finally {
      this.inflight = false
      // El coste de Whisper es casi fijo por petición (siempre procesa una
      // ventana de 30 s). Dejar el motor libre algo más del tiempo que ocupó
      // reduce las veces que la transcripción definitiva se encuentra con un
      // borrador en marcha, que es lo que más se nota al dictar.
      this.nextAt = Date.now() + Math.round((Date.now() - t0) * 1.5)
    }
  }
}
