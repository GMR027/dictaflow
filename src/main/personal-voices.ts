// Voces personales: las que crea el usuario a partir de una grabación.
//
// Puntos importantes:
//
//  1. El consentimiento es obligatorio. No se puede guardar una voz sin saying
//     quién autoriza y cuándo. No se clonan voces de terceros.
//  2. Todo se queda en el equipo: las grabaciones, los metadatos y los audios
//     generados viven en la carpeta de datos.
//  3. El motor es enchufable. Esta build no incluye un motor de clonación
//     (los que hay pesan entre 2 y 3 GB y algunos no se pueden usar
//     comercialmente), pero se puede apuntar a un servicio local que el
//     usuario tenga en marcha.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Lang, PersonalVoice, VoiceRecording } from '@shared/types'
import type { GeneratedClip } from '@shared/voice'
import { dataDir } from './paths'
import { netFetch } from './netlog'

const base = join(dataDir, 'voces')
const samplesDir = join(base, 'muestras')
const voicesFile = join(base, 'voces.json')
const recordingsFile = join(base, 'grabaciones.json')
const generatedFile = join(base, 'generados.json')


function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(base, { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export const listPersonalVoices = (): PersonalVoice[] => readJson<PersonalVoice[]>(voicesFile, [])
export const listRecordings = (): VoiceRecording[] => readJson<VoiceRecording[]>(recordingsFile, [])
export const listGenerated = (): GeneratedClip[] => readJson<GeneratedClip[]>(generatedFile, [])

/** Guarda una voz. Sin consentimiento no se guarda. */
export function savePersonalVoice(v: PersonalVoice): PersonalVoice {
  if (!v.consent?.authorizedBy?.trim()) throw new Error('Falta el consentimiento: dice quién autoriza el uso de esta voz.')
  if (!v.consent.date) throw new Error('Falta la fecha del consentimiento.')
  const all = listPersonalVoices()
  const i = all.findIndex((x) => x.id === v.id)
  const guardada: PersonalVoice = { ...v, available: checkAvailable(v.engine), unavailableReason: unavailableReason(v.engine) }
  if (i >= 0) all[i] = guardada
  else all.unshift(guardada)
  writeJson(voicesFile, all)
  return guardada
}

export function removePersonalVoice(id: string): void {
  writeJson(voicesFile, listPersonalVoices().filter((v) => v.id !== id))
}

/** Guarda una grabación original importada por el usuario. */
export function saveRecording(name: string, data: Uint8Array, speaker: string, durationSec: number): VoiceRecording {
  mkdirSync(samplesDir, { recursive: true })
  const id = crypto.randomUUID()
  const path = join(samplesDir, `${id}.wav`)
  writeFileSync(path, data)
  const r: VoiceRecording = { id, name, path, durationSec, createdAt: Date.now(), speaker }
  const all = listRecordings()
  all.unshift(r)
  writeJson(recordingsFile, all)
  return r
}

export function removeRecording(id: string): void {
  const r = listRecordings().find((x) => x.id === id)
  if (r && existsSync(r.path)) rmSync(r.path, { force: true })
  writeJson(recordingsFile, listRecordings().filter((x) => x.id !== id))
}

/** El motor de clonación: un servicio local que el usuario tenga en marcha. */
export const cloneEngineUrl = (): string => readJson<{ url: string }>(join(base, 'motor.json'), { url: 'http://127.0.0.1:8020' }).url

export const setCloneEngineUrl = (url: string): void => {
  mkdirSync(base, { recursive: true })
  writeJson(join(base, 'motor.json'), { url })
}

/** ¿Hay un motor de clonación accesible? */
export async function checkEngine(): Promise<{ ok: boolean; message: string }> {
  const url = cloneEngineUrl()
  try {
    const res = await netFetch('clone:check', `${url.replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) return { ok: true, message: `Motor encontrado en ${url}` }
    return { ok: false, message: `El motor de ${url} respondió ${res.status}.` }
  } catch (e) {
    return { ok: false, message: `No hay motor de clonación en ${url}: ${(e as Error).message}` }
  }
}

const checkAvailable = (engine: string): boolean => engine === 'servicio-local'
const unavailableReason = (engine: string): string | undefined =>
  engine === 'servicio-local' ? undefined : `Motor desconocido: ${engine}`

/**
 * Sintetiza con una voz personal usando el motor local configurado.
 * Devuelve los bytes del audio generado.
 */
export async function synthesizePersonal(voice: PersonalVoice, text: string): Promise<{ audio: Uint8Array; durationSec: number }> {
  if (voice.engine !== 'servicio-local') throw new Error(`El motor «${voice.engine}» no está disponible en esta versión.`)
  const url = cloneEngineUrl().replace(/\/$/, '')
  const res = await netFetch('clone:synth', `${url}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice: voice.id, language: voice.lang })
  })
  if (!res.ok) throw new Error(`El motor de clonación respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const audio = new Uint8Array(await res.arrayBuffer())
  return { audio, durationSec: Math.round((audio.length / 32000) * 10) / 10 }
}

/** Guarda un audio generado con una voz personal. */
export function saveGenerated(clip: GeneratedClip): void {
  mkdirSync(join(base, 'generados'), { recursive: true })
  const all = listGenerated()
  all.unshift(clip)
  writeJson(generatedFile, all.slice(0, 100))
}

/** Borra un audio generado. */
export function removeGenerated(id: string): void {
  const c = listGenerated().find((x) => x.id === id)
  if (c && existsSync(c.path)) rmSync(c.path, { force: true })
  writeJson(generatedFile, listGenerated().filter((x) => x.id !== id))
}

/** Espacio que ocupan las voces personales, en MB. */
export function personalVoicesSizeMB(): number {
  let n = 0
  const walk = (d: string): void => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else n += statSync(p).size
    }
  }
  walk(base)
  return Math.round((n / 1048576) * 10) / 10
}

export const personalVoicesDir = (): string => base
export const langOf = (l: string): Lang => (l === 'en' ? 'en' : 'es')
