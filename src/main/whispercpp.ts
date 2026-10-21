// Motor opcional: whisper.cpp ejecutado como servidor local (`whisper-server`, binario externo).
// Se mantiene el modelo cargado entre frases y solo se escucha en 127.0.0.1. No importa Electron para poder probarse.
import { spawn, type ChildProcess } from 'child_process'
import { accessSync, constants, existsSync } from 'fs'
import { createServer } from 'net'
import { delimiter, join } from 'path'
import { cpus } from 'os'
import { encodeWav } from './wav'
import { localFetch } from './net/local'

export interface CppSegment { start: number; end: number; text: string }
export interface CppResult { text: string; segments: CppSegment[] }

const BIN_NAMES = ['whisper-server', 'whisper-cpp-server']

/** Binario configurado o, si no hay, el primero encontrado en PATH. '' si no existe. */
export function findServerBinary(configured: string, pathEnv = process.env.PATH ?? ''): string {
  const executable = (p: string): boolean => {
    try { accessSync(p, constants.X_OK); return true } catch { return false }
  }
  if (configured) return existsSync(configured) && executable(configured) ? configured : ''
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    for (const name of BIN_NAMES) if (executable(join(dir, name))) return join(dir, name)
  }
  return ''
}

export function serverArgs(model: string, port: number, threads = Math.min(8, Math.max(2, cpus().length - 2))): string[] {
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads)]
}

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number }
    s.close(() => resolve(port))
  })
})

/** Interpreta la respuesta de /inference (json o verbose_json). */
export function parseInference(j: { text?: string; segments?: { start: number; end: number; text: string }[]; error?: string }): CppResult {
  if (j.error) throw new Error(`whisper.cpp: ${j.error}`)
  const segments = (j.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
  const text = (j.text ?? segments.map((s) => s.text).join(' ')).replace(/\s+/g, ' ').trim()
  return { text, segments }
}

export class CppServer {
  private child: ChildProcess | null = null
  private port = 0
  private key = ''
  private starting: Promise<void> | null = null
  private log = ''

  get running(): boolean { return !!this.child }

  /** Arranca (o reutiliza) el servidor para este binario y modelo. Si cambian, lo reinicia. */
  ensure(bin: string, model: string, readyTimeoutMs = 60_000): Promise<void> {
    const key = `${bin}\0${model}`
    if (this.child && this.key === key) return this.starting ?? Promise.resolve()
    this.stop()
    if (!bin) return Promise.reject(new Error('No se encontró whisper-server. Instálalo o indica su ruta en Ajustes → Rendimiento.'))
    if (!model || !existsSync(model)) return Promise.reject(new Error('Falta el modelo ggml de whisper.cpp. Descárgalo o indica su ruta en Ajustes → Rendimiento.'))
    this.key = key
    this.starting = this.launch(bin, model, readyTimeoutMs).catch((e) => { this.stop(); throw e })
    return this.starting
  }

  private async launch(bin: string, model: string, readyTimeoutMs: number): Promise<void> {
    this.port = await freePort()
    this.log = ''
    const child = spawn(bin, serverArgs(model, this.port), { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    const keep = (d: Buffer): void => { this.log = (this.log + d).slice(-2000) }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    let exited: number | null | undefined
    child.on('exit', (code) => { exited = code ?? -1; if (this.child === child) this.child = null })
    child.on('error', (e) => { this.log += String(e); exited = -1 })
    const t0 = Date.now()
    while (Date.now() - t0 < readyTimeoutMs) {
      if (exited !== undefined) throw new Error(`whisper-server se cerró (código ${exited}). ${this.log.trim().split('\n').slice(-3).join(' | ')}`)
      try {
        const r = await localFetch(`http://127.0.0.1:${this.port}/`, { signal: AbortSignal.timeout(1000) })
        if (r.status < 500) return
      } catch { /* aún arrancando */ }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('whisper-server no respondió a tiempo.')
  }

  async infer(pcm: Float32Array, lang: string | undefined, timestamps: boolean): Promise<CppResult> {
    if (!this.child) throw new Error('whisper-server no está en marcha')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(encodeWav(pcm, 16000))], { type: 'audio/wav' }), 'audio.wav')
    form.append('response_format', timestamps ? 'verbose_json' : 'json')
    form.append('temperature', '0.0')
    form.append('language', lang ?? 'auto')
    const res = await localFetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`whisper-server ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return parseInference(await res.json())
  }

  stop(): void {
    const c = this.child
    this.child = null
    this.starting = null
    this.key = ''
    c?.kill()
  }
}

export const GGML_MODELS = [
  { id: 'ggml-base-q5_1.bin', label: 'base (cuantizado q5_1)', sizeMB: 57 },
  { id: 'ggml-small-q5_1.bin', label: 'small (cuantizado q5_1)', sizeMB: 181 },
  { id: 'ggml-small.bin', label: 'small (completo)', sizeMB: 466 }
] as const

export const ggmlUrl = (id: string): string => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${id}`
