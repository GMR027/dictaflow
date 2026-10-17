import { spawn, execFile } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { promisify } from 'util'
import type { Lang, TtsStatus, Voice } from '@shared/types'
import { netFetch } from './netlog'
import { dataDir, getSecret, getSettings } from './store'

const run = promisify(execFile)
const piperDir = join(dataDir, 'piper')
const piperBin = join(piperDir, 'piper', 'piper')
const voicesDir = join(dataDir, 'voices')
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
const PIPER_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz'

export const VOICES: Voice[] = [
  { id: 'es_ES-davefx-medium', lang: 'es', label: 'Español (España) · Dave', path: 'es/es_ES/davefx/medium', sizeMB: 63 },
  { id: 'es_MX-ald-medium', lang: 'es', label: 'Español (México) · Ald', path: 'es/es_MX/ald/medium', sizeMB: 63 },
  { id: 'en_US-lessac-medium', lang: 'en', label: 'English (US) · Lessac', path: 'en/en_US/lessac/medium', sizeMB: 63 },
  { id: 'en_US-amy-medium', lang: 'en', label: 'English (US) · Amy', path: 'en/en_US/amy/medium', sizeMB: 63 }
]

export function ttsStatus(): TtsStatus {
  mkdirSync(voicesDir, { recursive: true })
  return {
    piperInstalled: existsSync(piperBin),
    voices: readdirSync(voicesDir).filter((f) => f.endsWith('.onnx')).map((f) => f.replace('.onnx', ''))
  }
}

async function download(purpose: string, url: string, dest: string, onPct: (pct: number) => void): Promise<void> {
  const res = await netFetch(purpose, url)
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let got = 0
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c: Buffer) => { got += c.length; if (total) onPct(Math.round((got / total) * 100)) })
  await pipeline(src, createWriteStream(dest))
}

export async function installPiper(onPct: (what: string, pct: number) => void): Promise<void> {
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  mkdirSync(piperDir, { recursive: true })
  const tgz = join(piperDir, 'piper.tgz')
  await download('piper:binary', PIPER_URL, tgz, (p) => onPct('Motor de voz', p))
  await run('tar', ['-xzf', tgz, '-C', piperDir])
  rmSync(tgz, { force: true })
}

export async function installVoice(id: string, onPct: (what: string, pct: number) => void): Promise<void> {
  const v = VOICES.find((x) => x.id === id)
  if (!v) throw new Error(`Voz desconocida: ${id}`)
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  mkdirSync(voicesDir, { recursive: true })
  await download('piper:voice-config', `${HF}/${v.path}/${id}.onnx.json`, join(voicesDir, `${id}.onnx.json`), () => undefined)
  await download('piper:voice', `${HF}/${v.path}/${id}.onnx`, join(voicesDir, `${id}.onnx`), (p) => onPct(v.label, p))
}

/** Devuelve un WAV. Local con Piper o nube compatible con OpenAI según Ajustes. */
export async function synthesize(text: string, lang: Lang): Promise<Buffer> {
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

  const voice = s.ttsVoice[lang]
  const model = join(voicesDir, `${voice}.onnx`)
  if (!existsSync(piperBin) || !existsSync(model)) throw new Error('Falta instalar el motor o la voz local (Audio → Texto a voz).')
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
