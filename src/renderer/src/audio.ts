export const SAMPLE_RATE = 16000
const MIN_RMS = 0.004

export const rms = (a: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / a.length)
}

export const concat = (chunks: Float32Array[]): Float32Array => {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

export type SegmentHandler = (pcm: Float32Array, startSec: number) => void

/**
 * Corta un flujo de audio en frases.
 * continuous: por silencios (VAD con umbral adaptativo). controlled: todo hasta flush().
 */
export class Segmenter {
  private buf: Float32Array[] = []
  private preRoll: Float32Array[] = []
  private speaking = false
  private silentMs = 0
  private speechMs = 0
  private noise = 0.005
  private fed = 0
  private startAt = 0

  constructor(private mode: 'continuous' | 'controlled', private onSegment: SegmentHandler) {}

  feed(chunk: Float32Array): number {
    const level = rms(chunk)
    const ms = (chunk.length / SAMPLE_RATE) * 1000
    const chunkStart = this.fed / SAMPLE_RATE
    this.fed += chunk.length

    if (this.mode === 'controlled') {
      if (this.buf.length === 0) this.startAt = chunkStart
      this.buf.push(chunk)
      return level
    }

    if (!this.speaking) this.noise = this.noise * 0.95 + level * 0.05
    const voiced = level > Math.max(0.012, this.noise * 3)

    if (!this.speaking) {
      this.preRoll.push(chunk)
      if (this.preRoll.length > 4) this.preRoll.shift()
      if (voiced) {
        this.speaking = true
        this.buf = [...this.preRoll]
        this.startAt = Math.max(0, chunkStart - (this.preRoll.length - 1) * (chunk.length / SAMPLE_RATE))
        this.preRoll = []
        this.silentMs = 0
        this.speechMs = 0
      }
      return level
    }

    this.buf.push(chunk)
    this.speechMs += ms
    this.silentMs = voiced ? 0 : this.silentMs + ms
    if (this.silentMs >= 900 || this.speechMs >= 25000) this.emit()
    return level
  }

  private emit(): void {
    const pcm = concat(this.buf)
    this.buf = []
    this.speaking = false
    this.silentMs = 0
    // Whisper alucina texto con silencio: no se envía audio sin voz
    if (pcm.length / SAMPLE_RATE > 0.5 && rms(pcm) > MIN_RMS) this.onSegment(pcm, this.startAt)
  }

  /** Emite lo pendiente (al detener). */
  flush(): void {
    if (this.buf.length) this.emit()
  }
}

export interface MicOptions {
  deviceId: string
  mode: 'continuous' | 'controlled'
  onSegment: SegmentHandler
  onLevel: (rms: number) => void
}

export class Mic {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private seg: Segmenter

  constructor(private opts: MicOptions) {
    this.seg = new Segmenter(opts.mode, opts.onSegment)
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.opts.deviceId === 'default' ? undefined : { exact: this.opts.deviceId },
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1
      }
    })
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    // Archivo propio (no blob:) para cumplir la CSP `script-src 'self'`
    await this.ctx.audioWorklet.addModule(new URL('./tap-worklet.js', document.baseURI).href)
    this.node = new AudioWorkletNode(this.ctx, 'tap')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.opts.onLevel(this.seg.feed(e.data))
    this.ctx.createMediaStreamSource(this.stream).connect(this.node)
  }

  async stop(): Promise<void> {
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.seg.flush()
    this.ctx = null
    this.stream = null
    this.node = null
  }
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  // getUserMedia previo para que las etiquetas de los dispositivos sean visibles
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
  } catch {
    /* sin permiso: se listan sin etiqueta */
  }
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
}
