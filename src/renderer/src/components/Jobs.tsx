import { useEffect, useState } from 'react'
import type { Job } from '@shared/job'

/** Archivos que produjo un trabajo terminado (rutas propias de la app en Android). */
const outputs = (j: Job): string[] =>
  j.state === 'done' && window.api.platform === 'android' ? (j.result ?? '').split('\n').filter((r) => /^[a-z0-9._/-]+\.(mp3|pdf|md|wav)$/.test(r)) : []

/**
 * Trabajos en segundo plano: muestra el progreso y deja cancelarlos.
 * Los trabajos siguen aunque se cierre la ventana: los hace el proceso principal.
 */
export function Jobs(): JSX.Element | null {
  const [jobs, setJobs] = useState<Job[]>([])
  const [saved, setSaved] = useState('')
  useEffect(() => {
    void window.api.listJobs().then(setJobs)
    return window.api.onJobsChanged(setJobs)
  }, [])

  const vivos = jobs.filter((j) => j.state === 'queued' || j.state === 'running')
  const recientes = jobs.filter((j) => j.state !== 'queued' && j.state !== 'running').slice(0, 3)
  if (!vivos.length && !recientes.length) return null

  return (
    <div className="jobs">
      {vivos.map((j) => (
        <div key={j.id} className="job">
          <div className="row tight">
            <span className="grow"><b>{j.title}</b><br /><small className="muted">{j.detail}</small></span>
            <button className="link" onClick={() => void window.api.cancelJob(j.id)} title="Cancelar">✕</button>
          </div>
          <div className="bar"><div style={{ width: `${j.progress}%` }} /></div>
          <small className="muted">{j.progress}%</small>
        </div>
      ))}
      {recientes.map((j) => (
        <div key={j.id} className="job small">
          <small className={j.state === 'failed' ? 'warn' : 'muted'}>
            {j.state === 'done' ? '✓' : j.state === 'failed' ? '✗' : '—'} {j.title}
            {j.error ? `: ${j.error}` : ''}
          </small>
          {outputs(j).map((f) => (
            <button key={f} className="link" onClick={() => void window.api.exportFile(f).then((n) => setSaved(n ? `✓ Guardado: ${n}` : '')).catch((e) => setSaved(`✗ ${(e as Error).message}`))}>
              ⬇ Guardar {f.split('.').pop()!.toUpperCase()}
            </button>
          ))}
        </div>
      ))}
      {saved && <small className={saved.startsWith('✗') ? 'warn' : 'muted'}>{saved}</small>}
    </div>
  )
}
