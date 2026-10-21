import { describe, expect, it } from 'vitest'
import { bodyBytes, isLocalUrl, localFetch } from './local'

describe('isLocalUrl', () => {
  it('reconoce las direcciones del propio equipo', () => {
    expect(isLocalUrl('http://127.0.0.1:11434/api/tags')).toBe(true)
    expect(isLocalUrl('http://localhost:8080/')).toBe(true)
    expect(isLocalUrl('http://[::1]:8080/')).toBe(true)
  })

  it('no confunde una dirección externa con una local', () => {
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLocalUrl('https://127.0.0.1.evil.com/')).toBe(false)
  })
})

describe('localFetch', () => {
  it('se niega a salir del equipo', async () => {
    await expect(localFetch('https://api.openai.com/v1')).rejects.toThrow(/solo admite direcciones locales/)
  })
})

describe('bodyBytes', () => {
  it('mide el cuerpo de una petición sea del tipo que sea', () => {
    expect(bodyBytes('hola')).toBe(4)
    expect(bodyBytes(new URLSearchParams({ a: 'hola' }))).toBe(6) // «a=hola»
    expect(bodyBytes(new Blob(['hola mundo']))).toBe(10)
    expect(bodyBytes(new Uint8Array([1, 2, 3]))).toBe(3)
    expect(bodyBytes(null)).toBe(0)
  })

  it('suma las partes de un FormData', () => {
    const form = new FormData()
    form.append('a', '12345')
    form.append('file', new Blob(['hola mundo']))
    expect(bodyBytes(form)).toBe(15)
  })
})
