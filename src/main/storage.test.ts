import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJson, readVersioned, SCHEMA_VERSION, writeJson, writeVersioned } from './storage'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dfstore-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('documentos con versión', () => {
  it('escribe y lee', () => {
    const f = join(dir, 'datos.json')
    writeVersioned(f, { hola: 'mundo' })
    expect(readVersioned(f, null, (d) => d)).toEqual({ hola: 'mundo' })
  })

  it('lee un documento viejo sin envolver y lo migra', () => {
    const f = join(dir, 'viejo.json')
    writeFileSync(f, JSON.stringify({ primaryLang: 'en' }))
    const leido = readVersioned<{ primaryLang: string }>(f, { primaryLang: '' }, (d, from) => {
      expect(from).toBe(1)
      return d as { primaryLang: string }
    })
    expect(leido.primaryLang).toBe('en')
  })

  it('migra un documento con una versión anterior', () => {
    const f = join(dir, 'v1.json')
    writeFileSync(f, JSON.stringify({ version: 1, data: { primaryLang: 'en' } }))
    const leido = readVersioned<{ primaryLang: string }>(f, { primaryLang: '' }, (d, from) => {
      expect(from).toBe(1)
      return d as { primaryLang: string }
    })
    expect(leido.primaryLang).toBe('en')
  })

  it('no migra un documento que ya está en la versión actual', () => {
    const f = join(dir, 'actual.json')
    writeVersioned(f, { a: 1 })
    let migrado = false
    readVersioned(f, null, (d) => { migrado = true; return d })
    expect(migrado).toBe(false)
  })

  it('devuelve la reserva si el fichero no existe', () => {
    expect(readVersioned(join(dir, 'nada.json'), 'respaldo', () => 'otro')).toBe('respaldo')
  })

  it('devuelve la reserva si el fichero está roto', () => {
    const f = join(dir, 'roto.json')
    writeFileSync(f, '{ esto no es json')
    expect(readVersioned(f, 'respaldo', () => 'otro')).toBe('respaldo')
  })

  it('aguanta un documento que no es un objeto', () => {
    const f = join(dir, 'lista.json')
    writeFileSync(f, JSON.stringify([1, 2, 3]))
    const leido = readVersioned<number[]>(f, [], (d, from) => {
      expect(from).toBe(1)
      return d as number[]
    })
    expect(leido).toEqual([1, 2, 3])
  })

  it('escribe de forma atómica: no queda un .tmp si todo va bien', () => {
    const f = join(dir, 'atomico.json')
    writeVersioned(f, { a: 1 })
    expect(existsSync(f)).toBe(true)
    expect(existsSync(`${f}.tmp`)).toBe(false)
  })

  it('un JSON roto se lee como la reserva', () => {
    const f = join(dir, 'roto.json')
    writeFileSync(f, 'no es json')
    expect(readJson(f, 'respaldo')).toBe('respaldo')
  })

  it('la versión del esquema es la que se escribe', () => {
    const f = join(dir, 'v.json')
    writeVersioned(f, { a: 1 })
    const crudo = JSON.parse(readFileSync(f, 'utf8')) as { version: number }
    expect(crudo.version).toBe(SCHEMA_VERSION)
  })
})
