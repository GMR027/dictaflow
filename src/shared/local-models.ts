// Modelos de IA que se descargan y ejecutan dentro del teléfono (Android).
//
// En escritorio la IA local la sirven Transformers.js/whisper.cpp y Ollama; en Android no hay
// Ollama, así que la app trae los motores (whisper.cpp y llama.cpp) y el usuario descarga aquí los
// modelos. Cada archivo lleva su tamaño y SHA-256 (los de Hugging Face): Rust rechaza una descarga
// que no coincida, y solo acepta direcciones de huggingface.co.
import type { Lang } from './types'
import { VOICE_META, voiceSampleUrl } from './voice-catalog'
import { KOKORO_MODEL } from './kokoro'
import { SUPERTONIC_MODEL } from './supertonic'

/** stt: Whisper (texto definitivo) · live: texto en vivo mientras hablas · llm: redacción · tts: voces. */
export type LocalModelKind = 'stt' | 'live' | 'llm' | 'tts'

/** Un archivo que acompaña al modelo (la configuración de una voz, las partes de un modelo en vivo). */
export interface LocalModelExtra {
  id: string
  url: string
  bytes: number
  sha256: string
}

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
  /** Solo se ofrece en esta plataforma (p. ej. Supertonic, que aún no existe en escritorio). */
  platform?: 'android'
  /** Voces: identificador de la voz (el de escritorio, sin «.onnx»), su idioma y su configuración. */
  voice?: string
  lang?: Lang
  extra?: LocalModelExtra
  /** Más archivos acompañantes (modelos de varias partes). */
  extras?: LocalModelExtra[]
}

/** Archivos que acompañan al modelo principal (se descargan antes que él). */
export const companions = (m: LocalModel): LocalModelExtra[] => [...(m.extra ? [m.extra] : []), ...(m.extras ?? [])]

const hf = (repo: string, file: string): string => `https://huggingface.co/${repo}/resolve/main/${file}`

/**
 * Voz Piper en la copia preparada para sherpa-onnx (csukuangfj/vits-piper-*): el modelo .onnx lleva
 * los metadatos que necesita sherpa-onnx y el .onnx.json la tabla de fonemas. La ficha (nombre,
 * licencia) es la de escritorio.
 */
function voice(id: string, bytes: number, sha256: string, configBytes: number, configSha256: string): LocalModel {
  const meta = VOICE_META[id]
  const repo = `csukuangfj/vits-piper-${id}`
  const calidad = { x_low: 'muy ligera', low: 'ligera', medium: 'calidad media', high: 'alta calidad' }[meta.quality]
  const uso = meta.usage === 'no-comercial' ? ' · solo uso no comercial' : meta.usage === 'terminos-propios' ? ' · con sus propias condiciones' : ''
  return {
    id: `${id}.onnx`, kind: 'tts', label: meta.label, note: `Voz de ${calidad} · licencia ${meta.license}${uso}.`,
    url: hf(repo, `${id}.onnx`), bytes, sha256, minRamGB: 2, voice: id, lang: meta.langs[0],
    extra: { id: `${id}.onnx.json`, url: hf(repo, `${id}.onnx.json`), bytes: configBytes, sha256: configSha256 }
  }
}

/**
 * Modelo de texto en vivo (copia de csukuangfj para sherpa-onnx de Kroko-ASR, de Banafo). Sus
 * archivos se llaman igual en todos los idiomas (encoder.onnx…), así que en el teléfono llevan
 * delante «kroko-<idioma>.».
 */
function live(lang: Lang, label: string, encBytes: number, encSha: string, decSha: string, joinSha: string, tokBytes: number, tokSha: string): LocalModel {
  const repo = `csukuangfj/sherpa-onnx-streaming-zipformer-${lang}-kroko-2025-08-06`
  const base = `kroko-${lang}`
  return {
    id: `${base}.encoder.onnx`, kind: 'live', label,
    note: 'Escribe lo que dices palabra a palabra mientras hablas; Whisper pone el texto definitivo. Licencia CC-BY-SA (Kroko).',
    url: hf(repo, 'encoder.onnx'), bytes: encBytes, sha256: encSha, minRamGB: 3, lang,
    extras: [
      { id: `${base}.decoder.onnx`, url: hf(repo, 'decoder.onnx'), bytes: 617488, sha256: decSha },
      { id: `${base}.joiner.onnx`, url: hf(repo, 'joiner.onnx'), bytes: 336817, sha256: joinSha },
      { id: `${base}.tokens.txt`, url: hf(repo, 'tokens.txt'), bytes: tokBytes, sha256: tokSha }
    ]
  }
}

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
  // ── Texto en vivo (zipformer streaming de Kroko para sherpa-onnx, licencia CC-BY-SA) ──
  live('es', 'Texto en vivo · español', 154878102, '2d9f5ef87d1a5257f8a6687e21501c56f3aa2fcbfcfab9364dcc4ce4e06ae81b',
    'd4ce176b94b25f7acc88717bc3f704fcf5d6e131aaac2e0cabab3885541181ee', 'dae35df88d676e320fcdb99217328e66dcf722bf11b0f2459e14ddb5b982ded5',
    6385, '1be5e0a58e05d06d327df4c6b7b5e4f8aba01da6981eb016fcaceafc6a56680f'),
  live('en', 'Texto en vivo · English', 70092599, 'd4881c57449d581e0770fd53fa66c2fdc6cd167d92ece7c715e603defc96d9d4',
    '455ba38466fce8d5a57e7db68a323b684079ca4d9e1dd93a740d9b2429aae3b1', 'd406f616736350e2a7df3e39398b78eb2fc1a2ca6973a19d3853fa3227e25b52',
    6310, '396dbeb5f4858875690716084f54e90d339679d0ba3e6b5b584f3d7589254d2d'),
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
  },
  // ── Lectura en voz alta (voces Piper con sherpa-onnx). Las mismas de escritorio salvo
  //    es_MX-ald-x_low, que no tiene copia para sherpa-onnx. ──
  voice('es_MX-claude-high', 63122441, 'f5eceb904655a60141037d957f21e6257efa93b8c8b7b818c0c57396217bcb1c', 4963, '1afc81f703c0e4cb3b4d7c0dca096b8b54a98806807f0170cf5eb5557723c12d'),
  voice('es_MX-ald-medium', 63201426, 'b5e77074846d97651421244167a11d53c762fa41f953de98ab21957a6036eab4', 4889, 'efab736e62e5321dd5d063d1b46e63c59ce655419816355b81d025c1a8d6b03c'),
  voice('es_ES-davefx-medium', 63201422, '329fc723ef304f8688df9ef819eea169a4181f60a77f53e087b19dbca07b09f8', 4817, '0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842'),
  voice('es_ES-sharvard-medium', 76733743, 'f26006cd03e2d558966fa3c49cfa9361dfa22d72197d74b6b50437cb02b8faaf', 4903, '7438c9b699c72b0c3388dae1b68d3f364dc66a2150fe554a1c11f03372957b2c'),
  voice('en_US-lessac-medium', 63201425, 'ea793a648ce0370665f99fbf891eae3b3a973565c72b08534bb5b2c04e8f2332', 4885, 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0'),
  voice('en_US-amy-medium', 63201425, 'fbaa8e36d8f26fe6f3ebb65cab461e629d8b37a5b7c5fb78fb64317db73e1c25', 4882, '95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77'),
  voice('en_US-kristin-medium', 63531507, 'f9a5c375c70ddc33ccdb3969c76a4d7cc5255ac08119a312b0034a1d07041be6', 4968, '5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c'),
  voice('en_US-hfc_female-medium', 63201425, '6d8b3711715f17f29b9f0ded97571924ead9a06e300bfdf3680b014a51ddc9e5', 5033, '03f1fa0622b80463283592d97aca9f6e89aec345a5c56b7257723e0093c58b6c'),
  voice('en_US-ryan-high', 120786923, '4343c10fd88301574d2012b3d006fa5fc8fdf18d04ca9564ef399eed180d8788', 4166, 'c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011'),
  KOKORO_MODEL,
  SUPERTONIC_MODEL,
  voice('en_GB-alan-medium', 63201430, 'd907c48857000940104a9ad3248a94617df917d1a525c9495490fdbf87fd54b2', 4888, 'c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e')
]

/** Voz del catálogo de Android por su identificador de escritorio («es_MX-claude-high»). */
export const localVoice = (voiceId: string): LocalModel | undefined => LOCAL_MODELS.find((m) => m.kind === 'tts' && m.voice === voiceId)

/** Muestra de audio de una voz del catálogo. */
export const localVoiceSample = (voiceId: string): string => voiceSampleUrl(voiceId)

/** Estado de un modelo según lo que hay en el teléfono. */
export interface LocalModelFile {
  id: string
  /** Bytes en disco (si está a medias, lo descargado hasta ahora). */
  bytes: number
  /** true si la descarga quedó a medias y se puede reanudar. */
  partial: boolean
}

/** ¿Está el modelo completo en el teléfono? (una voz necesita también su configuración). */
export function modelReady(m: LocalModel, files: LocalModelFile[]): boolean {
  const has = (id: string): boolean => files.some((f) => f.id === id && !f.partial)
  return has(m.id) && companions(m).every((x) => has(x.id))
}

/** Lo que ocupa el modelo con todos sus archivos. */
export const totalBytes = (m: LocalModel): number => m.bytes + companions(m).reduce((a, x) => a + x.bytes, 0)

/** Modelo de texto en vivo para un idioma. */
export const liveModelFor = (lang: string): LocalModel | undefined => LOCAL_MODELS.find((m) => m.kind === 'live' && m.lang === lang)

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
  live: ['kroko-es.encoder.onnx'],
  llm: ['qwen2.5-1.5b-instruct-q4_k_m.gguf', 'gemma-3-1b-it-Q4_K_M.gguf'],
  tts: ['es_MX-claude-high.onnx']
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
