import { describe, expect, it } from 'vitest'
import { cliPath, parseOpencodeModels, parseOpencodeRun, resolveBin, stripAnsi } from './cli'

describe('stripAnsi', () => {
  it('quita los códigos de color de los CLI', () => {
    expect(stripAnsi('\x1b[91m\x1b[1mError:\x1b[0m hola')).toBe('Error: hola')
  })
})

describe('parseOpencodeModels', () => {
  it('lee los IDs proveedor/modelo y descarta adornos', () => {
    const out = [
      'deepseek/deepseek-flash',
      'ollama/qwen2.5:7b',
      'opencode/minimax-m3.1-flash-free',
      '> build · algo',
      '',
      'texto suelto'
    ].join('\n')
    expect(parseOpencodeModels(out)).toEqual([
      'deepseek/deepseek-flash',
      'ollama/qwen2.5:7b',
      'opencode/minimax-m3.1-flash-free'
    ])
  })
})

describe('parseOpencodeRun', () => {
  it('devuelve solo el texto del modelo', () => {
    const out = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"Hola "}}',
      '{"type":"text","part":{"type":"text","text":"mundo."}}'
    ].join('\n')
    expect(parseOpencodeRun(out)).toBe('Hola mundo.')
  })

  it('convierte un error JSON en excepción (aunque el CLI salga con código 0)', () => {
    const out = '{"type":"error","error":{"message":"Invalid model reference: MiniMax"}}'
    expect(() => parseOpencodeRun(out)).toThrow(/Invalid model reference/)
  })

  it('acepta salida plana de versiones antiguas', () => {
    expect(parseOpencodeRun('Texto normal')).toBe('Texto normal')
  })
})

describe('resolveBin', () => {
  it('encuentra un binario en un PATH explícito', () => {
    expect(resolveBin('sh', '/bin')).toBe('/bin/sh')
  })

  it('devuelve null si no existe', () => {
    expect(resolveBin('no-existe-dictaflow', '/bin')).toBeNull()
  })
})

describe('cliPath', () => {
  it('antepone las carpetas habituales de los CLI', () => {
    const p = cliPath('/usr/bin')
    expect(p).toContain('.opencode/bin')
    expect(p).toContain('/usr/bin')
  })
})
