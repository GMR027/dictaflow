import { describe, expect, it } from 'vitest'
import { PriorityQueue } from './stt-queue'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Promesa que se resuelve a mano. */
function defer<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('PriorityQueue', () => {
  it('ejecuta un trabajo cada vez, nunca dos a la vez', async () => {
    const q = new PriorityQueue<string>()
    let concurrent = 0
    let maxConcurrent = 0
    const job = async (): Promise<string> => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await wait(20)
      concurrent--
      return 'ok'
    }
    await Promise.all([q.enqueue({ id: 1, priority: 'final', exec: job }), q.enqueue({ id: 2, priority: 'final', exec: job })])
    expect(maxConcurrent).toBe(1)
  })

  it('la definitiva no espera a los borradores en cola', async () => {
    const q = new PriorityQueue<string>()
    const order: string[] = []
    const bloquea = defer<void>()
    // Un trabajo largo ocupa el motor.
    const primero = q.enqueue({ id: 1, priority: 'draft', exec: async () => { await bloquea.promise; order.push('lento'); return 'lento' } })
    const borrador = q.enqueue({ id: 2, priority: 'draft', exec: async () => { order.push('borrador'); return 'borrador' } })
    const definitiva = q.enqueue({ id: 3, priority: 'final', exec: async () => { order.push('definitiva'); return 'definitiva' } })
    bloquea.resolve()
    const results = await Promise.allSettled([primero, borrador, definitiva])
    // El borrador se descarta porque la definitiva transcribe el mismo audio.
    expect(order).toEqual(['lento', 'definitiva'])
    expect(results[1].status).toBe('rejected')
    expect(results[2].status).toBe('fulfilled')
    expect((results[2] as PromiseFulfilledResult<{ value: string }>).value.value).toBe('definitiva')
  })

  it('descarta los borradores en cola cuando llega la definitiva', async () => {
    const q = new PriorityQueue<string>()
    const bloquea = defer<void>()
    const orden: string[] = []
    const primero = q.enqueue({ id: 1, priority: 'draft', exec: async () => { await bloquea.promise; return 'lento' } })
    const borrador1 = q.enqueue({ id: 2, priority: 'draft', exec: async () => { orden.push('borrador1'); return 'b1' } })
    const borrador2 = q.enqueue({ id: 3, priority: 'draft', exec: async () => { orden.push('borrador2'); return 'b2' } })
    const definitiva = q.enqueue({ id: 4, priority: 'final', exec: async () => { orden.push('definitiva'); return 'd' } })
    bloquea.resolve()
    await primero
    await definitiva
    // Los borradores ya no sirven: su resultado se descarta y no se ejecutan.
    const results = await Promise.allSettled([borrador1, borrador2])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(orden).toEqual(['definitiva'])
  })

  it('propaga el error del trabajo', async () => {
    const q = new PriorityQueue<string>()
    await expect(q.enqueue({ id: 1, priority: 'final', exec: async () => { throw new Error('se rompió') } })).rejects.toThrow('se rompió')
  })

  it('sigue funcionando después de un error', async () => {
    const q = new PriorityQueue<string>()
    await expect(q.enqueue({ id: 1, priority: 'final', exec: async () => { throw new Error('x') } })).rejects.toThrow()
    const r = await q.enqueue({ id: 2, priority: 'final', exec: async () => 'bien' })
    expect(r.value).toBe('bien')
  })

  it('mide el tiempo de ejecución', async () => {
    const q = new PriorityQueue<string>()
    const r = await q.enqueue({ id: 1, priority: 'final', exec: async () => { await wait(30); return 'ok' } })
    expect(r.ms).toBeGreaterThanOrEqual(20)
  })
})
