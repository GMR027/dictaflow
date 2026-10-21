import { describe, expect, it } from 'vitest'
import { catalogLangs, filterVoices, mb, speaks, type Voice } from './voice'

const voz = (over: Partial<Voice> = {}): Voice => ({
  id: 'es_MX-ald-medium',
  engine: 'piper',
  langs: ['es'],
  variant: 'es_MX',
  speaker: 'ald',
  label: 'Español (México) · Ald',
  quality: 'medium',
  sizeBytes: 63201294,
  license: 'Unlicense',
  usage: 'libre',
  source: 'rmcpantoja/Ald_Mexican_Spanish_speech_dataset',
  ...over
})

describe('filterVoices', () => {
  const voces = [
    voz(),
    voz({ id: 'es_ES-davefx-medium', variant: 'es_ES', speaker: 'davefx', label: 'Español (España) · Dave' }),
    voz({ id: 'en_US-amy-medium', langs: ['en'], variant: 'en_US', speaker: 'amy', label: 'English (US) · Amy' }),
    voz({ id: 'es_MX-ald-x_low', variant: 'es_MX', quality: 'x_low', label: 'Español (México) · Ald (ligera)' })
  ]

  it('filtra por idioma', () => {
    expect(filterVoices(voces, { lang: 'en' }).map((v) => v.id)).toEqual(['en_US-amy-medium'])
    expect(filterVoices(voces, { lang: 'es' })).toHaveLength(3)
  })

  it('filtra por calidad y por motor', () => {
    expect(filterVoices(voces, { quality: 'x_low' }).map((v) => v.id)).toEqual(['es_MX-ald-x_low'])
    expect(filterVoices(voces, { engine: 'piper' })).toHaveLength(4)
    expect(filterVoices(voces, { engine: 'cloud' })).toHaveLength(0)
  })

  it('busca texto libre en la etiqueta, el identificador y la variante', () => {
    expect(filterVoices(voces, { query: 'méxico' }).map((v) => v.id)).toEqual(['es_MX-ald-medium', 'es_MX-ald-x_low'])
    expect(filterVoices(voces, { query: 'amy' }).map((v) => v.id)).toEqual(['en_US-amy-medium'])
    expect(filterVoices(voces, { query: 'nada de esto' })).toHaveLength(0)
  })

  it('combina filtros', () => {
    expect(filterVoices(voces, { lang: 'es', quality: 'medium', query: 'ald' }).map((v) => v.id)).toEqual(['es_MX-ald-medium'])
  })
})

describe('speaks', () => {
  it('dice si la voz puede hablar ese idioma', () => {
    expect(speaks(voz(), 'es')).toBe(true)
    expect(speaks(voz(), 'en')).toBe(false)
    expect(speaks(voz({ langs: ['es', 'en'] }), 'en')).toBe(true)
  })
})

describe('catalogLangs', () => {
  it('devuelve los idiomas del catálogo sin repetir', () => {
    expect(catalogLangs([voz(), voz({ langs: ['en'] })])).toEqual(['en', 'es'])
  })
})

describe('mb', () => {
  it('convierte bytes en MB con un decimal', () => {
    expect(mb(1048576)).toBe('1.0')
    expect(mb(63201294)).toBe('60.3')
  })
})
