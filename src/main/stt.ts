import { fork, type ChildProcess } from 'child_process'
import { join } from 'path'
import { TRANS_LANGS, type Segment, type SttStatus, type TransLang } from '@shared/types'
import { netFetch } from './netlog'
import { getSecret, getSettings, modelsDir } from './store'
import { encodeWav } from './wav'
import { CppServer, GGML_MODELS, findServerBinary, ggmlUrl } from './whispercpp'
import { PriorityQueue, type SttPriority } from './stt-queue'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

type Progress = { file?: string; progress?: number; status: string }

/** Prioridad de una transcripción: la definitiva nunca espera a un borrador. */
export type { SttPriority } from './stt-queue'

let worker: ChildProcess | null = null
let seq = 0
let onProgress: ((p: Progress) => void) | undefined
let loadedModel = ''
const cpp = new CppServer()
/** Por qué se usó Transformers.js aunque se eligió whisper.cpp (null si no hubo fallback) */
let fallbackReason: string | null = null

/** Cola de transcripciones: una sola a la vez y la definitiva antes que el borrador. */
const sttQueue = new PriorityQueue<{ text: string; segments: Segment[] }>()

const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function getWorker(): ChildProcess {
  if (worker) return worker
  const child = fork(join(__dirname, 'stt-worker.js'), [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    serialization: 'advanced'
  })
  child.on('message', (m: any) => {
    if (m.type === 'progress') return onProgress?.(m.payload)
    const p = waiting.get(m.id)
    if (!p) return
    waiting.delete(m.id)
    m.ok ? p.resolve(m) : p.reject(new Error(m.error))
  })
  child.on('exit', (code) => {
    worker = null
    loadedModel = ''
    for (const p of waiting.values()) p.reject(new Error(`El motor de voz se detuvo (código ${code}). Reintenta.`))
    waiting.clear()
  })
  worker = child
  return child
}

/** Manda un mensaje al worker y espera su respuesta. */
function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().send({ id, ...msg })
  })
}

export const ggmlPath = (id: string): string => join(modelsDir, id)

function cppConfig(): { bin: string; model: string } {
  const { whisperCpp } = getSettings()
  return { bin: findServerBinary(whisperCpp.bin), model: whisperCpp.model || (GGML_MODELS.map((m) => ggmlPath(m.id)).find(existsSync) ?? '') }
}

/** Estado de los motores para Ajustes. */
export function sttStatus(): SttStatus {
  const s = getSettings()
  const c = cppConfig()
  return {
    engine: s.sttEngine,
    active: s.sttEngine === 'whispercpp' && cpp.running && !fallbackReason ? 'whispercpp' : 'transformers',
    fallbackReason,
    cpp: { ...c, ggml: GGML_MODELS.map((m) => ({ ...m, installed: existsSync(ggmlPath(m.id)) })) }
  }
}

/** Descarga un modelo ggml (solo si el usuario lo pide). */
export async function downloadGgml(id: string, progress: (p: Progress) => void): Promise<void> {
  if (!GGML_MODELS.some((m) => m.id === id)) throw new Error('Modelo desconocido')
  mkdirSync(modelsDir, { recursive: true })
  const res = await netFetch('whispercpp:model', ggmlUrl(id))
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${id} (${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let done = 0
  const tmp = `${ggmlPath(id)}.part`
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c: Buffer) => { done += c.length; if (total) progress({ status: 'progress', file: id, progress: (done / total) * 100 }) })
  try {
    await pipeline(src, createWriteStream(tmp))
    renameSync(tmp, ggmlPath(id))
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  progress({ status: 'done', file: id })
}

/** Arranca whisper-server; si no es posible, avisa y se usa Transformers.js para no interrumpir el dictado. */
async function ensureCpp(): Promise<boolean> {
  const { bin, model } = cppConfig()
  try {
    await cpp.ensure(bin, model)
    fallbackReason = null
    return true
  } catch (e) {
    fallbackReason = (e as Error).message
    return false
  }
}

export async function loadStt(progress?: (p: Progress) => void): Promise<void> {
  const { sttModel, strictOffline, sttEngine } = getSettings()
  if (sttEngine === 'whispercpp' && (await ensureCpp())) return
  if (loadedModel === sttModel) return
  onProgress = progress
  await call({ type: 'load', model: sttModel, cacheDir: modelsDir, allowRemote: !strictOffline })
  loadedModel = sttModel
  onProgress = undefined
}

/**
 * Sustituye las palabras mal transcritas por su forma correcta.
 * Las expresiones se compilan una vez y se reutilizan: compilar un patrón por
 * entrada del diccionario en cada transcripción costaba CPU sin motivo.
 */
let dictCache: { key: string; rules: { re: RegExp; to: string }[] } | null = null

export function applyDictionary(text: string): string {
  const entries = getSettings().dictionary
  const key = JSON.stringify(entries)
  if (!dictCache || dictCache.key !== key) {
    const rules = entries
      .filter(({ from, to }) => from.trim() && to.trim())
      .map(({ from, to }) => {
        const esc = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return { re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to: to.trim() }
      })
    dictCache = { key, rules }
  }
  let out = text
  for (const { re, to } of dictCache?.rules ?? []) out = out.replace(re, to)
  return out
}

async function cloudTranscribe(pcm: Float32Array, lang: TransLang | 'auto'): Promise<{ text: string; segments: Segment[] }> {
  const s = getSettings()
  const key = getSecret('openai-audio')
  if (!key) throw new Error('Falta la API key de audio en la nube (Ajustes → Audio).')
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(encodeWav(pcm, 16000))], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', s.cloudAudio.sttModel)
  form.append('response_format', 'verbose_json')
  if (lang !== 'auto') form.append('language', lang)
  const res = await netFetch('openai:stt', `${s.cloudAudio.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form })
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`)
  const j = (await res.json()) as { text: string; segments?: { start: number; end: number; text: string }[] }
  return { text: j.text.trim(), segments: (j.segments ?? []).map((x) => ({ start: x.start, end: x.end, text: x.text.trim() })) }
}

/** Resultado de una transcripción: el texto, los segmentos y lo que tardó. */
export interface TranscribeResult {
  text: string
  segments: Segment[]
  /** Milisegundos que tardó la inferencia (sin contar la espera en cola). */
  ms: number
}

/**
 * Transcribe audio 16 kHz mono. `timestamps` devuelve segmentos con tiempos
 * (subtítulos, reuniones). `priority` decide si espera a los borradores: la
 * transcripción definitiva nunca espera.
 */
export async function transcribeDetailed(
  pcm: Float32Array,
  lang: TransLang | 'auto',
  timestamps = false,
  priority: SttPriority = 'final'
): Promise<TranscribeResult> {
  if (getSettings().sttProvider === 'openai') {
    const t0 = performance.now()
    const r = await cloudTranscribe(pcm, lang)
    return {
      text: applyDictionary(r.text),
      segments: r.segments.map((x) => ({ ...x, text: applyDictionary(x.text) })),
      ms: Math.round(performance.now() - t0)
    }
  }
  await loadStt()
  const r = await sttQueue.enqueue({
    id: ++seq,
    priority,
    exec: async () => {
      if (getSettings().sttEngine === 'whispercpp' && cpp.running && !fallbackReason) {
        const lg = lang === 'auto' ? undefined : lang
        try {
          const r = await cpp.infer(pcm, lg, timestamps)
          return { text: applyDictionary(r.text), segments: r.segments.map((x) => ({ ...x, text: applyDictionary(x.text) })) }
        } catch (e) {
          fallbackReason = (e as Error).message
          cpp.stop()
        }
      }
      const res = await call<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>({
        type: 'transcribe', pcm, timestamps, language: lang === 'auto' ? undefined : TRANS_LANGS[lang].whisper
      })
      const segments = (res.chunks ?? []).map((c) => ({ start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0], text: applyDictionary(c.text.trim()) }))
      return { text: applyDictionary(res.text), segments }
    }
  })
  return { text: r.value.text, segments: r.value.segments, ms: r.ms }
}

export async function transcribe(pcm: Float32Array, lang: TransLang | 'auto', priority: SttPriority = 'final'): Promise<TranscribeResult> {
  return transcribeDetailed(pcm, lang, false, priority)
}

export function stopStt(): void {
  worker?.kill()
  cpp.stop()
}

/** Prueba corta: ms que tarda transcribir 3 s de audio con el motor activo (2.ª pasada, ya caliente). */
export async function benchStt(): Promise<{ engine: string; model: string; loadMs: number; ms: number }> {
  const s = getSettings()
  const t0 = performance.now()
  await loadStt()
  const loadMs = performance.now() - t0
  // Ruido blanco suave: el coste del codificador de Whisper no depende del contenido
  const pcm = Float32Array.from({ length: 3 * 16000 }, () => (Math.random() - 0.5) * 0.02)
  await transcribeDetailed(pcm, 'es')
  const t1 = performance.now()
  await transcribeDetailed(pcm, 'es')
  const active = sttStatus().active
  return { engine: active, model: active === 'whispercpp' ? cppConfig().model : s.sttModel, loadMs: Math.round(loadMs), ms: Math.round(performance.now() - t1) }
}
