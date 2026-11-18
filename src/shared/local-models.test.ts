import { describe, expect, it } from 'vitest'
import { companions, formatBytes, liveModelFor, localVoice, LOCAL_MODELS, modelFit, modelReady, recommendedId } from './local-models'
import { DEFAULT_SETTINGS } from './types'
import { VOICE_META } from './voice-catalog'

/** Misma regla que Rust (modelos.rs, validar_pedido): el nombre de la dirección, o con un prefijo sin puntos. */
const sameFile = (url: string, id: string): boolean => {
  const last = new URL(url).pathname.split('/').pop()!
  return id === last || (id.endsWith(`.${last}`) && !id.slice(0, -last.length - 1).includes('.') && id.length > last.length + 1)
}

describe('catálogo de modelos locales', () => {
  it('solo descarga de huggingface.co por https, con SHA-256 y nombre de archivo coherente', () => {
    const ids = new Set<string>()
    for (const m of LOCAL_MODELS) {
      const url = new URL(m.url)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('huggingface.co')
      expect(sameFile(m.url, m.id)).toBe(true)
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(m.bytes).toBeGreaterThan(1e6)
      expect(m.id).toMatch({ stt: /^ggml-.*\.bin$/, live: /^kroko-[a-z]{2}\.encoder\.onnx$/, llm: /\.gguf$/, tts: /\.onnx$/ }[m.kind])
      for (const id of [m.id, ...companions(m).map((x) => x.id)]) {
        if (!id) continue
        expect(ids.has(id)).toBe(false)
        ids.add(id)
      }
      for (const x of companions(m)) {
        expect(new URL(x.url).hostname).toBe('huggingface.co')
        expect(sameFile(x.url, x.id)).toBe(true)
        expect(x.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('las voces son las de escritorio, con su configuración y sus voces por defecto', () => {
    const voices = LOCAL_MODELS.filter((m) => m.kind === 'tts' && m.voice)
    expect(voices.length).toBeGreaterThanOrEqual(10)
    for (const v of voices) {
      expect(VOICE_META[v.voice!]).toBeDefined()
      expect(v.id).toBe(`${v.voice}.onnx`)
      expect(v.extra?.id).toBe(`${v.voice}.onnx.json`)
      expect(v.lang).toBe(VOICE_META[v.voice!].langs[0])
    }
    expect(localVoice(DEFAULT_SETTINGS.ttsVoice.es)).toBeDefined()
    expect(localVoice(DEFAULT_SETTINGS.ttsVoice.en)).toBeDefined()
  })

  it('una voz solo está lista con el modelo y su configuración completos', () => {
    const v = localVoice('es_MX-claude-high')!
    expect(modelReady(v, [{ id: v.id, bytes: 1, partial: false }])).toBe(false)
    expect(modelReady(v, [{ id: v.id, bytes: 1, partial: false }, { id: v.extra!.id, bytes: 1, partial: true }])).toBe(false)
    expect(modelReady(v, [{ id: v.id, bytes: 1, partial: false }, { id: v.extra!.id, bytes: 1, partial: false }])).toBe(true)
  })

  it('recomienda según la RAM del teléfono', () => {
    expect(recommendedId('stt', 8)).toBe('ggml-small-q5_1.bin')
    expect(recommendedId('stt', 3)).toBe('ggml-base-q5_1.bin')
    expect(recommendedId('stt', 1)).toBe('ggml-tiny-q5_1.bin')
    expect(recommendedId('llm', 8)).toBe('qwen2.5-1.5b-instruct-q4_k_m.gguf')
    expect(recommendedId('llm', 3)).toBe('gemma-3-1b-it-Q4_K_M.gguf')
    // Sin dato de RAM (el WebView no siempre lo da) se recomienda igual que con mucha.
    expect(recommendedId('llm', 0)).toBe('qwen2.5-1.5b-instruct-q4_k_m.gguf')
  })

  it('marca como lentos los modelos que no caben con holgura', () => {
    const qwen4b = LOCAL_MODELS.find((m) => m.id.startsWith('Qwen3-4B'))!
    expect(modelFit(qwen4b, 4)).toBe('slow')
    expect(modelFit(qwen4b, 8)).toBe('ok')
    const small = LOCAL_MODELS.find((m) => m.id === 'ggml-small-q5_1.bin')!
    expect(modelFit(small, 8)).toBe('recommended')
  })

  it('formatea tamaños', () => {
    expect(formatBytes(59707625)).toBe('60 MB')
    expect(formatBytes(1117320736)).toBe('1.1 GB')
    expect(formatBytes(1000)).toBe('1 MB')
  })
})

describe('texto en vivo', () => {
  it('cada idioma tiene su modelo con las cuatro partes', () => {
    for (const lang of ['es', 'en']) {
      const m = liveModelFor(lang)!
      expect(m.id).toBe(`kroko-${lang}.encoder.onnx`)
      expect(companions(m).map((x) => x.id)).toEqual([`kroko-${lang}.decoder.onnx`, `kroko-${lang}.joiner.onnx`, `kroko-${lang}.tokens.txt`])
    }
    expect(liveModelFor('fr')).toBeUndefined()
  })
  it('modelReady exige todas las partes', () => {
    const m = liveModelFor('es')!
    const all = [m.id, ...companions(m).map((x) => x.id)].map((id) => ({ id, bytes: 1, partial: false }))
    expect(modelReady(m, all)).toBe(true)
    expect(modelReady(m, all.slice(0, 3))).toBe(false)
  })
})
