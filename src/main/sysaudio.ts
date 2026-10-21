import { spawn, type ChildProcess } from 'child_process'
import type { WebContents } from 'electron'

let proc: ChildProcess | null = null

/**
 * Captura lo que suena en el equipo (monitor del sink por defecto de PipeWire)
 * a 16 kHz mono f32.
 *
 * `pw-record` escribe una cabecera WAV antes de las muestras. Si esa cabecera
 * llega partida entre dos trozos, hay que guardarla aparte: si no, los bytes
 * perdidos se tomarían por audio y aparecerían como ruido al principio.
 */
export function startSystemAudio(sender: WebContents): void {
  stopSystemAudio()
  const child = spawn('pw-record', ['--rate', '16000', '--channels', '1', '--format', 'f32', '-P', 'stream.capture.sink=true', '-'], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  let header: Buffer | null = Buffer.alloc(0)
  let rest: Buffer = Buffer.alloc(0)
  child.stdout.on('data', (d: Buffer) => {
    let chunk: Buffer = d
    if (header !== null) {
      //Se busca el final de la cabecera: la marca «data» y su tamaño.
      const idx = chunk.indexOf('data')
      if (idx >= 0 && chunk.length >= idx + 8) {
        header = null
        chunk = chunk.subarray(idx + 8)
      } else {
        header = Buffer.concat([header, chunk])
        //Si la cabecera no cabe en 1 KB, no es una cabecera WAV: se descarta.
        if (header.length > 1024) {
          header = null
          chunk = Buffer.alloc(0)
        } else {
          return
        }
      }
    }
    chunk = Buffer.concat([rest, chunk])
    const usable = chunk.length - (chunk.length % 4)
    rest = chunk.subarray(usable)
    if (usable === 0 || sender.isDestroyed()) return
    const copy = new Uint8Array(chunk.subarray(0, usable)) // copia alineada
    sender.send('sysaudio:chunk', new Float32Array(copy.buffer))
  })
  child.on('error', () => sender.isDestroyed() || sender.send('sysaudio:error', 'No se pudo iniciar pw-record (PipeWire).'))
  proc = child
}

export function stopSystemAudio(): void {
  proc?.kill()
  proc = null
}
