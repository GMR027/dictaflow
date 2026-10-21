// Grabación del audio de una reunión.
//
// El audio se escribe a disco mientras se graba: no se guarda en memoria (una
// hora son más de 100 MB) y se puede volver a transcribir o escuchar después.
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, type WriteStream } from 'fs'
import { join } from 'path'
import { dataDir } from './paths'
import { encodeWav } from './wav'

const SAMPLE_RATE = 16000

interface Session {
  stream: WriteStream
  path: string
  samples: number
  pending: Buffer[]
  pendingBytes: number
}

const sessions = new Map<string, Session>()

/** Empieza a grabar y devuelve el identificador de la sesión. */
export function startAudio(sessionId: string): { sessionId: string; path: string } {
  stopAudio(sessionId)
  const dir = join(dataDir, 'reuniones')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${sessionId}.wav`)
  const stream = createWriteStream(path)
  // Cabecera provisional: se reescribe al cerrar con el tamaño real.
  stream.write(encodeWav(new Float32Array(0), SAMPLE_RATE))
  sessions.set(sessionId, { stream, path, samples: 0, pending: [], pendingBytes: 0 })
  return { sessionId, path }
}

/** Añade muestras (float, mono, 16 kHz). */
export function pushAudio(sessionId: string, pcm: Float32Array): void {
  const s = sessions.get(sessionId)
  if (!s) return
  // Se agrupa en bloques de ~1 s para no escribir en el disco en cada trozo.
  const i16 = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) i16.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), i * 2)
  s.pending.push(i16)
  s.pendingBytes += i16.length
  s.samples += pcm.length
  if (s.pendingBytes >= SAMPLE_RATE * 2) flush(s)
}

function flush(s: Session): void {
  if (!s.pending.length) return
  s.stream.write(Buffer.concat(s.pending))
  s.pending = []
  s.pendingBytes = 0
}

/** Cierra la grabación y deja el WAV con su tamaño correcto. */
export async function stopAudio(sessionId: string): Promise<{ path: string; durationSec: number } | null> {
  const s = sessions.get(sessionId)
  if (!s) return null
  flush(s)
  sessions.delete(sessionId)
  return new Promise<{ path: string; durationSec: number } | null>((resolve) => {
    s.stream.end(() => {
      // Se reescribe la cabecera con el tamaño real de los datos.
      try {
        const buf = readFileSync(s.path)
        buf.writeUInt32LE(36 + (s.samples * 2), 4)
        buf.writeUInt32LE(s.samples * 2, 40)
        writeFileSync(s.path, buf)
      } catch {
        /* si no se puede ajustar la cabecera, el WAV sigue siendo reproducible */
      }
      resolve({ path: s.path, durationSec: s.samples / SAMPLE_RATE })
    })
  })
}

/** Borra la grabación de una sesión (si se cancela). */
export function discardAudio(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (!s) return
  sessions.delete(sessionId)
  try {
    s.stream.destroy()
  } catch {
    /* nada que hacer */
  }
}
