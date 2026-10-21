// Cola de trabajos en segundo plano.
//
// Sirve para lo que tarda: convertir un libro en audio, exportar un
// documento largo. Los trabajos se guardan en disco, así que sobreviven a
// cerrar la aplicación y se pueden reanudar.
//
// Reglas:
//  - Un trabajo cada vez: las tareas largas (síntesis de voz) saturan la CPU.
//  - Se puede cancelar en cualquier momento.
//  - Al arrancar, los trabajos que estaban «en marcha» vuelven a la cola con
//    su punto de reanudación.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Job, JobState } from '@shared/job'
import { dataDir } from '../paths'

export type { Job, JobState }

type Runner = (job: Job, report: (progress: number, detail: string) => void) => Promise<JobResult | void>

/** Lo que devuelve un trabajo al terminar: el resultado y el punto de reanudación. */
export interface JobResult {
  result?: string
  resume?: Record<string, unknown>
}

const jobsFile = join(dataDir, 'jobs.json')
export class JobQueue {
  private jobs: Job[] = []
  private running: Job | null = null
  private runners = new Map<string, Runner>()
  private listeners = new Set<(jobs: Job[]) => void>()
  private cancelled = new Set<string>()
  private file: string

  constructor(file = jobsFile) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true })
    this.load()
  }

  /** Registra cómo se ejecuta un tipo de trabajo. */
  register(kind: string, runner: Runner): void {
    this.runners.set(kind, runner)
  }

  /** Suscribe a los cambios: la interfaz los refleja en pantalla. */
  onChange(cb: (jobs: Job[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  list(): Job[] {
    return this.jobs.map((j) => ({ ...j }))
  }

  get(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  /** Encola un trabajo y lo devuelve. */
  enqueue(kind: string, title: string, payload?: Record<string, unknown>, resume?: Record<string, unknown>): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      kind,
      title,
      state: 'queued',
      progress: 0,
      detail: 'En cola',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload,
      resume
    }
    this.jobs.unshift(job)
    this.trim()
    this.save()
    this.emit()
    void this.pump()
    return job
  }

  /** Cancela un trabajo. Si está en marcha, se le avisa para que pare. */
  cancel(id: string): boolean {
    const job = this.get(id)
    if (!job) return false
    if (job.state === 'done' || job.state === 'cancelled') return false
    this.cancelled.add(id)
    if (this.running?.id === id) {
      this.running.state = 'cancelled'
      this.running.detail = 'Cancelado'
      this.running.updatedAt = Date.now()
    } else {
      job.state = 'cancelled'
      job.detail = 'Cancelado'
      job.updatedAt = Date.now()
    }
    this.save()
    this.emit()
    return true
  }

  /** true si el trabajo pidió que se cancele. */
  isCancelled(id: string): boolean {
    return this.cancelled.has(id)
  }

  /** Marca el progreso de un trabajo en marcha. */
  report(id: string, progress: number, detail: string): void {
    const job = this.get(id)
    if (!job) return
    job.progress = Math.max(0, Math.min(100, Math.round(progress)))
    job.detail = detail
    job.updatedAt = Date.now()
    this.emit()
  }

  /** Guarda el punto de reanudación de un trabajo. */
  setResume(id: string, resume: Record<string, unknown>): void {
    const job = this.get(id)
    if (!job) return
    job.resume = { ...(job.resume ?? {}), ...resume }
    job.updatedAt = Date.now()
    this.save()
  }

  /** Borra los trabajos terminados de la lista. */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.state === 'queued' || j.state === 'running')
    this.save()
    this.emit()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const next = this.jobs.find((j) => j.state === 'queued')
    if (!next) return
    const runner = this.runners.get(next.kind)
    if (!runner) {
      next.state = 'failed'
      next.error = `No hay nadie que sepa hacer este tipo de trabajo: ${next.kind}`
      next.updatedAt = Date.now()
      this.save()
      this.emit()
      void this.pump()
      return
    }
    this.running = next
    next.state = 'running'
    next.detail = 'Empezando'
    next.updatedAt = Date.now()
    this.save()
    this.emit()
    try {
      const result = await runner(next, (p, d) => this.report(next.id, p, d))
      if (this.cancelled.has(next.id)) {
        next.state = 'cancelled'
        next.detail = 'Cancelado'
      } else {
        next.state = 'done'
        next.progress = 100
        next.detail = 'Hecho'
        if (result?.result) next.result = result.result
        if (result?.resume) next.resume = { ...(next.resume ?? {}), ...result.resume }
      }
    } catch (e) {
      // Si el usuario lo canceló, no es un fallo: es una cancelación.
      if (this.cancelled.has(next.id)) {
        next.state = 'cancelled'
        next.detail = 'Cancelado'
      } else {
        next.state = 'failed'
        next.error = (e as Error).message
        next.detail = 'Falló'
      }
    }
    this.cancelled.delete(next.id)
    this.running = null
    next.updatedAt = Date.now()
    this.save()
    this.emit()
    void this.pump()
  }

  private trim(): void {
    // Se conservan los 50 más recientes.
    if (this.jobs.length > 50) this.jobs = this.jobs.slice(0, 50)
  }

  private emit(): void {
    const copy = this.list()
    for (const l of this.listeners) l(copy)
  }

  private save(): void {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.jobs, null, 2), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch {
      /* si no se puede guardar, el trabajo sigue en memoria */
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const jobs = JSON.parse(readFileSync(this.file, 'utf8')) as Job[]
      this.jobs = jobs.map((j) => {
        // Un trabajo que estaba en marcha se devuelve a la cola: se puede reanudar.
        if (j.state === 'running') return { ...j, state: 'queued' as const, detail: 'Se reanuda al abrir la aplicación' }
        return j
      })
    } catch {
      this.jobs = []
    }
  }
}
