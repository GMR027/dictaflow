import { describe, expect, it } from 'vitest'
import { KOKORO_MODEL, KOKORO_VOICES, kokoroId, kokoroLabel, kokoroVoice } from './kokoro'

describe('Kokoro', () => {
  it('voces en español e inglés con su número en voices.bin', () => {
    expect(KOKORO_VOICES.filter((v) => v.lang === 'es').map((v) => [v.name, v.sid])).toEqual([['ef_dora', 28], ['em_alex', 29], ['em_santa', 53]])
    expect(KOKORO_VOICES.filter((v) => v.accent === 'en-us')).toHaveLength(20)
    expect(KOKORO_VOICES.filter((v) => v.accent === 'en-gb')).toHaveLength(8)
    expect(kokoroVoice('kokoro:af_heart')?.sid).toBe(3)
    expect(kokoroVoice('kokoro:nada')).toBeUndefined()
    expect(kokoroVoice('es_MX-claude-high')).toBeUndefined()
  })
  it('voices.bin trae 54 voces (510 × 256 float32 cada una)', () => {
    expect(KOKORO_MODEL.extras!.find((x) => x.id === 'kokoro.voices.bin')!.bytes).toBe(54 * 510 * 256 * 4)
  })
  it('etiquetas legibles', () => {
    expect(kokoroLabel(kokoroVoice(kokoroId(KOKORO_VOICES[28]))!)).toBe('Español · Dora (Kokoro, mujer)')
  })
})
