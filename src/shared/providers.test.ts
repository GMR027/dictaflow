import { describe, expect, it } from 'vitest'
import { connectPatch, isOpencodeModel, normalizeModel, PROVIDERS, serviceStatus } from './providers'

describe('connectPatch', () => {
  it('activa el servicio con sus valores por defecto', () => {
    const p = connectPatch({ enabledProviders: ['ollama'] }, 'anthropic')
    expect(p.llm).toEqual({ kind: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: undefined })
    expect(p.enabledProviders).toEqual(['ollama', 'anthropic'])
  })
  it('no duplica servicios ya habilitados', () => {
    expect(connectPatch({ enabledProviders: ['opencode'] }, 'opencode').enabledProviders).toEqual(['opencode'])
  })
  it('usa la URL por defecto del servicio compatible con OpenAI', () => {
    expect(connectPatch({ enabledProviders: [] }, 'openai-compat').llm.baseUrl).toBe('http://127.0.0.1:1234/v1')
  })
})

describe('serviceStatus', () => {
  it('pide la clave cuando falta', () => {
    expect(serviceStatus('anthropic', 'ollama', {})).toBe('needs-key')
  })
  it('marca el servicio activo y los listos', () => {
    expect(serviceStatus('anthropic', 'anthropic', { anthropic: true })).toBe('active')
    expect(serviceStatus('anthropic', 'ollama', { anthropic: true })).toBe('ready')
    expect(serviceStatus('opencode', 'ollama', {})).toBe('ready')
  })
})

describe('PROVIDERS', () => {
  it('solo Ollama es local', () => {
    expect(Object.entries(PROVIDERS).filter(([, v]) => !v.cloud).map(([k]) => k)).toEqual(['ollama'])
  })
})

describe('modelos de opencode', () => {
  it('acepta proveedor/modelo y el valor vacío (predeterminado)', () => {
    expect(isOpencodeModel('opencode/minimax-m3.1-flash-free')).toBe(true)
    expect(isOpencodeModel('ollama/qwen2.5:7b')).toBe(true)
    expect(isOpencodeModel('')).toBe(true)
  })

  it('rechaza el nombre visible que rompía la conexión', () => {
    expect(isOpencodeModel('MiniMax M3.1 Flash Free')).toBe(false)
  })

  it('normaliza el valor viejo a un modelo válido', () => {
    expect(normalizeModel('opencode', 'MiniMax M3.1 Flash Free')).toBe('opencode/deepseek-v4.1-flash-free')
    expect(normalizeModel('opencode', '')).toBe('')
    expect(normalizeModel('opencode', 'opencode/deepseek-v4.1-flash-free')).toBe('opencode/deepseek-v4.1-flash-free')
    expect(normalizeModel('claude-cli', 'sonnet')).toBe('sonnet')
  })
})
