import { execFile } from 'child_process'
import { cpus, totalmem } from 'os'
import { statfs } from 'fs/promises'
import { promisify } from 'util'
import type { HardwareInfo, ModelRec } from '@shared/types'
import { netFetch } from './netlog'

const run = promisify(execFile)

async function which(bin: string): Promise<boolean> {
  try {
    await run('which', [bin])
    return true
  } catch {
    return false
  }
}

export async function listOllamaModels(baseUrl = 'http://127.0.0.1:11434'): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await netFetch('ollama:list', `${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
    const json = (await res.json()) as { models: { name: string }[] }
    return { running: true, models: json.models.map((m) => m.name) }
  } catch {
    return { running: false, models: [] }
  }
}

export async function detectHardware(): Promise<HardwareInfo> {
  let gpu = 'No detectada'
  let gpuVendor: HardwareInfo['gpuVendor'] = 'none'
  try {
    const { stdout } = await run('lspci', [])
    const line = stdout.split('\n').find((l) => /VGA|3D controller/i.test(l))
    if (line) {
      gpu = line.replace(/^.*?: /, '').replace(/\(rev .*\)/, '').trim()
      gpuVendor = /nvidia/i.test(line) ? 'nvidia' : /amd|ati/i.test(line) ? 'amd' : /intel/i.test(line) ? 'intel' : 'none'
    }
  } catch {
    /* lspci no disponible */
  }
  let diskFreeGB = 0
  try {
    const s = await statfs(process.env.HOME ?? '/')
    diskFreeGB = Math.round((s.bavail * s.bsize) / 1e9)
  } catch {
    /* ignorar */
  }
  const [ollamaState, ollamaInstalled, claude, opencode] = await Promise.all([
    listOllamaModels(), which('ollama'), which('claude'), which('opencode')
  ])
  const ollama = { ...ollamaState, installed: ollamaInstalled || ollamaState.running }
  return {
    cpu: cpus()[0]?.model.trim() ?? 'CPU desconocida',
    cores: cpus().length,
    ramGB: Math.round(totalmem() / 1e9),
    gpu,
    gpuVendor,
    diskFreeGB,
    ollama,
    clis: { claude, opencode }
  }
}

/** Recomendación según RAM/GPU. Se asume inferencia en CPU para STT (onnxruntime-node). */
export function recommend(hw: HardwareInfo): ModelRec[] {
  const ram = hw.ramGB
  const stt = (id: string, label: string, sizeMB: number, minRam: number, note: string, best: boolean): ModelRec => ({
    id, kind: 'stt', label, sizeMB, note,
    status: ram < minRam ? 'slow' : best ? 'recommended' : 'ok'
  })
  const llm = (id: string, label: string, sizeMB: number, minRam: number, note: string, best: boolean): ModelRec => ({
    id, kind: 'llm', label, sizeMB, note,
    status: ram < minRam ? 'slow' : best ? 'recommended' : 'ok'
  })
  const bigStt = ram >= 16
  return [
    stt('Xenova/whisper-tiny', 'Whisper tiny', 75, 4, 'Muy rápido, precisión baja', false),
    stt('Xenova/whisper-base', 'Whisper base', 145, 4, 'Rápido, precisión aceptable', ram < 8),
    stt('Xenova/whisper-small', 'Whisper small', 480, 8, 'Buen equilibrio para español/inglés', ram >= 8 && !bigStt),
    stt('Xenova/whisper-medium', 'Whisper medium', 1500, 16, 'Mejor precisión, más lento en CPU', bigStt),
    llm('qwen2.5:3b', 'Qwen 2.5 3B', 1900, 6, 'Redacción rápida', ram < 12),
    llm('qwen2.5:7b', 'Qwen 2.5 7B', 4700, 12, 'Mejor redacción en español', ram >= 12),
    llm('llama3.1:8b', 'Llama 3.1 8B', 4900, 12, 'Alternativa general', false)
  ]
}
