// Modelos de IA que se descargan y ejecutan dentro del teléfono (Android).
//
// En escritorio la IA local la sirven Transformers.js/whisper.cpp y Ollama; en Android no hay
// Ollama, así que la app trae los motores (whisper.cpp y llama.cpp) y el usuario descarga aquí los
// modelos. Cada archivo lleva su tamaño y SHA-256 (los de Hugging Face): Rust rechaza una descarga
// que no coincida, y solo acepta direcciones de huggingface.co.

export type LocalModelKind = 'stt' | 'llm'

export interface LocalModel {
  /** Nombre del archivo en el teléfono; también es su identificador. */
  id: string
  kind: LocalModelKind
  label: string
  /** Para qué sirve, en una línea. */
  note: string
  url: string
  bytes: number
  sha256: string
  /** RAM mínima (GB) con la que funciona con holgura. */
  minRamGB: number
}

const hf = (repo: string, file: string): string => `https://huggingface.co/${repo}/resolve/main/${file}`

export const LOCAL_MODELS: LocalModel[] = [
  // ── Voz → texto (whisper.cpp, formato GGML) ──
  {
    id: 'ggml-tiny-q5_1.bin', kind: 'stt', label: 'Whisper tiny', note: 'El más rápido; comete más errores.',
    url: hf('ggerganov/whisper.cpp', 'ggml-tiny-q5_1.bin'), bytes: 32152673,
    sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7', minRamGB: 2
  },
  {
    id: 'ggml-base-q5_1.bin', kind: 'stt', label: 'Whisper base', note: 'Rápido y aceptable para frases cortas.',
    url: hf('ggerganov/whisper.cpp', 'ggml-base-q5_1.bin'), bytes: 59707625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', minRamGB: 3
  },
  {
    id: 'ggml-small-q5_1.bin', kind: 'stt', label: 'Whisper small', note: 'Buen equilibrio entre precisión y velocidad.',
    url: hf('ggerganov/whisper.cpp', 'ggml-small-q5_1.bin'), bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', minRamGB: 4
  },
  {
    id: 'ggml-large-v3-turbo-q5_0.bin', kind: 'stt', label: 'Whisper large-v3-turbo', note: 'El más preciso; más lento y gasta más batería.',
    url: hf('ggerganov/whisper.cpp', 'ggml-large-v3-turbo-q5_0.bin'), bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', minRamGB: 6
  },
  // ── Redacción con IA (llama.cpp, formato GGUF, cuantizados a 4 bits) ──
  {
    id: 'gemma-3-1b-it-Q4_K_M.gguf', kind: 'llm', label: 'Gemma 3 1B', note: 'Muy rápido; para corregir y pulir frases cortas.',
    url: hf('unsloth/gemma-3-1b-it-GGUF', 'gemma-3-1b-it-Q4_K_M.gguf'), bytes: 806058272,
    sha256: '8270790f3ab69fdfe860b7b64008d9a19986d8df7e407bb018184caa08798ebd', minRamGB: 3
  },
  {
    id: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', kind: 'llm', label: 'Qwen2.5 1.5B', note: 'Rápido; redacción y traducción de textos cortos.',
    url: hf('Qwen/Qwen2.5-1.5B-Instruct-GGUF', 'qwen2.5-1.5b-instruct-q4_k_m.gguf'), bytes: 1117320736,
    sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e', minRamGB: 4
  },
  {
    id: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', kind: 'llm', label: 'Llama 3.2 3B', note: 'Mejor redacción; más lento.',
    url: hf('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'), bytes: 2019377696,
    sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff', minRamGB: 6
  },
  {
    id: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', kind: 'llm', label: 'Qwen3 4B', note: 'La mejor calidad: actas, prompts y textos largos. El más lento.',
    url: hf('unsloth/Qwen3-4B-Instruct-2507-GGUF', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'), bytes: 2497281120,
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', minRamGB: 7
  }
]

/** Estado de un modelo según lo que hay en el teléfono. */
export interface LocalModelFile {
  id: string
  /** Bytes en disco (si está a medias, lo descargado hasta ahora). */
  bytes: number
  /** true si la descarga quedó a medias y se puede reanudar. */
  partial: boolean
}

/** Progreso de una descarga, emitido por Rust en el evento `models:progress`. */
export interface LocalModelProgress {
  id: string
  state: 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled'
  received: number
  total: number
  error?: string
}

/** Lo que el teléfono informa para elegir modelos. */
export interface DeviceInfo {
  ramGB: number
  freeGB: number
  cores: number
}

export type Fit = 'recommended' | 'ok' | 'slow'

/**
 * Qué tan bien le va un modelo a este teléfono. Se recomienda uno por tipo: el más capaz que
 * cabe con holgura, sin pasar de small en voz (en el teléfono la velocidad importa más) ni de
 * 1.5B en redacción (el usuario puede elegir uno mayor si prefiere calidad a velocidad).
 */
export function modelFit(m: LocalModel, ramGB: number): Fit {
  if (ramGB > 0 && ramGB < m.minRamGB) return 'slow'
  return recommendedId(m.kind, ramGB) === m.id ? 'recommended' : 'ok'
}

const PREFERRED: Record<LocalModelKind, string[]> = {
  stt: ['ggml-small-q5_1.bin', 'ggml-base-q5_1.bin', 'ggml-tiny-q5_1.bin'],
  llm: ['qwen2.5-1.5b-instruct-q4_k_m.gguf', 'gemma-3-1b-it-Q4_K_M.gguf']
}

export function recommendedId(kind: LocalModelKind, ramGB: number): string {
  const fits = PREFERRED[kind].find((id) => {
    const m = LOCAL_MODELS.find((x) => x.id === id)
    return m && (ramGB <= 0 || ramGB >= m.minRamGB)
  })
  return fits ?? PREFERRED[kind][PREFERRED[kind].length - 1]
}

/** Tamaño legible: «57 MB», «1.1 GB». */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}
