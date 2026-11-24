import { useEffect, useState } from 'react'
import type { Automation, StepType } from '@shared/automation'
import { ensureService } from '../services'
import { useApp } from '../store'

const STEPS: { type: StepType; icon: string; label: string; detail: string }[] = [
  { type: 'summary', icon: '📝', label: 'Resumir', detail: 'Resume el texto con la IA.' },
  { type: 'notes', icon: '🗒', label: 'Convertir en notas', detail: 'Convierte el texto en notas estructuradas en Markdown.' },
  { type: 'minutes', icon: '📋', label: 'Generar acta', detail: 'Genera el acta con resumen, decisiones y tareas.' },
  { type: 'pdf', icon: '📄', label: 'Guardar como PDF', detail: 'Escribe el texto en un PDF.' },
  { type: 'note', icon: '💾', label: 'Guardar como nota', detail: 'Guarda el texto como nota Markdown en tu carpeta de notas.' },
  { type: 'event', icon: '📅', label: 'Crear evento', detail: 'Crea un evento en la agenda con el texto como descripción.' },
  { type: 'tts', icon: '🔊', label: 'Leer en voz alta', detail: 'Genera el audio del texto con la voz elegida.' }
]
const step = (t: StepType): (typeof STEPS)[number] | undefined => STEPS.find((x) => x.type === t)

/** Plantillas para empezar: un toque y quedan listas para guardar. */
const TEMPLATES: { name: string; steps: StepType[] }[] = [
  { name: 'Acta de la reunión', steps: ['minutes', 'pdf'] },
  { name: 'Resumen a notas', steps: ['summary', 'note'] },
  { name: 'Escuchar un resumen', steps: ['summary', 'tts'] }
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
    void window.api.saveAutomation(a).then(() => { refresh(); setName(''); setSteps([]); flash(`⚙ Automatización guardada: ${a.name}`) })
  }

  const run = async (a: Automation): Promise<void> => {
    setError('')
    if (!text.trim()) { setError('Primero escribe o pega abajo el texto que quieres procesar.'); return }
    // Los pasos de IA y de voz piden su complemento desde el modal, sin salir de aquí.
    if (a.steps.some((s) => s.type === 'summary' || s.type === 'notes' || s.type === 'minutes') && !(await ensureService('ai'))) return
    if (a.steps.some((s) => s.type === 'tts') && !(await ensureService('tts', { lang: settings.primaryLang }))) return
    try {
      const job = await window.api.runAutomation(a.id, a.name, text, settings.primaryLang)
      flash(`Automatización en marcha: ${job.title}. Puedes seguir usando la app; el avance aparece en Trabajos.`)
    } catch (e) { setError((e as Error).message) }
  }

  const toggle = (t: StepType): void => setSteps((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  return (
    <div className="view automations">
      {notice && <div className="notice" role="status">{notice}</div>}

      <section className="card">
        <header><h2>⚙ Mis automatizaciones</h2></header>
        {list.length === 0 && <p className="muted">Aún no tienes ninguna. Crea una abajo o empieza con una plantilla.</p>}
        <div className="auto-list">
          {list.map((a) => (
            <div key={a.id} className="item auto-card">
              <div className="grow">
                <b>{a.name}</b>
                <div className="flow small-flow">
                  {a.steps.map((s, i) => <span key={i} className="flow-pill">{step(s.type)?.icon} {step(s.type)?.label ?? s.type}</span>)}
                </div>
              </div>
              <button className="primary" onClick={() => void run(a)}>▶ Ejecutar</button>
              <button className="link" onClick={() => void window.api.removeAutomation(a.id).then(refresh)} aria-label={`Quitar ${a.name}`}>quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Texto de entrada</h2>
        <p className="muted">Lo que procesará la automatización que ejecutes.</p>
        <textarea value={text} placeholder="Pega aquí el texto: una transcripción, el acta de una reunión, un capítulo…" onChange={(e) => setText(e.target.value)} />
        {error && <p className="warn" role="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>Nueva automatización</h2>
        <div className="chips scroll" aria-label="Plantillas">
          {TEMPLATES.map((t) => (
            <button key={t.name} className="chip" onClick={() => { setName(t.name); setSteps(t.steps) }}>✨ {t.name}</button>
          ))}
        </div>
        <div className="form-grid">
          <label className="full">Nombre
            <input placeholder="p. ej. «Acta de la reunión»" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <p className="muted">Toca los pasos en el orden en que quieres que ocurran. El resultado de cada paso con IA es la entrada del siguiente.</p>
        <div className="step-grid">
          {STEPS.map((s) => {
            const n = steps.indexOf(s.type)
            return (
              <button key={s.type} className={`step-tile ${n >= 0 ? 'on' : ''}`} onClick={() => toggle(s.type)} aria-pressed={n >= 0} title={s.detail}>
                <span className="step-tile-n" aria-hidden="true">{n >= 0 ? n + 1 : '+'}</span>
                <span>{s.icon} {s.label}</span>
                <small className="muted">{s.detail}</small>
              </button>
            )
          })}
        </div>
        {steps.length > 0 && (
          <div className="flow" aria-label="Orden de los pasos">
            {steps.map((t, i) => (
              <span key={t} className="flow-pill">{i + 1}. {step(t)?.icon} {step(t)?.label}</span>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="primary" onClick={add} disabled={!name.trim() || !steps.length}>💾 Guardar automatización</button>
          {steps.length > 0 && <button className="link" onClick={() => setSteps([])}>Vaciar pasos</button>}
        </div>
      </section>
    </div>
  )
}
