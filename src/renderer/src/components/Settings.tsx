import { useEffect, useState } from 'react'
import type { DictEntry, Lang, LLMKind, SecretName } from '@shared/types'
import { useApp } from '../store'
import { OllamaSetup } from './OllamaSetup'
import { useTtsStatus } from './TtsSetup'

const PROVIDERS: Record<LLMKind, { label: string; hint: string; secret?: SecretName; defaultModel: string; defaultUrl?: string }> = {
  ollama: { label: 'Ollama (local)', hint: 'Modelo local, sin enviar datos fuera.', defaultModel: 'qwen2.5:7b', defaultUrl: 'http://127.0.0.1:11434' },
  anthropic: { label: 'Claude (API key)', hint: 'Usa tu API key de Anthropic. El texto se envía a Anthropic.', secret: 'anthropic', defaultModel: 'claude-sonnet-5-5' },
  'claude-cli': { label: 'Claude (CLI con tu suscripción)', hint: 'Ejecuta el comando `claude` ya iniciado en tu equipo, sin herramientas ni acceso a archivos.', defaultModel: '' },
  opencode: { label: 'opencode (CLI)', hint: 'Usa el modelo configurado en tu opencode. Formato: proveedor/modelo (opcional).', defaultModel: '' },
  'openai-compat': { label: 'Compatible con OpenAI', hint: 'LM Studio, OpenRouter, etc. Indica la URL base y la clave.', secret: 'openai-compat', defaultModel: '', defaultUrl: 'http://127.0.0.1:1234/v1' }
}

export function Settings(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [keyInput, setKeyInput] = useState('')
  const [ollama, setOllama] = useState<string[]>([])
  const [ollamaState, setOllamaState] = useState({ installed: true, running: true })
  const [test, setTest] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [cmd, setCmd] = useState('')

  const p = PROVIDERS[settings.llm.kind]
  const [tts, refreshTts] = useTtsStatus()
  const [audioKey, setAudioKey] = useState('')
  const [newFrom, setNewFrom] = useState('')
  const [newTo, setNewTo] = useState('')
  const [dlBusy, setDlBusy] = useState('')
  const [dlMsg, setDlMsg] = useState('')
  const dict = settings.dictionary
  const [un, setUn] = useState<{ kind: string; command: string; runnable: boolean; dataPaths: string[]; dataSizeMB: number } | null>(null)
  const [wipe, setWipe] = useState(false)
  const [unErr, setUnErr] = useState('')
  useEffect(() => { void window.api.uninstallInfo().then(setUn) }, [])
  const KIND: Record<string, string> = { deb: 'paquete .deb', rpm: 'paquete .rpm', pacman: 'paquete de Arch', appimage: 'AppImage', portable: 'versión portable (.tar.gz)', dev: 'versión de desarrollo' }
  const doUninstall = async (): Promise<void> => {
    setUnErr('')
    try { await window.api.uninstall(wipe) } catch (e) { setUnErr((e as Error).message) }
  }

  const setDict = (d: DictEntry[]): void => void patchSettings({ dictionary: d })
  const addEntry = (): void => {
    if (!newFrom.trim() && !newTo.trim()) return
    setDict([...dict, { from: newFrom.trim(), to: newTo.trim() }]); setNewFrom(''); setNewTo('')
  }
  const importDict = async (f: File | undefined): Promise<void> => {
    if (!f) return
    const rows = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l): DictEntry => {
      const [a, b] = l.split(/[,;\t]/).map((x) => x.trim())
      return b ? { from: a, to: b } : { from: '', to: a }
    })
    setDict([...dict, ...rows])
  }
  const saveAudioKey = async (): Promise<void> => {
    await window.api.setSecret('openai-audio', audioKey)
    setKeys((k) => ({ ...k, 'openai-audio': !!audioKey })); setAudioKey('')
  }
  const getVoice = async (id: string): Promise<void> => {
    setDlBusy(id); setDlMsg('')
    const off = window.api.onTtsProgress((x) => setDlMsg(`${x.what} ${x.pct}%`))
    try {
      if (!tts?.piperInstalled) await window.api.installPiper()
      await window.api.installVoice(id)
      refreshTts()
    } catch (e) { setDlMsg((e as Error).message) } finally { off(); setDlBusy('') }
  }

  const refreshOllama = (): void => {
    void window.api.detectHardware().then(({ hw }) => {
      setOllama(hw.ollama.models)
      setOllamaState({ installed: hw.ollama.installed, running: hw.ollama.running })
    })
  }

  useEffect(() => {
    refreshOllama()
    void window.api.launchCmd().then(setCmd)
    for (const n of ['anthropic', 'openai-compat', 'openai-audio'] as SecretName[]) void window.api.hasSecret(n).then((v) => setKeys((k) => ({ ...k, [n]: v })))
  }, [])

  const setKind = (kind: LLMKind): void => {
    const d = PROVIDERS[kind]
    const enabled = Array.from(new Set([...settings.enabledProviders, kind]))
    void patchSettings({ enabledProviders: enabled, llm: { kind, model: d.defaultModel, baseUrl: d.defaultUrl } })
    setTest('')
  }
  const saveKey = async (): Promise<void> => {
    if (!p.secret) return
    await window.api.setSecret(p.secret, keyInput)
    setKeys((k) => ({ ...k, [p.secret!]: !!keyInput }))
    setKeyInput('')
  }
  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest('')
    try { setTest('✓ ' + (await window.api.testLLM())) } catch (e) { setTest('✗ ' + (e as Error).message) }
    setTesting(false)
  }

  return (
    <div className="view">
      <section className="card">
        <h2>Idiomas</h2>
        <div className="row">
          <label>Principal
            <select value={settings.primaryLang} onChange={(e) => void patchSettings({ primaryLang: e.target.value as Lang })}>
              <option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
          <label>Secundario
            <select value={settings.secondaryLang ?? ''} onChange={(e) => void patchSettings({ secondaryLang: (e.target.value || null) as Lang | null })}>
              <option value="">Ninguno</option><option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Cuentas y servicios (redacción con IA)</h2>
        <label>Proveedor activo
          <select value={settings.llm.kind} onChange={(e) => setKind(e.target.value as LLMKind)}>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <p className="muted">{p.hint}</p>
        {settings.llm.kind === 'ollama' && (
          <OllamaSetup installed={ollamaState.installed} running={ollamaState.running} onChanged={refreshOllama} />
        )}
        <label>Modelo
          {settings.llm.kind === 'ollama' && ollama.length > 0 ? (
            <select value={settings.llm.model} onChange={(e) => void patchSettings({ llm: { ...settings.llm, model: e.target.value } })}>
              {!ollama.includes(settings.llm.model) && <option value={settings.llm.model}>{settings.llm.model} (no instalado)</option>}
              {ollama.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={settings.llm.model} onChange={(e) => void patchSettings({ llm: { ...settings.llm, model: e.target.value } })} />
          )}
        </label>
        {(settings.llm.kind === 'ollama' || settings.llm.kind === 'openai-compat') && (
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
          <button onClick={() => void runTest()} disabled={testing}>{testing ? 'Probando…' : 'Probar conexión'}</button>
          <span className={test.startsWith('✓') ? 'ok' : 'warn'}>{test}</span>
        </div>
      </section>


      <section className="card">
        <h2>Diccionario personal</h2>
        <p className="muted">Corrige lo que Whisper escucha mal (nombres, términos técnicos) y se lo indica a la IA para respetarlos. Deja «Escribir como» para solo fijar un término.</p>
        <div className="row">
          <input placeholder="Se transcribe como…" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
          <input placeholder="Escribir como…" value={newTo} onChange={(e) => setNewTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntry()} />
          <button onClick={addEntry}>Añadir</button>
          <label className="btn">Importar .txt/.csv<input type="file" accept=".txt,.csv" hidden onChange={(e) => { void importDict(e.target.files?.[0]); e.target.value = '' }} /></label>
        </div>
        {dict.length > 0 && (
          <table>
            <thead><tr><th>Transcribe</th><th>Escribir</th><th /></tr></thead>
            <tbody>{dict.map((d, i) => (
              <tr key={i}><td>{d.from || <span className="muted">(solo término)</span>}</td><td>{d.to}</td>
                <td><button className="link" onClick={() => setDict(dict.filter((_, j) => j !== i))}>quitar</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Comandos de voz</h2>
        <label className="inline check"><input type="checkbox" checked={settings.voiceCommands} onChange={(e) => void patchSettings({ voiceCommands: e.target.checked })} /> Activar comandos de voz</label>
        <p className="muted">Solo se ejecutan cuando una frase es exactamente un comando (puedes anteponer «Flow»): «borra eso», «nuevo párrafo», «nueva línea», «copia», «rehaz», «redacta», «hazlo más formal / corto / casual», «conviértelo en prompt», «guarda este prompt», «pausa».</p>
      </section>

      <section className="card">
        <h2>Audio: voz a texto y texto a voz</h2>
        <div className="row">
          <label>Voz → texto
            <select value={settings.sttProvider} onChange={(e) => void patchSettings({ sttProvider: e.target.value as 'local' | 'openai' })}>
              <option value="local">Local (Whisper)</option><option value="openai">Nube (compatible con OpenAI)</option>
            </select>
          </label>
          <label>Texto → voz
            <select value={settings.ttsProvider} onChange={(e) => void patchSettings({ ttsProvider: e.target.value as 'piper' | 'openai' })}>
              <option value="piper">Local (Piper)</option><option value="openai">Nube (compatible con OpenAI)</option>
            </select>
          </label>
        </div>
        {(settings.sttProvider === 'openai' || settings.ttsProvider === 'openai') && (
          <>
            <p className="warn">Con la nube, el audio o el texto se envía a ese servicio. La barra lateral lo indicará.</p>
            <label>URL base<input value={settings.cloudAudio.baseUrl} onChange={(e) => void patchSettings({ cloudAudio: { ...settings.cloudAudio, baseUrl: e.target.value } })} /></label>
            <div className="row">
              <label>Modelo STT<input value={settings.cloudAudio.sttModel} onChange={(e) => void patchSettings({ cloudAudio: { ...settings.cloudAudio, sttModel: e.target.value } })} /></label>
              <label>Modelo TTS<input value={settings.cloudAudio.ttsModel} onChange={(e) => void patchSettings({ cloudAudio: { ...settings.cloudAudio, ttsModel: e.target.value } })} /></label>
              <label>Voz TTS<input value={settings.cloudAudio.ttsVoice} onChange={(e) => void patchSettings({ cloudAudio: { ...settings.cloudAudio, ttsVoice: e.target.value } })} /></label>
            </div>
            <div className="row">
              <label className="grow">API key {keys['openai-audio'] && <span className="ok">· guardada cifrada</span>}
                <input type="password" value={audioKey} autoComplete="off" placeholder={keys['openai-audio'] ? '••••••••' : 'Pega tu clave'} onChange={(e) => setAudioKey(e.target.value)} />
              </label>
              <button onClick={() => void saveAudioKey()} disabled={!audioKey && !keys['openai-audio']}>{audioKey ? 'Guardar' : 'Borrar clave'}</button>
            </div>
          </>
        )}
        <h3>Voces locales (Piper)</h3>
        {tts?.catalog.map((v) => (
          <div key={v.id} className="rec ok">
            <span><b>{v.label}</b> <small>~{v.sizeMB} MB</small></span>
            {tts.voices.includes(v.id) ? <em className="ok">✓ instalada</em> : (
              <button onClick={() => void getVoice(v.id)} disabled={!!dlBusy}>{dlBusy === v.id ? `Descargando… ${dlMsg}` : 'Descargar'}</button>
            )}
          </div>
        ))}
        {dlMsg && !dlBusy && <p className="warn">{dlMsg}</p>}
      </section>

      <section className="card">
        <h2>Notas (Obsidian, Logseq, Markdown)</h2>
        <p className="muted">Los botones «A notas» guardan archivos .md con metadatos en esta carpeta.</p>
        <div className="row">
          <input className="grow" readOnly value={settings.vaultDir || '~/Documentos/DictaFlow-Notas (por defecto)'} />
          <button onClick={() => void window.api.pickVault().then(async (d) => { if (d) await patchSettings({ vaultDir: d }) })}>Elegir carpeta…</button>
        </div>
      </section>

      <section className="card">
        <h2>Dictar en cualquier app</h2>
        <p>Funciona con un atajo de teclado que registras tú en GNOME, sin dar permisos especiales a la app:</p>
        <ol>
          <li>Abre <b>Configuración → Teclado → Atajos personalizados → Añadir</b>.</li>
          <li>Nombre: <code>DictaFlow dictar</code>. Atajo: por ejemplo <code>Super+Alt+D</code>.</li>
          <li>Comando (cópialo con el botón):</li>
        </ol>
        <div className="row">
          <code className="cmd">{cmd}</code>
          <button onClick={() => void window.api.copy(cmd)}>Copiar comando</button>
        </div>
        <p className="muted">Pulsa el atajo para empezar a grabar, púlsalo otra vez para terminar: el texto redactado queda en el portapapeles y lo pegas con Ctrl+V. En Wayland ninguna app puede escribir en otra sin permisos elevados, por eso se pega manualmente.</p>
      </section>

      <section className="card">
        <h2>Desinstalar</h2>
        {un && (
          <>
            <p className="muted">Instalación detectada: <b>{KIND[un.kind] ?? un.kind}</b>. Comando para desinstalar la aplicación:</p>
            <div className="row">
              <code className="cmd">{un.command}</code>
              <button onClick={() => void window.api.copy(un.command)}>Copiar comando</button>
            </div>
            <label className="inline check">
              <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
              Borrar también mis datos ({un.dataSizeMB} MB: modelos, voces, ajustes, biblioteca y reuniones)
            </label>
            <div className="row">
              <button className="danger" onClick={() => void doUninstall()} disabled={!un.runnable && !wipe}>
                {un.runnable ? '🗑 Desinstalar aplicación' : '🗑 Borrar solo mis datos'}
              </button>
              {!un.runnable && <span className="muted">Esta instalación no se quita desde la app: usa el comando.</span>}
            </div>
            {unErr && <p className="warn" role="alert">{unErr}</p>}
            <p className="muted">Siempre se pide confirmación antes de borrar nada. Los archivos que hayas exportado (notas, audios) no se tocan.</p>
          </>
        )}
      </section>
    </div>
  )
}
