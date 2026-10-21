import { execFile, spawn } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { Lang, TtsStatus } from '@shared/types'
import { dataDir, getSecret, getSettings } from './store'
import { downloadFile } from './download'
import { netFetch } from './netlog'
import {
  installedVoiceIds, piperBin, piperDir, piperInstalled, piperManifest, removeVoice,
  voiceConfigPath, voiceManifest, voiceModelPath, voicesDir
} from './catalog/voices'

const run = promisify(execFile)

/** Estado del motor de voz local y de las voces descargadas. */
export function ttsStatus(): TtsStatus {
  return { piperInstalled: piperInstalled(), voices: installedVoiceIds() }
}

/**
 * Instala el motor Piper. El tarball se verifica con su SHA-256 antes de
 * descomprimirlo: no se ejecuta nada que no haya pasado la comprobación.
 */
export async function installPiper(onPct: (what: string, pct: number) => void, signal?: AbortSignal): Promise<void> {
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  const m = piperManifest()
  const tgz = join(piperDir, 'piper.tgz')
  await downloadFile({
    purpose: 'piper:binary',
    url: m.url,
    dest: tgz,
    sha256: m.sha256,
    size: m.size,
    onPct: (pct) => onPct('Motor de voz', pct),
    signal
  })
  await run('tar', ['-xzf', tgz, '-C', piperDir])
  rmSync(tgz, { force: true })
  if (!existsSync(piperBin)) throw new Error('El motor Piper se descargó pero no se pudo instalar. Revisa los permisos de la carpeta de datos.')
}

/**
 * Descarga una voz del catálogo: su modelo y su configuración, los dos verificados.
 * Si se interrumpe, no queda nada a medias: los ficheros se renombran al final.
 */
export async function installVoice(id: string, onPct: (what: string, pct: number) => void, signal?: AbortSignal): Promise<void> {
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  const m = voiceManifest(id)
  if (!m) throw new Error(`Voz desconocida: ${id}`)
  await downloadFile({
    purpose: 'piper:voice-config',
    url: m.config.url,
    dest: voiceConfigPath(id),
    sha256: m.config.sha256,
    size: m.config.size,
    signal
  })
  await downloadFile({
    purpose: 'piper:voice',
    url: m.model.url,
    dest: voiceModelPath(id),
    sha256: m.model.sha256,
    size: m.model.size,
    onPct: (pct) => onPct(id, pct),
    signal
  })
}

/** Borra una voz descargada. */
export { removeVoice }

/**
 * Muestra de audio de una voz (para escuchar antes de descargarla). Se pide
 * directamente a la fuente oficial; no se guarda en el equipo.
 */
export async function fetchVoiceSample(id: string): Promise<Uint8Array> {
  const m = voiceManifest(id)
  if (!m?.sample) throw new Error('Esta voz no tiene muestra de audio.')
  const res = await netFetch('piper:sample', m.sample)
  if (!res.ok) throw new Error(`No se pudo descargar la muestra (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Devuelve un WAV. Local con Piper o nube compatible con OpenAI según Ajustes. */
export async function synthesize(text: string, lang: Lang, voiceId?: string): Promise<Buffer> {
  const s = getSettings()
  if (s.ttsProvider === 'openai') {
    const key = getSecret('openai-audio')
    if (!key) throw new Error('Falta la API key de audio en la nube (Ajustes → Audio).')
    const res = await netFetch('openai:tts', `${s.cloudAudio.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: s.cloudAudio.ttsModel, voice: s.cloudAudio.ttsVoice, input: text, response_format: 'wav', speed: s.ttsSpeed })
    })
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`)
    return Buffer.from(await res.arrayBuffer())
  }

  const voice = voiceId ?? s.ttsVoice[lang]
  const model = voiceModelPath(voice)
  if (!existsSync(piperBin)) throw new Error('Falta instalar el motor de voz local (Audio → Texto a voz).')
  if (!existsSync(model)) throw new Error(`La voz ${voice} no está descargada (Audio → Texto a voz).`)
  if (!existsSync(voiceConfigPath(voice))) throw new Error(`La voz ${voice} está incompleta: falta su configuración. Vuelve a descargarla.`)

  const out = join(dataDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(piperBin, ['--model', model, '--length_scale', String(1 / s.ttsSpeed), '--output_file', out], {
      env: { ...process.env, LD_LIBRARY_PATH: join(piperDir, 'piper') },
      stdio: ['pipe', 'ignore', 'pipe']
    })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300) || `piper código ${code}`))))
    child.stdin.end(text.replace(/\s+/g, ' ').trim())
  })
  const wav = readFileSync(out)
  rmSync(out, { force: true })
  return wav
}

/** Ruta de la carpeta de voces (la interfaz la necesita para abrirla). */
export const voicesFolder = (): string => voicesDir
