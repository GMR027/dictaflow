import { auraListen } from './aura'
import { ensureMicPermission } from './phone-mic'

export const SAMPLE_RATE = 16000
const MIN_RMS = 0.004
/** Audio previo a la detección de voz que se conserva para no cortar el inicio de la frase */
const PRE_ROLL_MS = 300

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

export type SegmentHandler = (pcm: Float32Array, startSec: number, meta: SegmentMeta) => void

/** Datos de cómo se cerró una frase: sirven para medir cuánto se tardó. */
export interface SegmentMeta {
  /** Duración del silencio que cerró la frase (ms). Es la espera que se añade al texto. */
  silenceMs: number
  /** Duración de la voz detectada (ms). */
  speechMs: number
}

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
  /** Ya se avisó del silencio que cierra la frase. */
  private silenceTold = false

  constructor(private mode: 'continuous' | 'controlled', private onSegment: SegmentHandler, private pauseMs = 900, private onSilence?: () => void) {}

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
      if (this.preRoll.length * ms > PRE_ROLL_MS) this.preRoll.shift()
      if (voiced) {
        this.speaking = true
        this.buf = [...this.preRoll]
        this.startAt = Math.max(0, chunkStart - (this.preRoll.length - 1) * (chunk.length / SAMPLE_RATE))
        this.preRoll = []
        this.silentMs = 0
        this.speechMs = 0
        this.silenceTold = false
      }
      return level
    }

    this.buf.push(chunk)
    this.speechMs += ms
    this.silentMs = voiced ? 0 : this.silentMs + ms
    if (!voiced && !this.silenceTold) {
      // Empieza el silencio que cerrará la frase: avisa para dejar libre el motor.
      this.silenceTold = true
      this.onSilence?.()
    }
    if (this.silentMs >= this.pauseMs || this.speechMs >= 25000) this.emit()
    return level
  }

  private emit(): void {
    const pcm = concat(this.buf)
    const meta: SegmentMeta = { silenceMs: Math.round(this.silentMs), speechMs: Math.round(this.speechMs) }
    this.buf = []
    this.speaking = false
    this.silentMs = 0
    // Whisper alucina texto con silencio: no se envía audio sin voz
    if (pcm.length / SAMPLE_RATE > 0.5 && rms(pcm) > MIN_RMS) this.onSegment(pcm, this.startAt, meta)
  }

  /** Audio de la frase en curso (sin consumirlo), para el texto provisional. Null si aún no hay habla. */
  snapshot(): Float32Array | null {
    const speaking = this.mode === 'controlled' ? this.buf.length > 0 : this.speaking
    return speaking ? concat(this.buf).slice(-25 * SAMPLE_RATE) : null
  }

  /** Descarta lo pendiente sin transcribirlo (al interrumpir). */
  discard(): void {
    this.buf = []
    this.preRoll = []
    this.speaking = false
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
  /** silencio (ms) que cierra una frase en modo continuo */
  pauseMs?: number
  onLevel: (rms: number) => void
  /**
   * Recibe el audio tal cual, en tiempo real. Sirve para grabar la reunión
   * mientras se transcribe.
   */
  onAudio?: (chunk: Float32Array) => void
  /**
   * Se avisa en cuanto empieza el silencio que va a cerrar la frase. Sirve para
   * no arrancar nada nuevo mientras se espera: el motor queda libre justo
   * cuando va a llegar la transcripción definitiva.
   */
  onSilence?: () => void
  /**
   * Procesado del navegador. Apagar la supresión de ruido y el control automático
   * de ganancia suele mejorar la precisión de Whisper; la cancelación de eco
   * conviene dejarla si hablas con el altavoz encendido.
   */
  filters?: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }
  /** Android: graba además un WAV propio (reuniones) y devuelve su ruta al parar. */
  wav?: boolean
  /** Identificador para el nombre del WAV de la reunión. */
  session?: string
  /** La captura nativa se detuvo desde la notificación (o por el sistema). */
  onEnded?: (result: MicStopResult) => void
}

/** Lo que devuelve un micrófono al parar (solo el nativo graba WAV). */
export interface MicStopResult {
  wavPath?: string
  durationSec?: number
}

/** Interfaz común del micrófono del WebView y del nativo de Android. */
export interface MicLike {
  start(): Promise<void>
  stop(discard?: boolean): Promise<MicStopResult | void>
  snapshot(): Float32Array | null
}

export class Mic implements MicLike {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private seg: Segmenter
  /** Aura azul mientras el micrófono escucha (aura.ts). */
  private aura: (() => void) | null = null

  constructor(private opts: MicOptions) {
    this.seg = new Segmenter(opts.mode, opts.onSegment, opts.pauseMs, opts.onSilence)
  }

  async start(): Promise<void> {
    const f = this.opts.filters ?? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.opts.deviceId === 'default' ? undefined : { exact: this.opts.deviceId },
        echoCancellation: f.echoCancellation,
        noiseSuppression: f.noiseSuppression,
        autoGainControl: f.autoGainControl,
        channelCount: 1
      }
    })
    this.aura = auraListen()
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    // Archivo propio (no blob:) para cumplir la CSP `script-src 'self'`
    await this.ctx.audioWorklet.addModule(new URL('./tap-worklet.js', document.baseURI).href)
    this.node = new AudioWorkletNode(this.ctx, 'tap')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.opts.onAudio?.(e.data)
      this.opts.onLevel(this.seg.feed(e.data))
    }
    this.ctx.createMediaStreamSource(this.stream).connect(this.node)
  }

  snapshot(): Float32Array | null {
    return this.seg.snapshot()
  }

  async stop(discard = false): Promise<void> {
    this.aura?.()
    this.aura = null
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    if (discard) this.seg.discard()
    else this.seg.flush()
    this.ctx = null
    this.stream = null
    this.node = null
  }
}

/** Convierte PCM 16 bits little-endian (el del servicio nativo) a muestras [-1, 1]. */
const pcm16 = (bytes: Uint8Array): Float32Array => {
  const out = new Float32Array(bytes.byteLength >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

/**
 * Micrófono nativo de Android: `AudioRecord` en un servicio en primer plano. Elimina el worklet
 * del WebView (un mensaje cada 8 ms), sigue con la pantalla apagada y, si se pide, escribe el WAV
 * de la reunión en el propio teléfono.
 */
export class NativeMic implements MicLike {
  private seg: Segmenter
  private unsub: (() => void) | null = null
  private stopUnsub: (() => void) | null = null
  private stopped = false
  private stopping = false
  /** Resultado de una parada hecha desde la notificación, para que `stop` no lo pierda. */
  private external: MicStopResult | null = null

  constructor(private opts: MicOptions) {
    this.seg = new Segmenter(opts.mode, opts.onSegment, opts.pauseMs, opts.onSilence)
  }

  async start(): Promise<void> {
    this.stopped = false
    this.stopping = false
    this.external = null
    this.unsub?.()
    this.unsub = null
    this.stopUnsub?.()
    this.stopUnsub = null
    // El servicio nativo no pide el permiso por su cuenta: se pide desde el WebView.
    await ensureMicPermission()
    const unsub = await window.api.nativeMic.onAudio((bytes) => {
      if (this.stopped) return
      const pcm = pcm16(bytes)
      this.opts.onAudio?.(pcm)
      this.opts.onLevel(this.seg.feed(pcm))
    })
    const stopUnsub = await window.api.nativeMic.onStop((r) => {
      if (this.stopping) return
      const result = { wavPath: r.wavPath ?? undefined, durationSec: r.durationSec }
      this.stopUnsub?.()
      this.stopUnsub = null
      // Los últimos bloques viajan por otro canal: se dejan llegar antes de cerrar la frase.
      setTimeout(() => {
        if (this.stopped) return
        this.stopped = true
        this.unsub?.()
        this.unsub = null
        this.seg.flush()
        this.external = result
        this.opts.onEnded?.(result)
      }, 120)
    })
    this.stopUnsub = stopUnsub
    try {
      await window.api.nativeMic.start({ wav: !!this.opts.wav, session: this.opts.session })
      this.unsub = unsub
    } catch (e) {
      unsub()
      stopUnsub()
      this.stopUnsub = null
      throw e
    }
  }

  snapshot(): Float32Array | null {
    return this.seg.snapshot()
  }

  async stop(discard = false): Promise<MicStopResult> {
    if (this.external) {
      const r = this.external
      this.external = null
      return r
    }
    if (this.stopping) return {}
    this.stopping = true
    const unsub = this.unsub
    this.unsub = null
    const stopUnsub = this.stopUnsub
    this.stopUnsub = null
    const r = await window.api.nativeMic.stop(discard).catch(() => ({ wavPath: null, durationSec: 0 }))
    // Los últimos bloques viajan por otro canal: se les da un instante antes de cerrar.
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    this.stopped = true
    unsub?.()
    stopUnsub?.()
    if (discard) this.seg.discard()
    else this.seg.flush()
    this.stopping = false
    return { wavPath: r.wavPath ?? undefined, durationSec: r.durationSec }
  }
}

/** Micrófono nativo en Android; el del WebView en escritorio. */
export const createMic = (opts: MicOptions): MicLike =>
  window.api.platform === 'android' ? new NativeMic(opts) : new Mic(opts)

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const lista = async (): Promise<MediaDeviceInfo[]> =>
    (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  // En Android no se abre el micrófono solo para listar: el micrófono nativo se pide al grabar.
  if (window.api.platform === 'android') {
    try {
      return await lista()
    } catch {
      return []
    }
  }
  // En escritorio, getUserMedia previo para que las etiquetas de los dispositivos sean visibles.
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
  } catch {
    /* sin permiso: se listan sin etiqueta */
  }
  return lista()
}
