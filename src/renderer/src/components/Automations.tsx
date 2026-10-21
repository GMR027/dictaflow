import { useEffect, useState } from 'react'
import type { Automation, StepType } from '@shared/automation'
import { useApp } from '../store'

const STEPS: { type: StepType; label: string; detail: string }[] = [
  { type: 'summary', label: 'Resumir', detail: 'Resume el texto con la IA.' },
  { type: 'notes', label: 'Convertir en notas', detail: 'Convierte el texto en notas estructuradas en Markdown.' },
  { type: 'minutes', label: 'Generar acta', detail: 'Genera el acta con resumen, decisiones y tareas.' },
  { type: 'pdf', label: 'Guardar como PDF', detail: 'Escribe el texto en un PDF.' },
  { type: 'note', label: 'Guardar como nota', detail: 'Guarda el texto como nota Markdown en tu carpeta de notas.' },
  { type: 'event', label: 'Crear evento', detail: 'Crea un evento en la agenda con el texto como descripción.' },
  { type: 'tts', label: 'Leer en voz alta', detail: 'Genera el audio del texto con la voz elegida.' }
]

/**
 * Automatizaciones: secuencias de pasos que se guardan y se vuelven a usar.
 * Se ejecutan como trabajo en segundo plano: se puede seguir con la aplicación
 * mientras terminan.
 */
export function Automations(): JSX.Element {
  const { settings, flash, notice } = useApp()
  const [list, setList] = useState<Automation[]>([])
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<StepType[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const refresh = (): void => void window.api.listAutomations().then(setList)
  useEffect(refresh, [])

  const add = (): void => {
    if (!name.trim() || !steps.length) return
    const a: Automation = { id: crypto.randomUUID(), name: name.trim(), steps: steps.map((type) => ({ type })), createdAt: Date.now() }
    void window.api.saveAutomation(a).then(() => { refresh(); setName(''); setSteps([]) })
  }

  const run = async (a: Automation): Promise<void> => {
    setError('')
    if (!text.trim()) { setError('Escribe o pega el texto que quieres automatizar.'); return }
    try {
      const job = await window.api.runAutomation(a.id, a.name, text, settings.primaryLang)
      flash(`Automatización en marcha: ${job.title}. Se puede cancelar desde la barra lateral.`)
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="view split">
      <section className="card side">
        <header><h2>⚙ Automatizaciones</h2></header>
        <div className="list">
          {list.length === 0 && <p className="muted">No hay automatizaciones. Crea una con los pasos de la derecha.</p>}
          {list.map((a) => (
            <div key={a.id} className="item pick">
              <b>{a.name}</b><br />
              <small className="muted">{a.steps.map((s) => STEPS.find((x) => x.type === s.type)?.label ?? s).join(' → ')}</small><br />
              <button className="link" onClick={() => void run(a)}>▶ Ejecutar</button>
              <button className="link" onClick={() => void window.api.removeAutomation(a.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card wide">
        {notice && <div className="notice" role="status">{notice}</div>}
        <h2>Nueva automatización</h2>
        <div className="row">
          <input className="grow" placeholder="Nombre (p. ej. «Acta de la reunión»)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={add} disabled={!name.trim() || !steps.length}>Guardar</button>
        </div>
        <p className="muted">Los pasos se ejecutan en orden. El resultado de cada paso con IA es la entrada del siguiente.</p>
        <div className="row">
          {STEPS.map((s) => (
            <button key={s.type} className={steps.includes(s.type) ? 'on' : ''} title={s.detail}
              onClick={() => setSteps((cur) => (cur.includes(s.type) ? cur.filter((x) => x !== s.type) : [...cur, s.type]))}>
              {s.label}
            </button>
          ))}
        </div>
        {steps.length > 0 && (
          <p className="muted">Orden: {steps.map((s) => STEPS.find((x) => x.type === s)?.label).join(' → ')}</p>
        )}

        <h2>Texto de entrada</h2>
        <textarea value={text} placeholder="Pega aquí el texto: una transcripción, el acta de una reunión, un capítulo…" onChange={(e) => setText(e.target.value)} />
        {error && <p className="warn" role="alert">{error}</p>}
      </section>
    </div>
  )
}
