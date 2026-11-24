// Primer arranque: preparar lo esencial sin mostrar el catálogo técnico de modelos.
// El dictado y la voz suelen funcionar sin descargas (motor y voces del teléfono); la
// redacción con IA es opcional y se puede añadir después desde Ajustes o al usarla.
import { useEffect, useState } from 'react'
import { formatBytes } from '@shared/local-models'
import type { Lang } from '@shared/types'
import { installOption, useServices } from '../services'
import { useSetup } from '../setup'
import { useApp } from '../store'

const ANDROID = window.api.platform === 'android'

export function OnboardingSetup({ onDone, onBack }: { onDone: (prepared: boolean) => void; onBack: () => void }): JSX.Element {
  const settings = useApp((s) => s.settings)
  const patchSettings = useApp((s) => s.patchSettings)
  const services = useServices()
  const [dictId, setDictId] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [withAi, setWithAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { void useServices.getState().refresh() }, [])

  const lang: Lang = settings.primaryLang
  const dictOptions = services.options('dictation')
  const voiceOptions = services.options('tts', lang)
  const aiOptions = services.options('ai')
  const aiOption = aiOptions.find((o) => o.recommended && o.installed)
    ?? aiOptions.find((o) => o.recommended)
    ?? aiOptions[0]

  useEffect(() => {
    if (!services.loaded) return
    const opts = useServices.getState().options('dictation')
    setDictId((prev) => prev || (opts.find((o) => o.installed && o.recommended) ?? opts.find((o) => o.installed) ?? opts.find((o) => o.recommended) ?? opts[0])?.id || '')
  }, [services.loaded])

  useEffect(() => {
    if (!services.loaded) return
    const opts = useServices.getState().options('tts', lang)
    setVoiceId((opts.find((o) => o.installed && o.recommended) ?? opts.find((o) => o.installed) ?? opts.find((o) => o.recommended) ?? opts[0])?.id || '')
  }, [services.loaded, lang])

  const dict = dictOptions.find((o) => o.id === dictId)
  const voice = voiceOptions.find((o) => o.id === voiceId)
  const aiReady = services.isReady('ai')
  const selected = [dict, voice, withAi ? aiOption : undefined].filter((x): x is NonNullable<typeof x> => !!x)
  const pendingBytes = selected.reduce((n, o) => n + (o.installed ? 0 : o.sizeBytes), 0)
  const needsPrepare = selected.some((o) => !o.installed && o.action.kind === 'stt-prepare')

  const run = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      if (dict) {
        setProgress('Preparando el dictado…')
        await installOption(dict, (what, pct) => setProgress(`${what} ${pct}%`))
      }
      if (voice) {
        setProgress('Preparando la voz…')
        await installOption(voice, (what, pct) => setProgress(`${what} ${pct}%`))
      }
      if (withAi && aiOption) {
        setProgress('Descargando la redacción con IA…')
        await installOption(aiOption, (what, pct) => setProgress(`${what} ${pct}%`))
      }
      // Si no se elige IA o no se prepara la voz, se dejan desactivadas para no mostrar
      // «falta descargar» nada más entrar. Se pueden activar luego desde Ajustes.
      const now = useApp.getState().settings
      const servicesNow = useServices.getState()
      await patchSettings({
        features: {
          ...now.features,
          ai: ANDROID ? withAi && servicesNow.isReady('ai') : servicesNow.isReady('ai'),
          tts: !!voice && servicesNow.isReady('tts', lang),
          liveText: false
        }
      })
      onDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const skip = async (): Promise<void> => {
    const now = useApp.getState().settings
    const servicesNow = useServices.getState()
    // «Configurar más tarde» no desactiva lo que ya estuviera listo.
    await patchSettings({
      features: {
        ...now.features,
        ai: servicesNow.isReady('ai'),
        tts: servicesNow.isReady('tts', lang),
        liveText: false
      }
    })
    onDone(false)
  }

  const optionSelect = (opts: typeof dictOptions, value: string, onChange: (id: string) => void, label: string, skip?: string): JSX.Element => (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={busy}>
        {skip && <option value="">{skip}</option>}
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}{o.installed || !o.sizeBytes ? '' : ` · ${formatBytes(o.sizeBytes)}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="onboard-setup">
      <p>{ANDROID
        ? 'Prepara lo esencial. Si tu teléfono ya trae motor de voz y voces, no hay que descargar nada.'
        : 'Elige qué preparar. Las descargas se guardan en tu equipo y después funcionan sin conexión.'}</p>

      <div className="setup-step">
        <div>
          <b>Dictado por voz</b>
          <p className="muted">Convierte lo que hablas en texto.</p>
        </div>
        {dictOptions.length > 0
          ? optionSelect(dictOptions, dictId, setDictId, 'Calidad')
          : <p className="warn">No se pudo leer la lista de modelos. Puedes configurarlo después.</p>}
      </div>

      {!ANDROID && (
        <div className="setup-step">
          <div>
            <b>Redacción con IA</b>
            <p className="muted">Corrige, ordena y reescribe. Es opcional: puedes configurarla ahora o más tarde.</p>
          </div>
          <div className="row">
            <span className={aiReady ? 'ok' : 'muted'}>{aiReady ? '✓ Lista' : 'Sin configurar'}</span>
            <button onClick={() => void useSetup.getState().ask({ service: 'ai' })}>{aiReady ? 'Cambiar' : 'Configurar'}</button>
          </div>
        </div>
      )}

      <div className="setup-step">
        <div>
          <b>Lectura en voz alta</b>
          <p className="muted">Lee documentos, respuestas y traducciones.</p>
        </div>
        {voiceOptions.length > 0
          ? optionSelect(voiceOptions, voiceId, setVoiceId, 'Voz', 'Ahora no')
          : <p className="warn">No hay voces disponibles para este idioma. Puedes añadir una después.</p>}
      </div>

      {aiOption && (
        <div className="setup-step">
          <div>
            <b>Redacción con IA</b>
            <p className="muted">Corrige, ordena y reescribe. También traduce y resume.</p>
          </div>
          <label className="inline check">
            <input type="checkbox" checked={withAi} disabled={busy} onChange={(e) => setWithAi(e.target.checked)} />
            Añadir {aiOption.installed ? 'la IA' : `la IA (${formatBytes(aiOption.sizeBytes)})`}
          </label>
        </div>
      )}

      {error && <p className="warn" role="alert">{error}</p>}
      {!services.loaded && <p className="muted" role="status">Comprobando lo que ya {ANDROID ? 'trae tu teléfono' : 'tienes instalado'}…</p>}
      {busy && <p className="muted" role="status">{progress}</p>}
      <div className="row end">
        <button onClick={onBack} disabled={busy}>Atrás</button>
        <button onClick={() => void skip()} disabled={busy}>Configurar más tarde</button>
        <button className="primary" onClick={() => void run()} disabled={busy || !services.loaded}>
          {busy ? 'Preparando…' : pendingBytes > 0 ? `Descargar y empezar (${formatBytes(pendingBytes)})` : needsPrepare ? 'Preparar y empezar' : 'Empezar'}
        </button>
      </div>
    </div>
  )
}
