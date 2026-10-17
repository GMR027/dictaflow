import { useEffect, useState } from 'react'
import type { HardwareInfo, Lang, ModelRec } from '@shared/types'
import { useApp } from '../store'
import { Logo } from './Logo'
import { OllamaSetup } from './OllamaSetup'

const LANGS: Record<Lang, string> = { es: 'Español', en: 'English' }
const badge = { recommended: '★ Recomendado', ok: 'Compatible', slow: '⚠ Lento' } as const

export function Onboarding(): JSX.Element {
  const { settings, patchSettings, sttLoading } = useApp()
  const [step, setStep] = useState(0)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [recs, setRecs] = useState<ModelRec[]>([])
  const [pull, setPull] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refreshHw = (): Promise<void> =>
    window.api.detectHardware().then(({ hw, recs }) => {
      setHw(hw)
      setRecs(recs)
      return undefined
    })

  useEffect(() => {
    void window.api.detectHardware().then(({ hw, recs }) => {
      setHw(hw)
      setRecs(recs)
      const bestStt = recs.find((r) => r.kind === 'stt' && r.status === 'recommended')
      if (bestStt) void patchSettings({ sttModel: bestStt.id })
    })
    return window.api.onPullProgress((p) => setPull((x) => ({ ...x, [p.name]: `${p.status} ${p.pct ? p.pct + '%' : ''}` })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installed = (id: string): boolean => !!hw?.ollama.models.some((m) => m === id || m.startsWith(id + ':') || id.startsWith(m))

  const install = async (id: string): Promise<void> => {
    setPull((x) => ({ ...x, [id]: 'iniciando…' }))
    try {
      await window.api.pullOllama(id)
      const list = await window.api.listOllama()
      setHw((h) => (h ? { ...h, ollama: { ...list, installed: true } } : h))
      setPull((x) => ({ ...x, [id]: 'listo' }))
    } catch (e) {
      setPull((x) => ({ ...x, [id]: `error: ${(e as Error).message}` }))
    }
  }

  const finish = async (): Promise<void> => {
    setBusy(true)
    setMsg('Descargando el modelo de voz (solo la primera vez)…')
    try {
      await window.api.loadStt()
      await patchSettings({ onboarded: true })
    } catch (e) {
      setMsg(`No se pudo cargar el modelo de voz: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  const llmModels = hw?.ollama.models ?? []

  return (
    <div className="onboard">
      <div className="card wizard">
        <p className="muted">Paso {step + 1} de 3</p>
        {step === 0 && (
          <>
            <Logo size={64} active />
            <h1>Bienvenido a DictaFlow</h1>
            <p>Elige tus idiomas. Se usarán para el reconocimiento de voz, la redacción y la traducción.</p>
            <label>Idioma principal
              <select value={settings.primaryLang} onChange={(e) => void patchSettings({ primaryLang: e.target.value as Lang })}>
                {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Idioma secundario
              <select value={settings.secondaryLang ?? ''} onChange={(e) => void patchSettings({ secondaryLang: (e.target.value || null) as Lang | null })}>
                <option value="">Ninguno</option>
                {Object.entries(LANGS).filter(([k]) => k !== settings.primaryLang).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Tu equipo</h1>
            {!hw ? <p>Analizando…</p> : (
              <>
                <p className="muted">{hw.cpu} · {hw.cores} hilos · {hw.ramGB} GB RAM · {hw.gpu} · {hw.diskFreeGB} GB libres</p>
                <h3>Voz → texto (local)</h3>
                {recs.filter((r) => r.kind === 'stt').map((r) => (
                  <label key={r.id} className={`rec ${r.status}`}>
                    <input type="radio" name="stt" checked={settings.sttModel === r.id} onChange={() => void patchSettings({ sttModel: r.id })} />
                    <span><b>{r.label}</b> <small>{r.sizeMB} MB</small><br /><small>{r.note}</small></span>
                    <em>{badge[r.status]}</em>
                  </label>
                ))}
                <h3>Redacción con IA (local, Ollama)</h3>
                <OllamaSetup installed={hw.ollama.installed} running={hw.ollama.running} onChanged={() => void refreshHw()} />
                {llmModels.map((m) => (
                  <label key={m} className="rec ok">
                    <input type="radio" name="llm" checked={settings.llm.model === m && settings.llm.kind === 'ollama'}
                      onChange={() => void patchSettings({ llm: { ...settings.llm, kind: 'ollama', model: m } })} />
                    <span><b>{m}</b> <small>instalado</small></span>
                  </label>
                ))}
                {hw.ollama.running && recs.filter((r) => r.kind === 'llm' && !installed(r.id)).map((r) => (
                  <div key={r.id} className={`rec ${r.status}`}>
                    <span><b>{r.label}</b> <small>{r.sizeMB} MB · {r.note}</small></span>
                    <em>{badge[r.status]}</em>
                    <button onClick={() => void install(r.id)} disabled={!!pull[r.id] && !pull[r.id].startsWith('error')}>
                      {pull[r.id] ?? 'Instalar'}
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <h1>Todo listo</h1>
            <p>Se descargará el modelo de voz y se guardará en tu equipo. Después la transcripción funciona sin conexión.</p>
            <p className="muted">Si tienes suscripciones (Claude, opencode…) las activas luego en Ajustes → Cuentas.</p>
            {busy && <p>{msg} {sttLoading}</p>}
            {!busy && msg && <p className="warn">{msg}</p>}
          </>
        )}
        <div className="row end">
          {step > 0 && <button onClick={() => setStep(step - 1)} disabled={busy}>Atrás</button>}
          {step < 2
            ? <button className="primary" onClick={() => setStep(step + 1)}>Siguiente</button>
            : <button className="primary" onClick={() => void finish()} disabled={busy}>Empezar</button>}
        </div>
      </div>
    </div>
  )
}
