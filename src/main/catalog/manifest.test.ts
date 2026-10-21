import { describe, expect, it } from 'vitest'
import manifest from './manifest.json'

interface Entry {
  id: string
  dir: string
  model: { url: string; size: number; sha256: string }
  config: { url: string; size: number; sha256: string }
}

const voices = manifest.voices as Entry[]

describe('manifiesto de voces', () => {
  it('tiene todas las voces del catálogo', () => {
    expect(voices).toHaveLength(11)
    expect(voices.map((v) => v.id)).toContain('es_MX-ald-x_low')
  })

  it('no duplica la ruta de la configuración (el fallo que rompía las descargas)', () => {
    for (const v of voices) {
      const path = new URL(v.config.url).pathname
      // La ruta correcta es .../<dir>/<archivo>.onnx.json, una sola vez.
      expect(path.endsWith(`/${v.id}.onnx.json`)).toBe(true)
      expect(path.split(`/${v.dir}/`)).toHaveLength(2)
    }
  })

  it('la URL del modelo y su hash son coherentes', () => {
    for (const v of voices) {
      expect(new URL(v.model.url).pathname.endsWith(`/${v.id}.onnx`)).toBe(true)
      expect(v.model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(v.config.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(v.model.size).toBeGreaterThan(0)
      expect(v.config.size).toBeGreaterThan(0)
    }
  })

  it('el motor Piper tiene hash y tamaño', () => {
    expect(manifest.piper.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.piper.size).toBeGreaterThan(1_000_000)
  })
})
