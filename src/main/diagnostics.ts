// Diagnóstico: reúne en un sitio lo que hace falta para saber por qué algo
// no funciona, sin tener que buscarlo por el sistema.
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { arch, cpus, freemem, platform, release, totalmem } from 'os'
import { join } from 'path'
import type { SttStatus } from '@shared/types'
import type { Diagnostics } from '@shared/diagnostics'
import { detectHardware } from './hardware'
import { dataDir, getSettings } from './store'
import { modelsDir } from './paths'
import { VOICE_CATALOG, piperInstalled, voicesDir } from './catalog/voices'
import { getNetEvents } from './netlog'
import { GGML_MODELS } from './whispercpp'
import { listAudiobooks } from './audio/export'

export type { Diagnostics }

/** Tamaño en MB de una carpeta. */
function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try { total += statSync(p).size } catch { /* ilegible */ }
      }
    }
  }
  walk(dir)
  return Math.round((total / 1048576) * 10) / 10
}

/** Los modelos de Whisper ya descargados. */
function whisperModels(): string[] {
  const dir = join(modelsDir, 'Xenova')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) => existsSync(join(dir, d)))
}

/** Recoge el estado completo del programa y del equipo. */
export async function diagnostics(stt: SttStatus): Promise<Diagnostics> {
  const hw = await detectHardware()
  const s = getSettings()
  const voices = VOICE_CATALOG.filter((v) => existsSync(join(voicesDir, `${v.id}.onnx`))).map((v) => v.id)
  let writable = true
  try {
    const probe = join(dataDir, '.prueba-escritura')
    writeFileSync(probe, 'x')
    rmSync(probe, { force: true })
  } catch {
    writable = false
  }
  return {
    app: { version: process.env.npm_package_version ?? '', electron: process.versions.electron, node: process.versions.node },
    system: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model.trim() ?? 'CPU desconocida',
      cores: cpus().length,
      ramGB: Math.round(totalmem() / 1e9),
      freeGB: Math.round(freemem() / 1e9),
      gpu: hw.gpu
    },
    hardware: hw,
    paths: { data: dataDir, models: modelsDir, voices: voicesDir, writable },
    engines: {
      whisper: { models: whisperModels(), active: stt.active, fallbackReason: stt.fallbackReason },
      whispercpp: {
        binary: stt.cpp.bin,
        model: stt.cpp.model,
        models: stt.cpp.ggml.map((m) => ({ id: m.id, installed: m.installed }))
      },
      piper: { installed: piperInstalled(), voices },
      ollama: { installed: hw.ollama.installed, running: hw.ollama.running, models: hw.ollama.models }
    },
    storage: {
      dataMB: dirSize(dataDir),
      modelsMB: dirSize(modelsDir),
      voicesMB: dirSize(voicesDir),
      audiobooks: listAudiobooks().length
    },
    network: { events: getNetEvents().length },
    settings: { strictOffline: s.strictOffline, sttProvider: s.sttProvider, ttsProvider: s.ttsProvider, sttEngine: s.sttEngine }
  }
}

/** Los modelos ggml de whisper.cpp que se pueden descargar. */
export const ggmlCatalog = GGML_MODELS
