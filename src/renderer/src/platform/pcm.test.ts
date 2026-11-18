import { describe, expect, it } from 'vitest'
import { pcmToB64, whisperPrompt } from './pcm'

describe('pcmToB64', () => {
  it('codifica muestras de 16 bits little-endian', () => {
    const b = Uint8Array.from(atob(pcmToB64(new Float32Array([0, 0.5, -1, 1, 2, NaN]))), (c) => c.charCodeAt(0))
    const v = new DataView(b.buffer)
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(i * 2, true))).toEqual([0, 16384, -32768, 32767, 32767, 0])
  })
  it('aguanta audios largos sin desbordar la pila', () => {
    expect(pcmToB64(new Float32Array(16000 * 30)).length).toBe(Math.ceil((16000 * 30 * 2) / 3) * 4)
  })
})

describe('whisperPrompt', () => {
  it('lleva la puntuación del idioma y los términos del diccionario', () => {
    expect(whisperPrompt('es', [])).toContain('¿qué tal?')
    expect(whisperPrompt('en', [])).toContain('how are you?')
    expect(whisperPrompt('es', ['DictaFlow', ' Kubernetes ', 'DictaFlow', ''])).toMatch(/DictaFlow, Kubernetes\.$/)
  })
})
