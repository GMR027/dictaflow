import { describe, expect, it } from 'vitest'
import { companions, modelReady } from './local-models'
import {
  SUPERTONIC_BYTES, SUPERTONIC_MODEL, SUPERTONIC_VOICES, supertonicCatalog,
  supertonicId, supertonicLabel, supertonicVoice
} from './supertonic'

describe('Supertonic 3', () => {
  it('tiene diez voces con sid 0–9 y etiquetas legibles', () => {
    expect(SUPERTONIC_VOICES).toHaveLength(10)
    expect(SUPERTONIC_VOICES.map((v) => v.sid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(SUPERTONIC_VOICES.map((v) => v.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'])
    expect(supertonicLabel(SUPERTONIC_VOICES[0])).toBe('Supertonic F1 (mujer)')
    expect(supertonicLabel(SUPERTONIC_VOICES[5])).toBe('Supertonic M1 (hombre)')
  })

  it('convierte entre identificador y voz', () => {
    for (const v of SUPERTONIC_VOICES) {
      expect(supertonicVoice(supertonicId(v))).toEqual(v)
    }
    expect(supertonicVoice('supertonic:F9')).toBeUndefined()
    expect(supertonicVoice('kokoro:ef_dora')).toBeUndefined()
  })

  it('comparte un solo modelo de seis archivos', () => {
    expect(SUPERTONIC_MODEL.kind).toBe('tts')
    expect(SUPERTONIC_MODEL.voice).toBeUndefined()
    expect(SUPERTONIC_MODEL.platform).toBe('android')
    expect(companions(SUPERTONIC_MODEL)).toHaveLength(5)
    const total = SUPERTONIC_MODEL.bytes + companions(SUPERTONIC_MODEL).reduce((a, x) => a + x.bytes, 0)
    expect(total).toBe(SUPERTONIC_BYTES)
    expect(SUPERTONIC_BYTES).toBe(145_287_515)
  })

  it('solo está listo con todos los archivos completos', () => {
    const files = [SUPERTONIC_MODEL, ...companions(SUPERTONIC_MODEL)].map((m) => ({ id: m.id, bytes: 1, partial: false }))
    expect(modelReady(SUPERTONIC_MODEL, files)).toBe(true)
    expect(modelReady(SUPERTONIC_MODEL, files.slice(0, -1))).toBe(false)
    expect(modelReady(SUPERTONIC_MODEL, files.map((f, i) => (i === 2 ? { ...f, partial: true } : f)))).toBe(false)
  })

  it('publica las diez voces en el catálogo, instaladas o no', () => {
    for (const installed of [true, false]) {
      const catalog = supertonicCatalog(installed)
      expect(catalog).toHaveLength(10)
      expect(catalog.every((v) => v.engine === 'supertonic' && v.installed === installed)).toBe(true)
      expect(catalog.every((v) => v.langs.includes('es') && v.langs.includes('en'))).toBe(true)
    }
  })
})
