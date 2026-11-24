import { describe, expect, it } from 'vitest'
import { needsRewrite } from './rewrite-policy'

describe('política de redacción inteligente', () => {
  it('deja intacto un dictado corto y bien puntuado', () => {
    expect(needsRewrite('Hola, ¿qué tal? Nos vemos mañana.')).toBe(false)
    expect(needsRewrite('Vale.')).toBe(false)
  })

  it('redacta si faltan signos de puntuación', () => {
    expect(needsRewrite('hola qué tal nos vemos mañana')).toBe(true)
  })

  it('redacta si hay muletillas o palabras repetidas', () => {
    expect(needsRewrite('eh, nos vemos mañana.')).toBe(true)
    expect(needsRewrite('o sea, es que no sé.')).toBe(true)
    expect(needsRewrite('vamos vamos allá.')).toBe(true)
  })

  it('redacta textos largos aunque estén bien puntuados', () => {
    expect(needsRewrite(`${'Una frase completa. '.repeat(12)}`)).toBe(true)
  })

  it('con un tono elegido siempre redacta', () => {
    expect(needsRewrite('Hola, ¿qué tal?', 'formal')).toBe(true)
  })

  it('no redacta un texto vacío', () => {
    expect(needsRewrite('   ')).toBe(false)
  })
})
