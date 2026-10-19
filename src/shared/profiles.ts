import type { HardwareInfo, HwProfile, Settings } from './types'

/** Medición corta de la voz en este equipo: ms que tarda transcribir 3 s de audio con el modelo indicado. */
export interface SttBench { model: string; ms: number }

export interface ProfileInfo {
  label: string
  summary: string
  /** Qué ajustes cambia y por qué */
  detail: string
  settings: Pick<Settings, 'sttModel' | 'draftsEnabled' | 'autoRewrite' | 'rewriteDelayMs' | 'pauseMs'>
}

export const PROFILES: Record<HwProfile, ProfileInfo> = {
  light: {
    label: 'Ligero',
    summary: 'Equipos antiguos o con poca memoria',
    detail: 'Whisper base (unos 400 MB de RAM), sin texto provisional y sin redacción automática: el motor se dedica solo a transcribir. La redacción sigue disponible con el botón.',
    settings: { sttModel: 'Xenova/whisper-base', draftsEnabled: false, autoRewrite: false, rewriteDelayMs: 4000, pauseMs: 900 }
  },
  balanced: {
    label: 'Equilibrado',
    summary: 'CPU moderna y memoria suficiente',
    detail: 'Whisper small (el más preciso en español entre los probados que cabe en CPU), texto provisional y redacción automática a los 2,5 s.',
    settings: { sttModel: 'Xenova/whisper-small', draftsEnabled: true, autoRewrite: true, rewriteDelayMs: 2500, pauseMs: 900 }
  },
  accelerated: {
    label: 'Acelerado',
    summary: 'Equipo con GPU y memoria de sobra',
    detail: 'Igual que Equilibrado pero cierra las frases antes (800 ms) y redacta a los 1,5 s. La GPU la aprovecha la redacción (Ollama); la voz solo usa GPU con whisper.cpp compilado con soporte de GPU.',
    settings: { sttModel: 'Xenova/whisper-small', draftsEnabled: true, autoRewrite: true, rewriteDelayMs: 1500, pauseMs: 800 }
  }
}

export interface Classification { profile: HwProfile; reasons: string[] }

/** Un STT de 3 s por encima de esto ya no permite dictado fluido con borradores. */
export const SLOW_MS = 3500

export function classify(hw: HardwareInfo, bench?: SttBench): Classification {
  const reasons: string[] = []
  if (hw.ramGB < 7) reasons.push(`RAM baja (${hw.ramGB} GB)`)
  if (hw.arch === 'x64' && !hw.cpuFlags.avx2) reasons.push('la CPU no tiene AVX2')
  if (hw.cores < 4) reasons.push(`pocos núcleos (${hw.cores})`)
  if (bench && bench.ms > SLOW_MS) reasons.push(`la prueba de voz tardó ${Math.round(bench.ms)} ms para 3 s de audio`)
  if (reasons.length) return { profile: 'light', reasons }

  const gpu = hw.gpuVendor !== 'none'
  if (gpu && hw.ramGB >= 12 && hw.cores >= 6 && hw.cpuFlags.avx2) {
    return { profile: 'accelerated', reasons: [`GPU detectada (${hw.gpu})`, `${hw.ramGB} GB de RAM`, `${hw.cores} núcleos`] }
  }
  return { profile: 'balanced', reasons: ['CPU y memoria suficientes, sin GPU adecuada para acelerar'] }
}
