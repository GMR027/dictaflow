import { spawn, type ChildProcess } from 'child_process'
import type { WebContents } from 'electron'

let proc: ChildProcess | null = null

/** Captura lo que suena en el equipo (monitor del sink por defecto de PipeWire) a 16 kHz mono f32. */
export function startSystemAudio(sender: WebContents): void {
  stopSystemAudio()
  const child = spawn('pw-record', ['--rate', '16000', '--channels', '1', '--format', 'f32', '-P', 'stream.capture.sink=true', '-'], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  let header = true
  let rest: Buffer = Buffer.alloc(0)
  child.stdout.on('data', (d: Buffer) => {
    let chunk: Buffer = d
    if (header) {
      // pw-record escribe una cabecera WAV antes de las muestras
      const idx = chunk.indexOf('data')
      if (chunk.subarray(0, 4).toString() === 'RIFF' && idx >= 0 && chunk.length >= idx + 8) {
        chunk = chunk.subarray(idx + 8)
        header = false
      } else if (chunk.subarray(0, 4).toString() !== 'RIFF') header = false
      else return
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
