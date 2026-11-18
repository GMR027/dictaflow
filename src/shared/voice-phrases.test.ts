import { describe, expect, it } from 'vitest'
import { REFERENCE_SCRIPT, TEST_PHRASES } from './voice-phrases'

describe('frases de voz', () => {
  it('hay frases variadas en los dos idiomas, sin repetir', () => {
    for (const lang of ['es', 'en'] as const) {
      const f = TEST_PHRASES[lang]
      expect(f.length).toBeGreaterThanOrEqual(10)
      expect(new Set(f).size).toBe(f.length)
      expect(f.some((x) => x.includes('?'))).toBe(true)
      expect(f.some((x) => x.includes('!'))).toBe(true)
    }
  })
  it('el guion de referencia dura unos 30 s leído con calma (~70–110 palabras)', () => {
    for (const lang of ['es', 'en'] as const) {
      const words = REFERENCE_SCRIPT[lang].split(/\s+/).length
      expect(words).toBeGreaterThan(70)
      expect(words).toBeLessThan(130)
    }
  })
  it('las frases en español tocan rr, ñ, ll, j y ch', () => {
    const all = TEST_PHRASES.es.join(' ').toLowerCase()
    for (const s of ['rr', 'ñ', 'll', 'j', 'ch', 'ü']) expect(all).toContain(s)
  })
})
