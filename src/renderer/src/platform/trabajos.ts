// Android: cola de trabajos en segundo plano (audiolibros, automatizaciones).
//
// Mismas reglas que en escritorio (src/main/jobs/queue.ts): uno cada vez, se pueden cancelar, se
// guardan y, si la app se cerró a medias, vuelven a la cola al abrirla (los capítulos ya hechos de
// un audiolibro se saltan). Aquí corren en la interfaz y el trabajo pesado (voz, IA) lo hace Rust.
import type { Job } from '@shared/job'

/** Lo que recibe quien hace un trabajo: cómo avisar del progreso y cómo saber si debe parar. */
export interface JobCtx {
  job: Job
  report: (progress: number, detail: string) => void
  /** Lanza un error si el usuario canceló: se llama entre paso y paso. */
  check: () => void
}
export type Runner = (ctx: JobCtx) => Promise<string | void>

export class Cancelled extends Error {
  constructor() { super('Cancelado por el usuario.') }
}

export class JobQueue {
  private jobs: Job[] = []
  private running: Job | null = null
  private runners = new Map<string, Runner>()
  private listeners = new Set<(jobs: Job[]) => void>()
  private cancelled = new Set<string>()
  private loaded: Promise<void>

  constructor(private load: () => Promise<Job[]>, private store: (jobs: Job[]) => Promise<void>) {
    this.loaded = load().then((jobs) => {
      // Lo que estaba en marcha al cerrar la app vuelve a la cola.
      this.jobs = jobs.map((j) => (j.state === 'running' ? { ...j, state: 'queued', detail: 'Se reanuda al abrir la aplicación' } : j))
    }).catch(() => undefined)
  }

  register(kind: string, runner: Runner): void {
    this.runners.set(kind, runner)
  }

  /** Arranca lo que quedó en cola (cuando ya están registrados los tipos de trabajo). */
  start(): void {
    void this.loaded.then(() => this.pump())
  }

  onChange(cb: (jobs: Job[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async list(): Promise<Job[]> {
    await this.loaded
    return this.jobs.map((j) => ({ ...j }))
  }

  async enqueue(kind: string, title: string, payload?: Record<string, unknown>): Promise<Job> {
    await this.loaded
    const now = Date.now()
    const job: Job = { id: crypto.randomUUID(), kind, title, state: 'queued', progress: 0, detail: 'En cola', createdAt: now, updatedAt: now, payload }
    this.jobs = [job, ...this.jobs].slice(0, 50)
    this.changed()
    void this.pump()
    return { ...job }
  }

  async cancel(id: string): Promise<boolean> {
    await this.loaded
    const job = this.jobs.find((j) => j.id === id)
    if (!job || job.state === 'done' || job.state === 'cancelled' || job.state === 'failed') return false
    this.cancelled.add(id)
    Object.assign(job, { state: 'cancelled', detail: 'Cancelado', updatedAt: Date.now() })
    this.changed()
    return true
  }

  async clearFinished(): Promise<void> {
    await this.loaded
    this.jobs = this.jobs.filter((j) => j.state === 'queued' || j.state === 'running')
    this.changed()
  }

  private changed(save = true): void {
    if (save) void this.store(this.jobs).catch(() => undefined)
    const copy = this.jobs.map((j) => ({ ...j }))
    for (const l of this.listeners) l(copy)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const job = this.jobs.find((j) => j.state === 'queued')
    if (!job) return
    this.running = job
    const runner = this.runners.get(job.kind)
    Object.assign(job, { state: 'running', detail: 'Empezando', updatedAt: Date.now() })
    this.changed()
    const ctx: JobCtx = {
      job,
      report: (progress, detail) => {
        Object.assign(job, { progress: Math.max(0, Math.min(100, Math.round(progress))), detail, updatedAt: Date.now() })
        this.changed(false)
      },
      check: () => { if (this.cancelled.has(job.id)) throw new Cancelled() }
    }
    try {
      if (!runner) throw new Error(`No hay nadie que sepa hacer este tipo de trabajo: ${job.kind}`)
      const result = await runner(ctx)
      ctx.check()
      Object.assign(job, { state: 'done', progress: 100, detail: 'Hecho', result: result || undefined })
    } catch (e) {
      if (this.cancelled.has(job.id)) Object.assign(job, { state: 'cancelled', detail: 'Cancelado' })
      else Object.assign(job, { state: 'failed', detail: 'Falló', error: (e as Error).message })
    }
    this.cancelled.delete(job.id)
    this.running = null
    job.updatedAt = Date.now()
    this.changed()
    void this.pump()
  }
}
