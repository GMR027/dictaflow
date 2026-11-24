import { describe, expect, it } from 'vitest'
import { dictationOptions, featureKey, liveOptions, liveReady, llmOptions, serviceEnabled, ttsReady, voiceOptions } from './features'
import { DEFAULT_SETTINGS } from './types'
import type { VoiceStatus } from './voice'

const voice = (p: Partial<VoiceStatus> & Pick<VoiceStatus, 'id' | 'engine' | 'langs' | 'label'>): VoiceStatus => ({
  variant: 'es_ES', speaker: 'voz', quality: 'medium', sizeBytes: 63_000_000,
  license: 'CC0', usage: 'libre', source: 'prueba', installed: false, ...p
})

describe('catálogo de servicios', () => {
  it('en el teléfono ofrece el motor propio y Whisper, con etiquetas sin nombres de archivo', () => {
    const opts = dictationOptions('android', 8, [], true)
    expect(opts[0]).toMatchObject({ id: 'telefono', installed: true, recommended: true, action: { kind: 'system-stt' } })
    const whisper = opts.find((o) => o.id === 'ggml-small-q5_1.bin')!
    expect(whisper.label).toBe('Equilibrada')
    expect(whisper.recommended).toBe(true)
    expect(whisper.note).not.toMatch(/\.bin|ggml/)
  })

  it('en escritorio el dictado se prepara con Whisper y no se ofrece el motor del teléfono', () => {
    const opts = dictationOptions('linux', 8, [], null, false)
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ id: 'whisper', installed: false, action: { kind: 'stt-prepare' } })
  })

  it('las opciones de IA usan calidades, no nombres de archivo', () => {
    const opts = llmOptions(8, [])
    const qwen = opts.find((o) => o.id === 'qwen2.5-1.5b-instruct-q4_k_m.gguf')!
    expect(qwen.label).toBe('Equilibrada')
    expect(qwen.recommended).toBe(true)
    expect(qwen.sizeBytes).toBeGreaterThan(1e9)
    expect(opts.every((o) => !o.label.endsWith('.gguf'))).toBe(true)
  })

  it('las voces del teléfono van primero y siempre queda una voz natural descargable', () => {
    const catalog = [
      voice({ id: 'es_ES-davefx-medium', engine: 'piper', langs: ['es'], label: 'Dave' }),
      voice({ id: 'sistema:es-es-x-eea-local', engine: 'sistema', langs: ['es'], label: 'Español (España) · voz 1', installed: true, sizeBytes: 0 })
    ]
    const opts = voiceOptions('es', catalog)
    expect(opts[0]).toMatchObject({ id: 'sistema:es-es-x-eea-local', installed: true, action: { kind: 'system-voice' } })
    expect(opts.some((o) => o.id === 'es_ES-davefx-medium' && !o.installed)).toBe(true)
    expect(opts.every((o) => o.lang === 'es')).toBe(true)
  })

  it('la voz y el texto en vivo solo están listos si están instalados y activados', () => {
    const catalog = [
      voice({ id: 'sistema:es', engine: 'sistema', langs: ['es'], label: 'Teléfono', installed: true, sizeBytes: 0 }),
      voice({ id: 'es_ES-davefx-medium', engine: 'piper', langs: ['es'], label: 'Dave' })
    ]
    const settings = { ...DEFAULT_SETTINGS, ttsVoice: { es: 'es_ES-davefx-medium', en: 'en_US-lessac-medium' }, features: { ...DEFAULT_SETTINGS.features, liveText: true } }
    expect(ttsReady(settings, 'es', catalog)).toBe(false)
    expect(ttsReady({ ...settings, ttsVoice: { ...settings.ttsVoice, es: 'sistema:es' } }, 'es', catalog)).toBe(true)

    const live = liveOptions('es', [])
    expect(live[0].label).toBe('Texto en vivo · español')
    expect(liveReady('es', [])).toBe(false)
    expect(liveReady('es', [{ id: live[0].id, bytes: 1, partial: false }])).toBe(false)
  })

  it('mapea el texto en vivo a su interruptor y el dictado siempre está activo', () => {
    const settings = { ...DEFAULT_SETTINGS, features: { ai: false, tts: false, liveText: false } }
    expect(featureKey('live')).toBe('liveText')
    expect(serviceEnabled(settings, 'dictation')).toBe(true)
    expect(serviceEnabled(settings, 'ai')).toBe(false)
    expect(serviceEnabled(settings, 'tts')).toBe(false)
  })
})
