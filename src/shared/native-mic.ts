// Micrófono nativo de Android (AudioRecord + servicio en primer plano). Tipos compartidos por
// la interfaz y el preload; en escritorio no existe y se usa el micrófono del WebView.
export interface NativeMicStart {
  /** Graba además un WAV propio (reuniones). */
  wav: boolean
  /** Identificador para el nombre del WAV. */
  session?: string
}

export interface NativeMicResult {
  /** Ruta del WAV si se pidió; null si no había o se descartó. */
  wavPath: string | null
  durationSec: number
}

export interface NativeMicApi {
  start: (opts: NativeMicStart) => Promise<void>
  stop: (discard: boolean) => Promise<NativeMicResult>
  cancel: () => Promise<void>
  /** Recibe bloques PCM 16 bits mono a 16 kHz. */
  onAudio: (cb: (bytes: Uint8Array) => void) => Promise<() => void>
  /** La captura se detuvo sin que la interfaz la parara (acción «Detener» de la notificación). */
  onStop: (cb: (result: NativeMicResult) => void) => Promise<() => void>
}
