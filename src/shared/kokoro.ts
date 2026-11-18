// Kokoro v1.0 (hexgrad/Kokoro-82M, Apache-2.0) en la copia int8 de sherpa-onnx: un solo modelo con
// 54 voces. Aquí solo las que hablan español o inglés; el número es su `sid` en voices.bin
// (tabla oficial de sherpa-onnx; em_santa se añadió al final, en el 53).
import type { Lang } from './types'
import type { LocalModel } from './local-models'

/** Idioma de pronunciación que entiende Rust (modelos.rs, idioma_kokoro). */
export type KokoroLang = 'es' | 'en-us' | 'en-gb'

export interface KokoroVoice {
  /** Nombre oficial («ef_dora»). */
  name: string
  sid: number
  lang: Lang
  accent: KokoroLang
  gender: 'mujer' | 'hombre'
}

const NAMES = [
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
  'ef_dora', 'em_alex'
]

export const KOKORO_VOICES: KokoroVoice[] = [...NAMES.map((name, sid) => ({ name, sid })), { name: 'em_santa', sid: 53 }].map(({ name, sid }) => {
  const accent: KokoroLang = name[0] === 'e' ? 'es' : name[0] === 'b' ? 'en-gb' : 'en-us'
  return { name, sid, accent, lang: accent === 'es' ? 'es' : 'en', gender: name[1] === 'f' ? 'mujer' : 'hombre' }
})

/** Identificador de voz en Ajustes («kokoro:ef_dora»). */
export const kokoroId = (v: KokoroVoice): string => `kokoro:${v.name}`
export const kokoroVoice = (id: string): KokoroVoice | undefined =>
  id.startsWith('kokoro:') ? KOKORO_VOICES.find((v) => v.name === id.slice(7)) : undefined

export function kokoroLabel(v: KokoroVoice): string {
  const nombre = v.name.slice(3).replace(/^./, (c) => c.toUpperCase())
  const zona = { es: 'Español', 'en-us': 'English (US)', 'en-gb': 'English (UK)' }[v.accent]
  return `${zona} · ${nombre} (Kokoro, ${v.gender})`
}

const hf = (file: string): string => `https://huggingface.co/csukuangfj/kokoro-int8-multi-lang-v1_0/resolve/main/${file}`

/** El modelo descargable (en el teléfono sus archivos llevan delante «kokoro.»). */
export const KOKORO_MODEL: LocalModel = {
  id: 'kokoro.model.int8.onnx', kind: 'tts', label: 'Kokoro · 31 voces naturales (español e inglés)',
  note: 'Voz mucho más natural que Piper (3 en español, 28 en inglés). Más lenta: ideal para el lector y audiolibros. Apache-2.0.',
  url: hf('model.int8.onnx'), bytes: 114202993, sha256: '75635ea3b85a32d00094dcdd61a258aba87c160f7c264c304a7b3ae9d734195e', minRamGB: 4,
  extras: [
    { id: 'kokoro.voices.bin', url: hf('voices.bin'), bytes: 28200960, sha256: '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29' },
    { id: 'kokoro.tokens.txt', url: hf('tokens.txt'), bytes: 687, sha256: '6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425' },
    { id: 'kokoro.lexicon-us-en.txt', url: hf('lexicon-us-en.txt'), bytes: 5956885, sha256: '7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14' },
    { id: 'kokoro.lexicon-gb-en.txt', url: hf('lexicon-gb-en.txt'), bytes: 6366635, sha256: 'c4cbb37316f62210dff52718a7afcaae24f50c032cc75ab47ae67b831d1049e7' }
  ]
}
