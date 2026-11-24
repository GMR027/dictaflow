// Supertonic 3 (Supertone) en Android y escritorio: un solo modelo con 10 voces y 31 idiomas,
// 44.1 kHz.
//
// Se usa la copia int8 preparada para sherpa-onnx (unos 145 MB). El `tts.json` que describe el
// vocoder va dentro de la app porque el descargador solo acepta .bin/.onnx/.txt/.gguf; los otros
// seis archivos se descargan de Hugging Face y se verifican con su SHA-256.
import type { LocalModel } from './local-models'
import type { VoiceStatus } from './voice'

export type SupertonicVoiceId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5'

export interface SupertonicVoice {
  id: SupertonicVoiceId
  /** Índice en `voice.bin` (orden alfabético: F1–F5, M1–M5). */
  sid: number
  gender: 'mujer' | 'hombre'
}

export const SUPERTONIC_VOICES: SupertonicVoice[] = [
  { id: 'F1', sid: 0, gender: 'mujer' },
  { id: 'F2', sid: 1, gender: 'mujer' },
  { id: 'F3', sid: 2, gender: 'mujer' },
  { id: 'F4', sid: 3, gender: 'mujer' },
  { id: 'F5', sid: 4, gender: 'mujer' },
  { id: 'M1', sid: 5, gender: 'hombre' },
  { id: 'M2', sid: 6, gender: 'hombre' },
  { id: 'M3', sid: 7, gender: 'hombre' },
  { id: 'M4', sid: 8, gender: 'hombre' },
  { id: 'M5', sid: 9, gender: 'hombre' }
]

/** Bytes que ocupan los seis archivos descargados (sin el tts.json incrustado). */
export const SUPERTONIC_BYTES = 145_287_515

const hf = (file: string): string =>
  `https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/main/${file}`

/** Los seis archivos que espera el motor. El `tts.json` va dentro de la app. */
export const SUPERTONIC_FILES = {
  durationPredictor: 'duration_predictor.int8.onnx',
  textEncoder: 'text_encoder.int8.onnx',
  vectorEstimator: 'vector_estimator.int8.onnx',
  vocoder: 'vocoder.int8.onnx',
  unicodeIndexer: 'unicode_indexer.bin',
  voiceStyle: 'voice.bin'
} as const

/**
 * El modelo descargable. Su archivo principal es el vector estimator (el más grande); los demás
 * viajan como acompañantes. No lleva `voice` porque las diez voces comparten este mismo modelo.
 */
export const SUPERTONIC_MODEL: LocalModel = {
  id: SUPERTONIC_FILES.vectorEstimator,
  kind: 'tts',
  label: 'Supertonic 3 · 10 voces y 31 idiomas',
  note: 'Voz natural a 44.1 kHz; una sola descarga. Más pesada que Piper; ideal para el lector y los audiolibros. Pesos OpenRAIL-M (Supertone).',
  url: hf(SUPERTONIC_FILES.vectorEstimator),
  bytes: 78_400_833,
  sha256: '20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd',
  minRamGB: 5,
  extras: [
    {
      id: SUPERTONIC_FILES.durationPredictor, url: hf(SUPERTONIC_FILES.durationPredictor),
      bytes: 3_700_147, sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'
    },
    {
      id: SUPERTONIC_FILES.textEncoder, url: hf(SUPERTONIC_FILES.textEncoder),
      bytes: 36_416_150, sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'
    },
    {
      id: SUPERTONIC_FILES.vocoder, url: hf(SUPERTONIC_FILES.vocoder),
      bytes: 25_991_073, sha256: 'e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152'
    },
    {
      id: SUPERTONIC_FILES.unicodeIndexer, url: hf(SUPERTONIC_FILES.unicodeIndexer),
      bytes: 262_144, sha256: '8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30'
    },
    {
      id: SUPERTONIC_FILES.voiceStyle, url: hf(SUPERTONIC_FILES.voiceStyle),
      bytes: 517_168, sha256: '67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8'
    }
  ]
}

export const supertonicId = (v: SupertonicVoice): string => `supertonic:${v.id}`

export const supertonicVoice = (id: string): SupertonicVoice | undefined =>
  id.startsWith('supertonic:') ? SUPERTONIC_VOICES.find((v) => v.id === id.slice('supertonic:'.length)) : undefined

export const supertonicLabel = (v: SupertonicVoice): string => `Supertonic ${v.id} (${v.gender})`

/** Las diez voces comparten el modelo: o están todas o no está ninguna. */
export function supertonicCatalog(installed: boolean): VoiceStatus[] {
  return SUPERTONIC_VOICES.map((v): VoiceStatus => ({
    id: supertonicId(v),
    engine: 'supertonic',
    langs: ['es', 'en'],
    variant: 'multi',
    speaker: v.id,
    label: supertonicLabel(v),
    quality: 'high',
    sizeBytes: SUPERTONIC_BYTES,
    license: 'OpenRAIL-M (pesos) · MIT (conversión)',
    usage: 'terminos-propios',
    source: 'Supertone/supertonic-3 · sherpa-onnx int8',
    sampleUrl: 'local',
    installed,
    note: 'Voz natural de 44.1 kHz; una descarga para 10 voces y 31 idiomas.'
  }))
}
