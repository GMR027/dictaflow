// sherpa-onnx en escritorio: texto en vivo (Kroko streaming) y voces Kokoro/Supertonic, cada tarea
// en su propio proceso (sherpa-worker.ts). Es lo mismo que hace el teléfono en Rust (vivo.rs, tts.rs).
import { fork, execFile, type ChildProcess } from 'child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { cpus } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { app } from 'electron'
import type { Lang } from '@shared/types'
import { companions, liveModelFor } from '@shared/local-models'
import { KOKORO_MODEL, kokoroVoice } from '@shared/kokoro'
import { SUPERTONIC_FILES, SUPERTONIC_MODEL } from '@shared/supertonic'
import { dataDir } from './store'
import { encodeWav } from './wav'
import { localPath, localReady } from './local-models'

const run = promisify(execFile)
type Role = 'live' | 'tts'

/** Archivo que viaja con la app: en el paquete, en resources/; en desarrollo, el de Android. */
export function bundled(name: string): string {
  const root = app?.getAppPath?.() ?? process.cwd()
  const candidates = [
    join(process.resourcesPath ?? '', name),
    join(root, 'resources', name),
    join(root, 'android', 'src-tauri', 'recursos', name)
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return candidates[0]
}

const workers: Partial<Record<Role, ChildProcess>> = {}
const waiting = new Map<number, { role: Role; resolve: (v: any) => void; reject: (e: Error) => void }>() // eslint-disable-line @typescript-eslint/no-explicit-any
let seq = 0

function worker(role: Role): ChildProcess {
  const w = workers[role]
  if (w) return w
  const child = fork(join(__dirname, 'sherpa-worker.js'), [role], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    serialization: 'advanced'
  })
  child.on('message', (m: { id: number; ok: boolean; error?: string }) => {
    const p = waiting.get(m.id)
    if (!p) return
    waiting.delete(m.id)
    if (m.ok) p.resolve(m)
    else p.reject(new Error(m.error))
  })
  child.on('exit', (code) => {
    if (workers[role] === child) delete workers[role]
    for (const [id, p] of waiting) {
      if (p.role !== role) continue
      waiting.delete(id)
      p.reject(new Error(`El motor de voz se detuvo (código ${code}). Reintenta.`))
    }
  })
  workers[role] = child
  return child
}

function call<T>(role: Role, msg: Record<string, unknown>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { role, resolve, reject })
    worker(role).send({ id, ...msg })
  })
}

// ── Texto en vivo ──────────────────────────────────────────────────────────────────────────
/** Abre una sesión si el modelo del idioma está descargado; si no, null (se usan los borradores de Whisper). */
export async function liveStart(lang: string): Promise<number | null> {
  const m = liveModelFor(lang)
  if (!m || !localReady(m)) return null
  const files = [m.id, ...companions(m).map((x) => x.id)].map(localPath)
  return (await call<{ session: number }>('live', { type: 'live-start', files })).session
}
export const liveFeed = async (session: number, pcm: Float32Array): Promise<{ text: string }> =>
  ({ text: (await call<{ text: string }>('live', { type: 'live-feed', session, pcm })).text })
export const liveReset = async (session: number): Promise<void> => void (await call('live', { type: 'live-reset', session }))
export const liveStop = async (session: number): Promise<void> => void (await call('live', { type: 'live-stop', session }).catch(() => undefined))

// ── Pronunciación (Kokoro en español) ───────────────────────────────────────────────────────
/** Datos de pronunciación de espeak-ng (es/en), los mismos del APK; se extraen una vez. */
async function espeakData(): Promise<string> {
  const dir = join(dataDir, 'espeak-ng-data')
  if (existsSync(join(dir, 'phondata'))) return dir
  mkdirSync(dataDir, { recursive: true })
  await run('tar', ['-xf', bundled('espeak-ng-data.tar'), '-C', dataDir])
  if (!existsSync(join(dir, 'phondata'))) throw new Error('No se pudieron preparar los datos de pronunciación de Kokoro.')
  return dir
}

/**
 * Copia a la carpeta de datos el pequeño espeak-ng que va con la app. Los recursos del AppImage son
 * de solo lectura, así que no se puede ejecutar desde ahí; la copia ocupa unos 600 KB.
 */
function espeakBinary(): string {
  const dir = join(dataDir, 'espeak-ng')
  const bin = join(dir, 'espeak-ng')
  const lib = join(dir, 'libespeak-ng.so.1')
  if (!existsSync(bin) || !existsSync(lib)) {
    mkdirSync(dir, { recursive: true })
    const src = bundled('espeak-ng')
    const srcLib = bundled('libespeak-ng.so.1')
    if (!existsSync(src) || !existsSync(srcLib)) throw new Error('Falta el motor de pronunciación de Kokoro (espeak-ng).')
    copyFileSync(src, bin)
    copyFileSync(srcLib, lib)
    chmodSync(bin, 0o755)
  }
  return bin
}

/**
 * IPA para Kokoro en español. sherpa-onnx 2.x ya no phonemiza por dentro: los símbolos se pasan como
 * `phonemeCodepoints`. Espeak-ng los produce en una llamada aparte y no toca el proceso de Electron.
 */
async function spanishPhonemes(text: string): Promise<number[]> {
  const bin = espeakBinary()
  const data = await espeakData()
  const { stdout } = await run(bin, [`--path=${data}`, '--ipa', '-v', 'es', text], {
    env: { ...process.env, LD_LIBRARY_PATH: dirname(bin) },
    maxBuffer: 1024 * 1024
  })
  const ipa = String(stdout).replace(/\([a-z-]+\)/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!ipa) throw new Error('No se pudo preparar la pronunciación de Kokoro.')
  return [...ipa].map((c) => c.codePointAt(0) ?? 0)
}

// ── Kokoro ─────────────────────────────────────────────────────────────────────────────────
export const kokoroReady = (): boolean => localReady(KOKORO_MODEL)

/** Lee `text` con una voz «kokoro:…» y devuelve un WAV. */
export async function synthesizeKokoro(voiceId: string, text: string, speed: number): Promise<Buffer> {
  const v = kokoroVoice(voiceId)
  if (!v) throw new Error(`Voz de Kokoro desconocida: ${voiceId}`)
  if (!kokoroReady()) throw new Error('Falta descargar Kokoro (Ajustes → Audio → Modelos de voz).')
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('No hay texto que leer.')
  const f = (n: string): string => localPath(`kokoro.${n}`)
  // Inglés: su léxico (EE. UU. o Reino Unido). Español: IPA de espeak-ng.
  const phonemes = v.accent === 'es' ? await spanishPhonemes(clean) : undefined
  const r = await call<{ samples: Float32Array; sampleRate: number }>('tts', {
    type: 'kokoro', model: f('model.int8.onnx'), voices: f('voices.bin'), tokens: f('tokens.txt'),
    lexicon: v.accent === 'en-us' ? f('lexicon-us-en.txt') : v.accent === 'en-gb' ? f('lexicon-gb-en.txt') : undefined,
    phonemeCodepoints: phonemes, sid: v.sid, text: clean,
    speed: Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1,
    threads: Math.min(4, Math.max(1, cpus().length - 1))
  })
  if (!r.samples.length) throw new Error('Kokoro no pudo leer este texto.')
  return encodeWav(r.samples, r.sampleRate)
}

// ── Supertonic 3 ───────────────────────────────────────────────────────────────────────────
export const supertonicReady = (): boolean => localReady(SUPERTONIC_MODEL)

/** Lee `text` con una voz de Supertonic (sid 0–9) y devuelve un WAV a 44.1 kHz. */
export async function synthesizeSupertonic(sid: number, lang: Lang, text: string, speed: number): Promise<Buffer> {
  if (!supertonicReady()) throw new Error('Falta descargar Supertonic (Ajustes → Audio → Modelos de voz).')
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('No hay texto que leer.')
  const ttsJson = bundled('supertonic-tts.json')
  if (!existsSync(ttsJson)) throw new Error('Falta la configuración de Supertonic. Reinstala la app.')
  const f = (id: string): string => localPath(id)
  const r = await call<{ samples: Float32Array; sampleRate: number }>('tts', {
    type: 'supertonic',
    durationPredictor: f(SUPERTONIC_FILES.durationPredictor),
    textEncoder: f(SUPERTONIC_FILES.textEncoder),
    vectorEstimator: f(SUPERTONIC_FILES.vectorEstimator),
    vocoder: f(SUPERTONIC_FILES.vocoder),
    ttsJson,
    unicodeIndexer: f(SUPERTONIC_FILES.unicodeIndexer),
    voiceStyle: f(SUPERTONIC_FILES.voiceStyle),
    lang,
    sid,
    text: clean,
    speed: Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1,
    threads: Math.min(4, Math.max(1, cpus().length - 1))
  })
  if (!r.samples.length) throw new Error('Supertonic no pudo leer este texto.')
  return encodeWav(r.samples, r.sampleRate)
}

/**
 * Libera el motor de voz (Kokoro/Supertonic) sin tocar el texto en vivo. Si hay una síntesis en
 * curso no se corta: se liberará en la siguiente llamada.
 */
export function releaseTts(): void {
  const w = workers.tts
  if (!w) return
  for (const p of waiting.values()) if (p.role === 'tts') return
  delete workers.tts
  w.kill()
}

export function stopSherpa(): void {
  for (const r of ['live', 'tts'] as Role[]) workers[r]?.kill()
}
