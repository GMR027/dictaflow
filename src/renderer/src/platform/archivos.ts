// Android: archivos propios de la app y exportaciones con el selector de archivos del sistema.
//
// Los archivos viven en `<datos de la app>/archivos` (android/src-tauri/src/archivos.rs) y se
// nombran con rutas relativas sencillas (`reuniones/<id>.wav`). Para sacarlos del teléfono (PDF,
// notas, MP3, copias de seguridad) Rust abre el selector de Android: el usuario elige carpeta y
// nombre (Descargas, Drive, la carpeta de Obsidian…).
import { invoke } from '@tauri-apps/api/core'
import { Mp3Encoder } from '@breezystack/lamejs'

/** Bytes → base64, en trozos (String.fromCharCode con millones de argumentos revienta la pila). */
export function toBase64(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface Entrada { nombre: string; bytes: number; carpeta: boolean }

export const fileWrite = (path: string, data: Uint8Array | string, append = false): Promise<void> =>
  invoke('file_write', { path, data: toBase64(data), append })
export const fileRead = async (path: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('file_read', { path }))
export const fileRemove = (path: string): Promise<void> => invoke('file_remove', { path })
export const fileList = (dir: string): Promise<Entrada[]> => invoke('file_list', { dir })
export const fileJoin = (parts: string[], dest: string): Promise<void> => invoke('file_join', { parts, dest })

/**
 * Guarda en el teléfono unos datos o un archivo propio de la app, con el selector de Android.
 * Devuelve el nombre con que se guardó, o '' si el usuario canceló (igual que en escritorio).
 */
export async function saveAs(name: string, ext: string, from: { data: Uint8Array | string } | { path: string }): Promise<string> {
  const r = await invoke<string | null>('save_as', 'data' in from ? { name, ext, data: toBase64(from.data) } : { name, ext, path: from.path })
  return r ?? ''
}

/** Extensión de un nombre de archivo ('' si no tiene). */
export const extOf = (name: string): string => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? ''

/** Nombre de archivo sencillo (minúsculas, sin acentos) para las rutas propias de la app. */
export const slug = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'audio'

/** Muestras de un WAV PCM16 mono (el que devuelve la voz del teléfono). */
export function wavSamples(wav: Uint8Array): { pcm: Float32Array; rate: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const rate = view.getUint32(24, true)
  const n = Math.floor((wav.length - 44) / 2)
  const pcm = new Float32Array(n)
  for (let i = 0; i < n; i++) pcm[i] = view.getInt16(44 + i * 2, true) / 32768
  return { pcm, rate }
}

/**
 * MP3 que se escribe por partes en un archivo propio de la app: un libro entero no cabe en memoria.
 * Mismo codificador que en escritorio (lamejs, mono, 96 kbps).
 */
export class Mp3File {
  private encoder: Mp3Encoder
  private pending: Uint8Array[] = []
  private pendingBytes = 0
  private started = false

  constructor(private path: string, private rate: number, kbps = 96) {
    this.encoder = new Mp3Encoder(1, rate, kbps)
  }

  async push(pcm: Float32Array): Promise<void> {
    const i16 = new Int16Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) i16[i] = Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767)
    for (let o = 0; o < i16.length; o += 1152) this.add(this.encoder.encodeBuffer(i16.subarray(o, o + 1152)))
    // Se escribe cada ~256 KB (unos 20 s de audio).
    if (this.pendingBytes >= 256 * 1024) await this.flush()
  }

  /** Muestras de un WAV de la voz del teléfono (deben tener la misma frecuencia). */
  pushWav(wav: Uint8Array): Promise<void> {
    const { pcm, rate } = wavSamples(wav)
    if (rate !== this.rate) throw new Error(`La voz cambió de frecuencia (${rate} Hz en vez de ${this.rate} Hz).`)
    return this.push(pcm)
  }

  async finish(): Promise<void> {
    this.add(this.encoder.flush())
    await this.flush()
  }

  private add(buf: Uint8Array | Int8Array): void {
    if (!buf.length) return
    this.pending.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length))
    this.pendingBytes += buf.length
  }

  private async flush(): Promise<void> {
    if (!this.pending.length && this.started) return
    const out = new Uint8Array(this.pendingBytes)
    let o = 0
    for (const b of this.pending) { out.set(b, o); o += b.length }
    await fileWrite(this.path, out, this.started)
    this.started = true
    this.pending = []
    this.pendingBytes = 0
  }
}

/** Frecuencia de un WAV de la voz del teléfono. */
export const wavRate = (wav: Uint8Array): number => new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(24, true)
