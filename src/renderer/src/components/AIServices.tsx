import { useEffect, useState } from 'react'
import type { LLMKind, SecretName } from '@shared/types'
import { connectPatch, PROVIDERS, serviceStatus, type ProviderModels, type ServiceStatus } from '@shared/providers'
import { useApp } from '../store'
import { OllamaSetup } from './OllamaSetup'

const BADGE: Record<ServiceStatus, string> = { active: 'En uso', ready: 'Listo', 'needs-key': 'Falta la clave' }
const KINDS = Object.keys(PROVIDERS) as LLMKind[]

/** Agrupa los IDs `proveedor/modelo` por proveedor para el selector. */
function byProvider(models: string[]): [string, string[]][] {
  const map = new Map<string, string[]>()
  for (const id of models) {
    const p = id.split('/')[0]
    const list = map.get(p) ?? []
    list.push(id)
    map.set(p, list)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export function AIServices(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [keys, setKeys] = useState<Partial<Record<SecretName, boolean>>>({})
  const [keyInput, setKeyInput] = useState('')
  const [ollama, setOllama] = useState<string[]>([])
  const [ollamaState, setOllamaState] = useState({ installed: true, running: true })
  const [models, setModels] = useState<ProviderModels | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [test, setTest] = useState('')
  const [testing, setTesting] = useState(false)

  const active = settings.llm.kind
  const p = PROVIDERS[active]

  const refreshOllama = (): void => {
    void window.api.detectHardware().then(({ hw }) => {
      setOllama(hw.ollama.models)
      setOllamaState({ installed: hw.ollama.installed, running: hw.ollama.running })
    })
  }

  const loadModels = async (kind: LLMKind): Promise<void> => {
    setLoadingModels(true)
    setModels(null)
    try {
      setModels(await window.api.listModels(kind))
    } catch (e) {
      setModels({ bin: null, models: [], providers: [], error: (e as Error).message })
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    refreshOllama()
    for (const n of ['anthropic', 'openai-compat'] as SecretName[]) void window.api.hasSecret(n).then((v) => setKeys((k) => ({ ...k, [n]: v })))
  }, [])

  useEffect(() => {
    void loadModels(active)
    setTest('')
    setKeyInput('')
  }, [active])

  const choose = (kind: LLMKind): void => {
    if (kind === active) return
    void patchSettings(connectPatch(settings, kind))
  }
  const saveKey = async (): Promise<void> => {
    if (!p.secret) return
    await window.api.setSecret(p.secret, keyInput)
    setKeys((k) => ({ ...k, [p.secret!]: !!keyInput }))
    setKeyInput('')
  }
  const runTest = async (): Promise<void> => {
    setTesting(true); setTest('')
    try { setTest('✓ ' + (await window.api.testLLM())) } catch (e) { setTest('✗ ' + (e as Error).message) }
    setTesting(false)
  }

  const modelIds = models?.models ?? []
  const grouped = byProvider(modelIds)
  const invalidOpencode = active === 'opencode' && !!settings.llm.model && !modelIds.includes(settings.llm.model)

  return (
    <>
      <section className="card">
        <h2>Servicios de IA</h2>
        <p className="muted">Elige qué servicio redacta y traduce tus textos. Solo uno está en uso a la vez y puedes cambiarlo cuando quieras.</p>
        <div className="services" role="radiogroup" aria-label="Servicio de IA">
          {KINDS.map((k) => {
            const st = serviceStatus(k, active, keys)
            return (
              <button key={k} role="radio" aria-checked={k === active} className={`service ${k === active ? 'on' : ''}`} onClick={() => choose(k)}>
                <b>{PROVIDERS[k].label}</b>
                <span className="muted">{PROVIDERS[k].summary}</span>
                <span className={st === 'needs-key' ? 'warn' : st === 'active' ? 'ok' : 'muted'}>{BADGE[st]}{PROVIDERS[k].cloud ? ' · en la nube' : ' · local'}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card">
        <h2>{p.label}</h2>
        <p className="muted">{p.hint}</p>
        {active === 'ollama' && (
          <OllamaSetup installed={ollamaState.installed} running={ollamaState.running} onChanged={refreshOllama} />
        )}

        {models?.bin !== undefined && (active === 'opencode' || active === 'claude-cli') && (
          <p className={models.bin ? 'muted' : 'warn'}>
            {models.bin ? `CLI detectado: ${models.bin}` : 'CLI no encontrado en el PATH.'}
          </p>
        )}

        <label>Modelo
          {active === 'ollama' && ollama.length > 0 ? (
            <select value={settings.llm.model} onChange={(e) => void patchSettings({ llm: { ...settings.llm, model: e.target.value } })}>
              {!ollama.includes(settings.llm.model) && <option value={settings.llm.model}>{settings.llm.model} (no instalado)</option>}
              {ollama.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (active === 'opencode' || active === 'claude-cli') ? (
            <>
              <select
                value={settings.llm.model}
                disabled={loadingModels || !modelIds.length}
                onChange={(e) => void patchSettings({ llm: { ...settings.llm, model: e.target.value } })}
              >
                <option value="">{active === 'opencode' ? 'Predeterminado de opencode (recomendado)' : 'Predeterminado de Claude'}</option>
                {active === 'opencode'
                  ? grouped.map(([provider, list]) => (
                    <optgroup key={provider} label={provider}>
                      {list.map((id) => <option key={id} value={id}>{id.slice(provider.length + 1)}</option>)}
                    </optgroup>
                  ))
                  : modelIds.filter(Boolean).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <div className="row tight">
                <button onClick={() => void loadModels(active)} disabled={loadingModels}>
                  {loadingModels ? 'Cargando modelos…' : '↻ Actualizar modelos'}
                </button>
                {active === 'opencode' && models?.providers.length ? (
                  <span className="muted">{modelIds.length} modelos · {models.providers.join(', ')}</span>
                ) : null}
              </div>
              {models?.error && <span className="warn">{models.error}</span>}
              {invalidOpencode && (
                <span className="warn">
                  El modelo guardado no está en la lista de opencode.{' '}
                  <button className="link" onClick={() => void patchSettings({ llm: { ...settings.llm, model: '' } })}>Usar el predeterminado</button>
                </span>
              )}
            </>
          ) : (
            <>
              <input list="llm-models" value={settings.llm.model} placeholder={p.models ? 'Elige uno o escribe otro' : ''}
                onChange={(e) => void patchSettings({ llm: { ...settings.llm, model: e.target.value } })} />
              {p.models && <datalist id="llm-models">{p.models.filter(Boolean).map((m) => <option key={m} value={m} />)}</datalist>}
            </>
          )}
        </label>

        {(active === 'ollama' || active === 'openai-compat') && (
          <label>URL base
            <input value={settings.llm.baseUrl ?? ''} onChange={(e) => void patchSettings({ llm: { ...settings.llm, baseUrl: e.target.value } })} />
          </label>
        )}
        {p.secret && (
          <div className="row">
            <label className="grow">API key {keys[p.secret] && <span className="ok">· guardada cifrada</span>}
              <input type="password" value={keyInput} placeholder={keys[p.secret] ? '••••••••  (escribe para reemplazar)' : 'Pega tu clave'}
                onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" />
            </label>
            <button onClick={() => void saveKey()} disabled={!keyInput && !keys[p.secret]}>{keyInput ? 'Guardar' : 'Borrar clave'}</button>
          </div>
        )}
        <div className="row">
          <button className="primary" onClick={() => void runTest()} disabled={testing}>{testing ? 'Probando…' : 'Probar conexión'}</button>
          <span className={test.startsWith('✓') ? 'ok' : 'warn'}>{test}</span>
        </div>
      </section>
    </>
  )
}
