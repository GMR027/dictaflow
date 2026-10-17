import { useEffect, useState } from 'react'

interface Props {
  installed: boolean
  running: boolean
  /** se llama al terminar para que el padre vuelva a consultar el estado de Ollama */
  onChanged: () => void
}

export function OllamaSetup({ installed, running, onChanged }: Props): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => window.api.onInstallLog((l) => setLog((x) => [...x.slice(-40), l])), [])

  if (running) return null

  const run = async (action: 'install' | 'start'): Promise<void> => {
    setBusy(true)
    setError('')
    setLog([])
    try {
      if (action === 'install') {
        if ((await window.api.installOllama()) === 'cancelled') return
      } else if (!(await window.api.startOllama())) {
        throw new Error('No se pudo iniciar Ollama.')
      }
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <p className="warn">
        {installed ? 'Ollama está instalado pero no está en ejecución.' : 'Ollama no está instalado: es el motor para usar modelos de IA locales.'}
      </p>
      <div className="row">
        {installed
          ? <button className="primary" onClick={() => void run('start')} disabled={busy}>{busy ? 'Iniciando…' : 'Iniciar Ollama'}</button>
          : <button className="primary" onClick={() => void run('install')} disabled={busy}>{busy ? 'Instalando…' : '⬇ Instalar Ollama'}</button>}
        <span className="muted">Opcional: también puedes usar una suscripción en Ajustes.</span>
      </div>
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
  )
}
