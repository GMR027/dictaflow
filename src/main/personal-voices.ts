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
import { join, resolve, sep } from 'path'
import type { Lang, PersonalVoice, VoiceRecording } from '@shared/types'
import type { GeneratedClip } from '@shared/voice'
import { dataDir } from './paths'
import { netFetch } from './netlog'
import { installedVoiceIds, piperInstalled } from './catalog/voices'
import { synthesize } from './tts'

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

/**
 * Guarda una voz. Sin consentimiento no se guarda.
 * La disponibilidad se comprueba de verdad: antes se marcaba disponible una voz
 * de clonación aunque no hubiera ningún motor escuchando.
 */
export async function savePersonalVoice(v: PersonalVoice): Promise<PersonalVoice> {
  if (!v.consent?.authorizedBy?.trim()) throw new Error('Falta el consentimiento: dice quién autoriza el uso de esta voz.')
  if (!v.consent.date) throw new Error('Falta la fecha del consentimiento.')
  const all = listPersonalVoices()
  const i = all.findIndex((x) => x.id === v.id)
  const estado = await voiceAvailability(v)
  const guardada: PersonalVoice = { ...v, ...estado }
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

/**
 * ¿Hay un motor de clonación accesible? Un 404 también cuenta: significa que
 * hay algo escuchando en ese puerto (antes se daba por roto).
 */
export async function checkEngine(): Promise<{ ok: boolean; message: string }> {
  const url = cloneEngineUrl().replace(/\/$/, '')
  let last = ''
  for (const path of ['/health', '/']) {
    try {
      const res = await netFetch('clone:check', `${url}${path}`, { signal: AbortSignal.timeout(1500) })
      if (res.status < 500) return { ok: true, message: `Motor encontrado en ${url} (HTTP ${res.status}).` }
      last = `HTTP ${res.status}`
    } catch (e) {
      last = (e as Error).message
    }
  }
  return { ok: false, message: `No hay motor de clonación en ${url}: ${last}` }
}

/** Estado real de una voz según su motor. */
async function voiceAvailability(v: PersonalVoice): Promise<Pick<PersonalVoice, 'available' | 'unavailableReason'>> {
  if (v.engine === 'piper') {
    const ok = piperInstalled() && !!v.piperVoice && installedVoiceIds().includes(v.piperVoice)
    return ok
      ? { available: true }
      : { available: false, unavailableReason: 'Falta la voz local de Piper. Descárgala en Audio → Texto a voz.' }
  }
  if (v.engine === 'servicio-local') {
    const e = await checkEngine()
    return e.ok ? { available: true } : { available: false, unavailableReason: e.message }
  }
  return { available: false, unavailableReason: `Motor desconocido: ${v.engine}` }
}

/** Duración aproximada de un WAV (cabecera RIFF), en segundos. */
export function wavDurationSec(wav: Uint8Array): number {
  try {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    if (view.getUint32(0, false) !== 0x52494646) return Math.round((wav.length / 32000) * 10) / 10
    let off = 12
    let byteRate = 0
    let dataSize = 0
    while (off + 8 <= wav.length) {
      const id = String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3])
      const size = view.getUint32(off + 4, true)
      if (id === 'fmt ' && off + 16 <= wav.length) byteRate = view.getUint32(off + 16, true)
      if (id === 'data') { dataSize = size; break }
      off += 8 + size + (size % 2)
    }
    if (!byteRate || !dataSize) return Math.round((wav.length / 32000) * 10) / 10
    return Math.round((dataSize / byteRate) * 10) / 10
  } catch {
    return Math.round((wav.length / 32000) * 10) / 10
  }
}

/** Devuelve los bytes de una grabación o de un audio generado (solo dentro de datos). */
export function readPersonalAudio(path: string): Uint8Array {
  const root = resolve(base)
  const file = resolve(path)
  if (file !== root && !file.startsWith(root + sep)) throw new Error('Ese audio no pertenece a DictaFlow.')
  if (!existsSync(file)) throw new Error('El audio ya no existe.')
  return new Uint8Array(readFileSync(file))
}

/**
 * Sintetiza con una voz personal usando el motor local configurado.
 * Devuelve los bytes del audio generado.
 */
export async function synthesizePersonal(voice: PersonalVoice, text: string): Promise<{ audio: Uint8Array; durationSec: number }> {
  if (voice.engine === 'piper') {
    if (!voice.piperVoice) throw new Error('Esta voz no tiene una voz local de Piper asignada.')
    const audio = new Uint8Array(await synthesize(text, voice.lang, voice.piperVoice))
    return { audio, durationSec: wavDurationSec(audio) }
  }
  if (voice.engine !== 'servicio-local') throw new Error(`El motor «${voice.engine}» no está disponible en esta versión.`)
  const url = cloneEngineUrl().replace(/\/$/, '')
  const res = await netFetch('clone:synth', `${url}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice: voice.id, language: voice.lang })
  })
  if (!res.ok) throw new Error(`El motor de clonación respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const audio = new Uint8Array(await res.arrayBuffer())
  return { audio, durationSec: wavDurationSec(audio) }
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
