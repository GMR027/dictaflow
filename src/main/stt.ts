import { fork, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { Lang, Segment } from '@shared/types'
import { netFetch } from './netlog'
import { getSecret, getSettings, modelsDir } from './store'
import { encodeWav } from './wav'

type Progress = { file?: string; progress?: number; status: string }

const LANG_NAME: Record<Lang, string> = { es: 'spanish', en: 'english' }

let worker: ChildProcess | null = null
let seq = 0
let onProgress: ((p: Progress) => void) | undefined
let loadedModel = ''
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function getWorker(): ChildProcess {
  if (worker) return worker
  const child = fork(join(__dirname, 'stt-worker.js'), [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    serialization: 'advanced'
  })
  child.on('message', (m: any) => {
    if (m.type === 'progress') return onProgress?.(m.payload)
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.ok ? p.resolve(m) : p.reject(new Error(m.error))
  })
  child.on('exit', (code) => {
    worker = null
    loadedModel = ''
    for (const p of pending.values()) p.reject(new Error(`El motor de voz se detuvo (código ${code}). Reintenta.`))
    pending.clear()
  })
  worker = child
  return child
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().send({ id, ...msg })
  })
}

export async function loadStt(progress?: (p: Progress) => void): Promise<void> {
  const { sttModel, strictOffline } = getSettings()
  if (loadedModel === sttModel) return
  onProgress = progress
  await call({ type: 'load', model: sttModel, cacheDir: modelsDir, allowRemote: !strictOffline })
  loadedModel = sttModel
  onProgress = undefined
}

export function applyDictionary(text: string): string {
  let out = text
  for (const { from, to } of getSettings().dictionary) {
    if (!from.trim() || !to.trim()) continue
    const esc = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to)
  }
  return out
}

async function cloudTranscribe(pcm: Float32Array, lang: Lang | 'auto'): Promise<{ text: string; segments: Segment[] }> {
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

/** Transcribe audio 16 kHz mono. `timestamps` devuelve segmentos con tiempos (subtítulos, reuniones). */
export async function transcribeDetailed(pcm: Float32Array, lang: Lang | 'auto', timestamps = false): Promise<{ text: string; segments: Segment[] }> {
  if (getSettings().sttProvider === 'openai') {
    const r = await cloudTranscribe(pcm, lang)
    return { text: applyDictionary(r.text), segments: r.segments.map((x) => ({ ...x, text: applyDictionary(x.text) })) }
  }
  await loadStt()
  const res = await call<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>({
    type: 'transcribe', pcm, timestamps, language: lang === 'auto' ? undefined : LANG_NAME[lang]
  })
  const segments = (res.chunks ?? []).map((c) => ({ start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0], text: applyDictionary(c.text.trim()) }))
  return { text: applyDictionary(res.text), segments }
}

export async function transcribe(pcm: Float32Array, lang: Lang | 'auto'): Promise<string> {
  return (await transcribeDetailed(pcm, lang)).text
}

export function stopStt(): void {
  worker?.kill()
}
