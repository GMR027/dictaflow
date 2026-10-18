import { describe, expect, it } from 'vitest'
import { connectPatch, PROVIDERS, serviceStatus } from './providers'

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
