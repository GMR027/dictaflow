// Texto en vivo con el modelo streaming (Android, sherpa-onnx): se le pasa el audio del micrófono
// a medida que llega y devuelve lo que vas diciendo, palabra a palabra, como el dictado de Google.
// Solo es el texto provisional: al cerrarse la frase, Whisper da el definitivo (con puntuación).
//
// Nunca hay dos peticiones a la vez: mientras una está en curso, el audio nuevo se acumula y va en
// la siguiente. Tras `reset()` (frase cerrada) se descarta cualquier respuesta de la frase anterior.

/** Audio mínimo por petición: ~160 ms a 16 kHz (más pequeño solo añade llamadas). */
const MIN_SAMPLES = 2560

export interface LiveApi {
  liveStart: (lang: 'es' | 'en') => Promise<number | null>
  liveFeed: (session: number, pcm: Float32Array) => Promise<{ text: string }>
  liveReset: (session: number) => Promise<void>
  liveStop: (session: number) => Promise<void>
}

/** Primera letra en mayúscula (el modelo escribe todo en minúsculas y sin puntuación). */
const tidy = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t)

export class LiveTranscriber {
  private buf: Float32Array[] = []
  private len = 0
  private inflight = false
  private gen = 0
  private closed = false
  /** Cadena de llamadas de control (reiniciar/terminar) en orden con las de audio. */
  private chain: Promise<unknown> = Promise.resolve()

  private constructor(private api: LiveApi, private session: number, private onText: (text: string) => void) {}

  /** Abre el texto en vivo para un idioma; null si no hay modelo descargado o falla al cargar. */
  static async create(lang: string, onText: (text: string) => void, api: LiveApi = window.api as unknown as LiveApi): Promise<LiveTranscriber | null> {
    if (lang !== 'es' && lang !== 'en') return null
    try {
      const s = await api.liveStart(lang)
      return s == null ? null : new LiveTranscriber(api, s, onText)
    } catch {
      return null
    }
  }

  /** Audio nuevo del micrófono (bloques pequeños del worklet). */
  feed(chunk: Float32Array): void {
    if (this.closed) return
    this.buf.push(chunk)
    this.len += chunk.length
    if (!this.inflight && this.len >= MIN_SAMPLES) this.send()
  }

  private send(): void {
    const pcm = new Float32Array(this.len)
    let o = 0
    for (const c of this.buf) { pcm.set(c, o); o += c.length }
    this.buf = []
    this.len = 0
    this.inflight = true
    const gen = this.gen
    this.chain = this.chain
      .then(() => this.api.liveFeed(this.session, pcm))
      .then((r) => { if (gen === this.gen && !this.closed) this.onText(tidy(r.text)) })
      .catch(() => undefined)
      .finally(() => {
        this.inflight = false
        if (!this.closed && this.len >= MIN_SAMPLES) this.send()
      })
  }

  /** La frase se cerró: el texto vuelve a empezar. */
  reset(): void {
    if (this.closed) return
    this.gen++
    this.buf = []
    this.len = 0
    this.onText('')
    this.chain = this.chain.then(() => this.api.liveReset(this.session)).catch(() => undefined)
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    this.gen++
    this.buf = []
    this.chain = this.chain.then(() => this.api.liveStop(this.session)).catch(() => undefined)
  }
}
