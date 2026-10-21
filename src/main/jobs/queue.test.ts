import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobQueue } from './queue'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dfjobs-'))
  file = join(dir, 'jobs.json')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('JobQueue', () => {
  it('encola y ejecuta un trabajo', async () => {
    const q = new JobQueue(file)
    q.register('prueba', async (job) => ({ result: `hecho:${job.title}` }))
    const job = q.enqueue('prueba', 'Probar')
    await wait(50)
    const done = q.get(job.id)
    expect(done?.state).toBe('done')
    expect(done?.result).toBe('hecho:Probar')
    expect(done?.progress).toBe(100)
  })

  it('avisa del progreso', async () => {
    const q = new JobQueue(file)
    const detalles: string[] = []
    q.onChange((jobs) => { for (const j of jobs) detalles.push(j.detail) })
    q.register('prueba', async (_job, report) => {
      report(50, 'A mitad')
      return {}
    })
    const job = q.enqueue('prueba', 'Probar')
    await wait(50)
    expect(detalles).toContain('A mitad')
    expect(q.get(job.id)?.state).toBe('done')
  })

  it('un trabajo que falla no bloquea los siguientes', async () => {
    const q = new JobQueue(file)
    q.register('malo', async () => { throw new Error('se rompió') })
    q.register('bueno', async () => ({ result: 'ok' }))
    const malo = q.enqueue('malo', 'Malo')
    const bueno = q.enqueue('bueno', 'Bueno')
    await wait(80)
    expect(q.get(malo.id)?.state).toBe('failed')
    expect(q.get(malo.id)?.error).toBe('se rompió')
    expect(q.get(bueno.id)?.state).toBe('done')
  })

  it('cancelar un trabajo en cola lo marca como cancelado', async () => {
    const q = new JobQueue(file)
    let ejecutado = false
    q.register('lento', async () => { await wait(200); ejecutado = true; return {} })
    const job = q.enqueue('lento', 'Lento')
    expect(q.cancel(job.id)).toBe(true)
    await wait(50)
    expect(q.get(job.id)?.state).toBe('cancelled')
    expect(ejecutado).toBe(false)
  })

  it('un trabajo en marcha puede pedir que se cancele', async () => {
    const q = new JobQueue(file)
    let seCancelo = false
    q.register('lento', async (job, report) => {
      report(10, 'Empezando')
      for (let i = 0; i < 20; i++) {
        if (q.isCancelled(job.id)) { seCancelo = true; throw new Error('Cancelado por el usuario.') }
        await wait(10)
      }
      return {}
    })
    const job = q.enqueue('lento', 'Lento')
    await wait(30)
    q.cancel(job.id)
    await wait(120)
    expect(seCancelo).toBe(true)
    expect(q.get(job.id)?.state).toBe('cancelled')
  })

  it('los trabajos se guardan en disco y se recuperan al arrancar', async () => {
    const q = new JobQueue(file)
    q.register('prueba', async () => ({ result: 'ok' }))
    const job = q.enqueue('prueba', 'Guardado')
    await wait(50)
    // Una cola nueva lee lo que había en disco.
    const otra = new JobQueue(file)
    expect(otra.get(job.id)?.title).toBe('Guardado')
    expect(otra.get(job.id)?.state).toBe('done')
  })

  it('un trabajo que estaba en marcha vuelve a la cola al arrancar', async () => {
    const q = new JobQueue(file)
    const job = q.enqueue('prueba', 'A medias')
    // Se escribe a mano el estado «en marcha».
    const guardado = JSON.parse(readFileSync(file, 'utf8'))
    guardado[0].state = 'running'
    const { writeFileSync } = await import('fs')
    writeFileSync(file, JSON.stringify(guardado))
    const otra = new JobQueue(file)
    expect(otra.get(job.id)?.state).toBe('queued')
  })

  it('avisa a quien esté escuchando los cambios', async () => {
    const q = new JobQueue(file)
    const vistos: number[] = []
    q.onChange((jobs) => vistos.push(jobs.length))
    q.enqueue('prueba', 'Uno')
    await wait(50)
    expect(vistos.length).toBeGreaterThan(0)
  })
})
