import { describe, expect, it, vi } from 'vitest'
import { takeNext, withRetry, type Pending } from './meeting-queue'

const sec = (n: number, speaker?: string, start = 0): Pending => ({ pcm: new Float32Array(16000 * n).fill(0.1), start, speaker })

describe('takeNext', () => {
  it('con poca cola saca las frases una a una', () => {
    const q = [sec(2), sec(3)]
    expect(takeNext(q)!.pcm.length).toBe(32000)
    expect(q.length).toBe(1)
  })
  it('con atraso junta frases del mismo hablante hasta el máximo', () => {
    const q = [sec(5, 'Yo', 0), sec(5, 'Yo', 6), sec(5, 'Yo', 12), sec(20, 'Yo', 18)]
    const b = takeNext(q)!
    expect(b.start).toBe(0)
    expect(b.pcm.length).toBe(16000 * 15 + 2 * 4800)
    expect(q.length).toBe(1)
  })
  it('no mezcla hablantes distintos', () => {
    const q = [sec(2, 'Yo'), sec(2, 'Sistema'), sec(2, 'Yo')]
    expect(takeNext(q)!.pcm.length).toBe(32000)
    expect(q.length).toBe(2)
  })
})

describe('withRetry', () => {
  it('reintenta una vez', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    const p = withRetry(fn, 10)
    await vi.advanceTimersByTimeAsync(10)
    expect(await p).toBe('ok')
    vi.useRealTimers()
  })
})
