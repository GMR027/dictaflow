// Codificación de audio en el proceso principal.
//
// El MP3 se va escribiendo a disco a medida que se sintetiza: antes el audiolibro
// entero se acumulaba en memoria y un libro largo podía tumbar la aplicación.

import { Mp3Encoder } from '@breezystack/lamejs'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { decodeWav } from './wav'

/** Escribe MP3 a disco sin cargar el audio completo en memoria. */
export class Mp3Writer {
  private stream: WriteStream
  private encoder: Mp3Encoder
  private pending: Float32Array | null = null
  private written = 0
  private sampleRate: number

  constructor(dest: string, sampleRate = 22050, kbps = 96) {
    mkdirSync(dirname(dest), { recursive: true })
    this.stream = createWriteStream(dest)
    this.encoder = new Mp3Encoder(1, sampleRate, kbps)
    this.sampleRate = sampleRate
  }

  /** Añade muestras PCM16 (o float). Devuelve los bytes escritos. */
  push(pcm: Float32Array, rate = this.sampleRate): number {
    const src = rate === this.sampleRate ? pcm : resample(pcm, rate, this.sampleRate)
    const i16 = new Int16Array(src.length)
    for (let i = 0; i < src.length; i++) i16[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767)

    let offset = 0
    const block = 1152
    while (offset < i16.length) {
      const end = Math.min(offset + block, i16.length)
      const buf = this.encoder.encodeBuffer(i16.subarray(offset, end))
      offset = end
      if (buf.length) {
        this.stream.write(Buffer.from(buf))
        this.written += buf.length
      }
    }
    return this.written
  }

  /** Cierra el fichero y devuelve su ruta. */
  finish(): Promise<string> {
    return new Promise((resolve, reject) => {
      const end = this.encoder.flush()
      if (end.length) this.stream.write(Buffer.from(end))
      this.stream.end(() => resolve(''))
      this.stream.on('error', reject)
    })
  }
}

/** Reescala lineal de audio de una frecuencia a otra. */
function resample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to || pcm.length === 0) return pcm
  const outLen = Math.max(1, Math.round((pcm.length * to) / from))
  const out = new Float32Array(outLen)
  const ratio = (pcm.length - 1) / Math.max(1, outLen - 1)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(pcm.length - 1, i0 + 1)
    const f = pos - i0
    out[i] = pcm[i0] * (1 - f) + pcm[i1] * f
  }
  return out
}

/** WAV PCM16 a partir de muestras float. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44 + pcm.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2)
  return buf
}

/** Convierte un WAV en muestras float, para reprocesarlas. */
export const wavToPcm = (wav: Uint8Array): { pcm: Float32Array; rate: number } => {
  const d = decodeWav(wav)
  return { pcm: d.pcm, rate: d.sampleRate }
}
