import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auraBusy, auraListen, auraState, DONE_MS, onAura, withAura } from './aura'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.runAllTimers(); vi.useRealTimers() })

describe('aura de audio', () => {
  it('azul al escuchar, amarillo al transcribir, verde unos segundos al terminar', () => {
    const seen: string[] = []
    const off = onAura((s) => { if (seen.at(-1) !== s) seen.push(s) })
    const stopMic = auraListen()
    const end = auraBusy() // un borrador mientras se escucha: sigue azul
    expect(auraState()).toBe('listen')
    stopMic()
    expect(auraState()).toBe('busy')
    end(true)
    vi.advanceTimersByTime(500)
    expect(auraState()).toBe('done')
    vi.advanceTimersByTime(DONE_MS)
    expect(auraState()).toBe('idle')
    expect(seen).toEqual(['listen', 'busy', 'done', 'idle'])
    off()
  })

  it('transcribir y luego redactar: amarillo continuo y un solo verde al final', () => {
    const a = auraBusy()
    a(true)
    vi.advanceTimersByTime(100)
    const b = auraBusy() // empieza la redacción antes de que se vea el verde
    expect(auraState()).toBe('busy')
    vi.advanceTimersByTime(1000)
    expect(auraState()).toBe('busy')
    b(true)
    vi.advanceTimersByTime(500)
    expect(auraState()).toBe('done')
  })

  it('sin verde si falla o no hubo texto; cerrar dos veces no descuenta de más', async () => {
    const stop = auraListen()
    stop(); stop()
    expect(auraState()).toBe('idle')
    await expect(withAura(async () => { throw new Error('x') })).rejects.toThrow('x')
    vi.advanceTimersByTime(500)
    expect(auraState()).toBe('idle')
    const end = auraBusy()
    end(false)
    vi.advanceTimersByTime(500)
    expect(auraState()).toBe('idle')
  })

  it('volver a hablar quita el verde', () => {
    auraBusy()(true)
    vi.advanceTimersByTime(500)
    expect(auraState()).toBe('done')
    const stop = auraListen()
    expect(auraState()).toBe('listen')
    stop()
    expect(auraState()).toBe('idle')
  })
})
