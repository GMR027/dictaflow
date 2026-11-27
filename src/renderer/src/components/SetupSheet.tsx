// Modal único de complementos. Se abre desde una herramienta (o desde Ajustes) cuando
// falta un modelo, una voz o la IA. Desde aquí se descarga y se activa sin salir de la
// pantalla; al terminar, la acción que lo pidió continúa sola.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lang, LLMKind, SecretName } from '@shared/types'
import { formatBytes } from '@shared/local-models'
import { SERVICES, featureKey, serviceEnabled } from '@shared/features'
import { PROVIDERS, connectPatch } from '@shared/providers'
import { useApp } from '../store'
import { useSetup, type SetupRequest } from '../setup'
import { downloadPhoneLanguage } from '../phone-mic'
import { cancelInstall, installOption, useServices, whisperReady } from '../services'
import { Sheet } from './Sheet'
import { OllamaSetup } from './OllamaSetup'

const ANDROID = window.api.platform === 'android'

const ACTIVATE: Record<SetupRequest['service'], string> = {
  dictation: 'Activar el dictado por voz',
  ai: 'Activar la redacción con IA',
  tts: 'Activar la lectura en voz alta',
  live: 'Activar el texto en vivo'
}

/** Texto de la cabecera según lo que falta. */
function titleFor(req: SetupRequest, ready: boolean): string {
  if (req.phoneLang) return 'Preparar la voz del teléfono'
  if (ready && req.disabled) return ACTIVATE[req.service]
  if (req.service === 'tts') return 'Elegir una voz'
  if (req.service === 'dictation') return req.requireModel ? 'Preparar la transcripción' : 'Preparar el dictado'
  return req.service === 'ai' ? 'Preparar la redacción con IA' : 'Preparar el texto en vivo'
}

export function SetupSheet(): JSX.Element | null {
  const request = useSetup((s) => s.request)
  const finish = useSetup((s) => s.finish)
  const settings = useApp((s) => s.settings)
  const services = useServices()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ what: '', pct: 0 })
  const [error, setError] = useState('')
  const [phonePhase, setPhonePhase] = useState<'offer' | 'busy' | 'scheduled' | 'error'>('offer')
  const [phonePct, setPhonePct] = useState<number | null>(null)
  const phoneCancel = useRef(false)

  const lang: Lang = request?.lang ?? settings.primaryLang
  /** Opciones visibles: al transcribir archivos o reuniones no vale el motor del teléfono. */
  const visibleOptions = (service: SetupRequest['service'], l: Lang, requireModel?: boolean) => {
    const list = services.options(service, l)
    return service === 'dictation' && requireModel ? list.filter((o) => o.action.kind !== 'system-stt') : list
  }
  const options = useMemo(
    () => (request ? visibleOptions(request.service, lang, request.requireModel) : []),
    // `services` cambia al terminar una descarga; los ajustes, al elegir otro modelo o voz.
    [request, services.models, services.tts, services.phone, services.device, lang,
      settings.sttModel, settings.sttPhone, settings.ttsVoice, settings.features]
  )
  const ready = request
    ? request.requireModel ? whisperReady() : services.isReady(request.service, lang)
    : false
  const enabled = request ? serviceEnabled(settings, request.service) : true

  useEffect(() => {
    if (!request) return
    const list = visibleOptions(request.service, request.lang ?? settings.primaryLang, request.requireModel)
    const pick = list.find((o) => o.id === request.prefer)
      ?? list.find((o) => o.installed && o.recommended)
      ?? list.find((o) => o.recommended)
      ?? list.find((o) => o.installed)
      ?? list[0]
    setSelected(pick?.id ?? '')
    setError('')
    setBusy(false)
    setPhonePhase('offer')
    setPhonePct(null)
    phoneCancel.current = false
    void useServices.getState().refresh()
    // Solo al abrir una petición nueva; no al refrescar el estado de fondo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  // El estado de los modelos puede llegar después de abrir el modal: se elige una opción
  // válida en cuanto haya datos, sin dejar el botón principal deshabilitado.
  useEffect(() => {
    if (!request) return
    if (selected && options.some((o) => o.id === selected)) return
    const pick = options.find((o) => o.recommended) ?? options.find((o) => o.installed) ?? options[0]
    if (pick) setSelected(pick.id)
  }, [options, selected, request])

  if (!request) return null

  const info = SERVICES[request.service]
  const option = options.find((o) => o.id === selected)

  const activate = async (): Promise<void> => {
    const key = featureKey(request.service)
    if (!key) return finish(true)
    setError('')
    try {
      const now = useApp.getState().settings
      await useApp.getState().patchSettings({ features: { ...now.features, [key]: true } })
      finish(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const run = async (): Promise<void> => {
    if (!option) return
    setBusy(true)
    setError('')
    setProgress({ what: option.label, pct: option.action.kind === 'phone-lang' ? -1 : 0 })
    try {
      await installOption(option, (what, pct) => setProgress({ what, pct }), { keepPhone: request.requireModel })
      await useServices.getState().refresh()
      const listo = request.requireModel ? whisperReady() : useServices.getState().isReady(request.service, lang)
      if (listo) finish(true)
      else setError('La descarga terminó, pero el servicio todavía no está listo. Revisa el espacio libre e inténtalo otra vez.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runPhoneDownload = async (): Promise<void> => {
    const idioma = request.phoneLang
    if (!idioma) return
    if (useApp.getState().settings.strictOffline) {
      setPhonePhase('error')
      setError('Modo offline estricto: no se puede descargar el idioma.')
      return
    }
    const peticion = request
    phoneCancel.current = false
    setBusy(true)
    setError('')
    setPhonePhase('busy')
    setPhonePct(null)
    try {
      const resultado = await downloadPhoneLanguage(
        idioma,
        (pct) => { if (!phoneCancel.current) setPhonePct(pct) },
        () => phoneCancel.current
      )
      // Si el usuario cerró la ventana mientras tanto, no se toca la petición nueva.
      if (useSetup.getState().request !== peticion) return
      if (resultado === 'done') {
        await useServices.getState().refresh()
        finish(true)
      } else if (resultado === 'scheduled') {
        setPhonePhase('scheduled')
        setBusy(false)
      } else {
        setPhonePhase('error')
        setError('Android no completó la descarga. Puedes usar Whisper mientras tanto.')
        setBusy(false)
      }
    } catch (e) {
      if (useSetup.getState().request !== peticion) return
      setPhonePhase('error')
      setError((e as Error).message || 'Android no pudo descargar el idioma.')
      setBusy(false)
    }
  }

  const cancelPhoneDownload = (): void => {
    phoneCancel.current = true
    setBusy(false)
    finish(false)
  }

  if (request.phoneLang) {
    const nombre = request.phoneLang === 'en' ? 'inglés' : 'español'
    return (
      <Sheet title="Preparar la voz del teléfono" onClose={() => { if (!busy) finish(false) }}>
        <p className="muted setup-lead">
          Tu teléfono puede reconocer lo que dices sin conexión, pero le falta el idioma {nombre}.
          Android lo descargará una vez y después DictaFlow lo usará al instante, sin internet.
        </p>

        {phonePhase === 'offer' && (
          <>
            <p className="muted">
              La descarga la gestiona Android y puede pedirte confirmación. No se envía tu voz a internet.
              Si prefieres no descargarla ahora, DictaFlow usará Whisper.
            </p>
            <div className="row setup-actions">
              <button className="primary" onClick={() => void runPhoneDownload()}>Descargar y continuar</button>
              <button className="link" onClick={() => finish(false)}>Usar Whisper</button>
              <button className="link" onClick={() => finish(false)}>Ahora no</button>
            </div>
          </>
        )}

        {phonePhase === 'busy' && (
          <div className="setup-progress" role="status" aria-live="polite">
            <p>{phonePct == null ? `Android está descargando el idioma ${nombre}…` : `Descargando ${nombre}… ${phonePct}%`}</p>
            {phonePct == null ? <progress /> : <progress max={100} value={phonePct} />}
            <div className="row setup-actions">
              <button onClick={cancelPhoneDownload}>Seguir con Whisper</button>
            </div>
          </div>
        )}

        {phonePhase === 'scheduled' && (
          <>
            <p className="warn">
              Android descargará el idioma en segundo plano. Esta vez seguiremos con Whisper para que
              puedas usar la herramienta sin esperar.
            </p>
            <div className="row setup-actions">
              <button className="primary" onClick={() => finish(false)}>Continuar con Whisper</button>
            </div>
          </>
        )}

        {phonePhase === 'error' && (
          <>
            <p className="warn" role="alert">{error}</p>
            <div className="row setup-actions">
              <button className="primary" onClick={() => void runPhoneDownload()}>Reintentar</button>
              <button className="link" onClick={() => finish(false)}>Usar Whisper</button>
              <button className="link" onClick={() => finish(false)}>Ahora no</button>
            </div>
          </>
        )}

        {ANDROID && phonePhase !== 'error' && (
          <p className="muted">La descarga se guarda en el teléfono y no vuelve a pedirse.</p>
        )}
      </Sheet>
    )
  }

  const aiDesktop = request.service === 'ai' && !ANDROID
  const lead = request.service === 'dictation' && request.requireModel
    ? 'Para transcribir archivos, reuniones o audio sin el motor del teléfono hace falta Whisper. Se descarga una vez y funciona sin conexión.'
    : info.detail

  return (
    <Sheet title={titleFor(request, ready)} onClose={() => { if (!busy) finish(false) }}>
      <p className="muted setup-lead">{lead}</p>

      {ready && !enabled ? (
        <div className="setup-activate">
          <p><b>Ya está instalado y listo.</b> Solo falta activarlo para poder usarlo.</p>
          <div className="row">
            <button className="primary" onClick={() => void activate()}>{ACTIVATE[request.service]}</button>
            <button className="link" onClick={() => finish(false)}>Ahora no</button>
          </div>
        </div>
      ) : aiDesktop ? (
        <AiSetup onDone={() => finish(true)} onError={setError} />
      ) : (
        <>
          <p className="setup-question">Elige una opción. La recomendada funciona bien en {ANDROID ? 'este teléfono' : 'este equipo'}.</p>
          <div className="setup-options" role="radiogroup" aria-label={info.title}>
            {options.map((o) => (
              <label key={o.id} className={`rec setup-option ${o.id === selected ? 'sel' : ''}`}>
                <input type="radio" name="setup-option" checked={o.id === selected}
                  onChange={() => { setSelected(o.id); setError('') }} disabled={busy} />
                <span>
                  <b>{o.label}</b>
                  {o.recommended && <em className="ok"> · Recomendada</em>}
                  {o.installed && <em className="ok"> · lista</em>}
                  <br />
                  <small className="muted">{o.note}</small>
                  {o.sizeBytes > 0 && !o.installed && <small className="muted"> · {formatBytes(o.sizeBytes)}</small>}
                </span>
              </label>
            ))}
            {!options.length && <p className="warn">No hay opciones disponibles para este idioma.</p>}
          </div>

          {busy && (
            <div className="setup-progress" role="status" aria-live="polite">
              <p>{progress.what || 'Descargando'}… {progress.pct >= 0 ? `${progress.pct}%` : 'un momento…'}</p>
              <progress max={100} value={progress.pct >= 0 ? progress.pct : undefined} />
            </div>
          )}

          <div className="row setup-actions">
            <button className="primary" onClick={() => void run()} disabled={busy || !option}>
              {busy
                ? 'Descargando…'
                : option?.installed
                  ? 'Usar esta opción'
                  : option?.action.kind === 'phone-lang'
                    ? 'Descargar idioma y activar'
                    : option?.action.kind === 'stt-prepare'
                      ? 'Preparar Whisper'
                      : option && option.sizeBytes > 0
                        ? `Descargar y activar (${formatBytes(option.sizeBytes)})`
                        : 'Activar'}
            </button>
            {busy && option?.action.kind === 'model' && (
              <button onClick={() => cancelInstall(option)}>Cancelar descarga</button>
            )}
            <button className="link" onClick={() => finish(false)} disabled={busy}>Ahora no</button>
          </div>
          {ANDROID && <p className="muted">Usa Wi-Fi para descargas grandes. Si se interrumpe, puedes continuarla después.</p>}
          {request.service === 'tts' && (
            <button className="link" onClick={() => {
              void useApp.getState().patchSettings({ advancedUI: true })
              useApp.getState().setView('ajustes')
              finish(false)
            }}>Ver todas las voces en Ajustes avanzados</button>
          )}
        </>
      )}

      {error && <p className="warn" role="alert">{error}</p>}
    </Sheet>
  )
}

/** Configuración del escritorio: proveedores de IA sin entrar en los detalles técnicos. */
function AiSetup({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }): JSX.Element {
  const settings = useApp((s) => s.settings)
  const patchSettings = useApp((s) => s.patchSettings)
  const services = useServices()
  const [busy, setBusy] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [compatKey, setCompatKey] = useState('')
  const [url, setUrl] = useState(
    settings.llm.kind === 'openai-compat'
      ? (settings.llm.baseUrl ?? PROVIDERS['openai-compat'].defaultUrl ?? '')
      : (PROVIDERS['openai-compat'].defaultUrl ?? '')
  )
  const [ollamaModel, setOllamaModel] = useState('')

  const providers = services.aiProviders
  const provider = (kind: LLMKind) => providers.find((p) => p.kind === kind)
  const ollama = provider('ollama')
  const hw = services.hw

  useEffect(() => {
    void useServices.getState().loadAiProviders()
  }, [])

  useEffect(() => {
    if (!ollamaModel && ollama?.models?.length) {
      const preferred = settings.llm.model && ollama.models.includes(settings.llm.model) ? settings.llm.model : ollama.models[0]
      setOllamaModel(preferred)
    }
  }, [ollama, ollamaModel, settings.llm.model])

  const useIt = async (kind: LLMKind, extra: Partial<typeof settings.llm> = {}, secret?: { name: SecretName; value: string }): Promise<void> => {
    setBusy(kind)
    onError('')
    try {
      if (secret?.value.trim()) await window.api.setSecret(secret.name, secret.value.trim())
      const base = connectPatch(settings, kind)
      const now = useApp.getState().settings
      await patchSettings({
        ...base,
        llm: { ...base.llm, ...extra },
        features: { ...now.features, ai: true }
      })
      await useServices.getState().refresh()
      onDone()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const refreshProviders = (): void => {
    void useServices.getState().loadAiProviders()
    void useServices.getState().refresh()
  }

  return (
    <div className="setup-ai">
      <h3>En este equipo</h3>
      <div className="rec setup-provider">
        <span>
          <b>{PROVIDERS.ollama.label}</b><br />
          <small className={ollama?.ready ? 'ok' : 'muted'}>{ollama?.detail ?? 'Comprobando…'}</small>
          {ollama?.models && ollama.models.length > 0 && (
            <label>Modelo
              <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
        </span>
        {ollama?.ready
          ? <button className="primary" disabled={!!busy} onClick={() => void useIt('ollama', { model: ollamaModel || ollama.models?.[0] || '' })}>Usar</button>
          : null}
      </div>
      {!ollama?.ready && hw && (
        <OllamaSetup installed={hw.ollama.installed} running={hw.ollama.running} onChanged={refreshProviders} />
      )}
      {!ollama?.ready && ollama?.detail === 'En marcha, pero sin modelos descargados.' && (
        <p className="muted">Descarga un modelo desde el modo avanzado; después aparecerá aquí.</p>
      )}

      <h3>Con tu suscripción</h3>
      {(['claude-cli', 'opencode'] as LLMKind[]).map((kind) => {
        const p = provider(kind)
        return (
          <div key={kind} className="rec setup-provider">
            <span><b>{PROVIDERS[kind].label}</b><br /><small className={p?.ready ? 'ok' : 'muted'}>{p?.detail ?? 'Comprobando…'}</small></span>
            <button className={p?.ready ? 'primary' : ''} disabled={!p?.ready || !!busy} onClick={() => void useIt(kind)}>Usar</button>
          </div>
        )
      })}

      <h3>Con una clave</h3>
      <div className="rec setup-provider">
        <span>
          <b>{PROVIDERS.anthropic.label}</b><br />
          <small className={provider('anthropic')?.ready ? 'ok' : 'muted'}>{provider('anthropic')?.detail ?? 'Comprobando…'}</small>
          <label>Clave de Anthropic
            <input type="password" value={anthropicKey} placeholder="Pega tu clave" autoComplete="off" onChange={(e) => setAnthropicKey(e.target.value)} />
          </label>
        </span>
        <button className={provider('anthropic')?.ready && !anthropicKey ? 'primary' : ''}
          disabled={((!anthropicKey.trim() && !provider('anthropic')?.ready) || !!busy)}
          onClick={() => void useIt('anthropic', {}, { name: 'anthropic', value: anthropicKey })}>
          {anthropicKey.trim() ? 'Guardar y usar' : provider('anthropic')?.ready ? 'Usar' : 'Falta la clave'}
        </button>
      </div>

      <div className="rec setup-provider">
        <span>
          <b>{PROVIDERS['openai-compat'].label}</b><br />
          <small className={provider('openai-compat')?.ready ? 'ok' : 'muted'}>{provider('openai-compat')?.detail ?? 'Comprobando…'}</small>
          <label>URL base
            <input value={url} placeholder={PROVIDERS['openai-compat'].defaultUrl} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label>Clave
            <input type="password" value={compatKey} placeholder="Pega tu clave" autoComplete="off" onChange={(e) => setCompatKey(e.target.value)} />
          </label>
        </span>
        <button className="primary" disabled={(!compatKey.trim() && !provider('openai-compat')?.ready) || !url.trim() || !!busy}
          onClick={() => void useIt('openai-compat', { baseUrl: url.trim() }, { name: 'openai-compat', value: compatKey })}>
          Guardar y usar
        </button>
      </div>

      {busy && <p className="muted">Guardando…</p>}

      <button className="link" onClick={() => {
        void useApp.getState().patchSettings({ advancedUI: true })
        useApp.getState().setView('ajustes')
        useSetup.getState().finish(false)
      }}>Prefiero configurarlo a mano en Ajustes avanzados</button>
    </div>
  )
}
