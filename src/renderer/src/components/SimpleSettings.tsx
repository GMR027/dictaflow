// Ajustes para el uso normal: activar servicios con un interruptor o un selector y
// entender para qué sirve cada cosa. Los modelos, motores y claves viven en el modo
// avanzado; aquí solo se muestra lo necesario.
import { useEffect, useState } from 'react'
import type { Lang, Theme } from '@shared/types'
import { formatBytes } from '@shared/local-models'
import type { ServiceOption } from '@shared/features'
import { installOption, ensureService, useServices } from '../services'
import { useSetup } from '../setup'
import { useApp } from '../store'
import { BackupCard } from './Diagnostics'
import { Updates } from './Updates'
import { UiIcon } from './UiIcon'

const THEMES: [Theme, 'monitor' | 'moon' | 'sun', string][] = [
  ['system', 'monitor', 'Sistema'], ['dark', 'moon', 'Oscuro'], ['light', 'sun', 'Claro']
]

/** Aplica una opción ya instalada o pide el complemento desde el modal. */
async function pick(service: 'dictation' | 'tts' | 'live', option: ServiceOption | undefined): Promise<void> {
  if (!option) return
  if (option.installed || option.action.kind === 'system-stt' || option.action.kind === 'system-voice') {
    await installOption(option)
    return
  }
  await useSetup.getState().ask({ service, lang: option.lang, prefer: option.id, disabled: false })
}

export function SimpleSettings(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const services = useServices()
  const [busy, setBusy] = useState('')

  // También al cambiar de idioma: el estado del paquete del motor del teléfono depende de él.
  useEffect(() => { void useServices.getState().refresh() }, [settings.primaryLang])

  // Android: si la voz guardada aún no está descargada y el teléfono ya trae voces,
  // se elige una del sistema. Así leer funciona sin descargar nada desde el principio.
  useEffect(() => {
    if (!services.loaded || settings.ttsProvider !== 'piper' || !settings.features.tts) return
    const opts = services.options('tts', settings.primaryLang)
    const current = opts.find((o) => o.id === settings.ttsVoice[settings.primaryLang])
    if (current?.installed) return
    const system = opts.find((o) => o.installed && o.action.kind === 'system-voice')
    if (system) void installOption(system)
    // Solo al cargar el estado o cambiar de idioma; después manda lo que elija el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.loaded, settings.primaryLang])

  const dictationReady = services.isReady('dictation')
  const aiReady = services.isReady('ai')
  const ttsReady = services.isReady('tts')
  const liveReady = services.isReady('live')
  const feature = settings.features

  const setFeature = async (key: 'ai' | 'tts' | 'liveText', value: boolean): Promise<void> => {
    const now = useApp.getState().settings
    await patchSettings({ features: { ...now.features, [key]: value } })
  }

  const toggle = async (key: 'ai' | 'tts' | 'liveText', value: boolean): Promise<void> => {
    if (!value) return setFeature(key, false)
    const ready = key === 'ai' ? aiReady : key === 'tts' ? ttsReady : liveReady
    // Si ya está preparado, el interruptor basta: un solo clic. Si falta, se abre el modal.
    if (ready) return setFeature(key, true)
    setBusy(key)
    try {
      await ensureService(key === 'liveText' ? 'live' : key)
    } finally {
      setBusy('')
    }
  }

  const dictOptions = services.options('dictation')
  const telefonoListo = services.phone?.onDevice && (!services.phoneLang?.checkable || services.phoneLang.installed)
  const dictCurrent = window.api.platform !== 'android'
    ? (dictOptions[0]?.id ?? 'whisper')
    : settings.sttPhone === 'auto' && telefonoListo
      ? 'telefono'
      : settings.sttModel || (dictOptions.find((o) => o.installed)?.id ?? '')

  const ttsOptions = services.options('tts', settings.primaryLang)
  const ttsLabel = services.tts?.catalog.find((v) => v.id === settings.ttsVoice[settings.primaryLang])?.label
    ?? services.tts?.catalog.find((v) => v.id === settings.ttsVoice[settings.primaryLang])?.id
    ?? settings.ttsVoice[settings.primaryLang]

  const liveOption = services.options('live', settings.primaryLang)[0]
  const liveDetail = !feature.liveText ? 'Desactivado'
    : liveReady ? 'Listo'
      : liveOption ? `Falta descargar (${formatBytes(liveOption.sizeBytes)})` : 'No disponible para este idioma'

  const summary = !services.loaded ? 'Comprobando…' : [
    dictationReady ? 'Dictado listo' : 'Dictado sin preparar',
    feature.ai ? (aiReady ? 'IA lista' : 'IA sin preparar') : 'IA desactivada',
    feature.tts ? (ttsReady ? 'voz lista' : 'voz sin preparar') : 'voz desactivada',
    ...(feature.liveText ? [liveReady ? 'texto en vivo listo' : 'texto en vivo sin preparar'] : [])
  ].join(' · ')
  const summaryOk = !services.loaded || (dictationReady && (!feature.ai || aiReady) && (!feature.tts || ttsReady) && (!feature.liveText || liveReady))

  return (
    <div className="view">
      <section className="card">
        <header>
          <h2>Servicios</h2>
          <div className="row tight">
            <span className={`service-summary ${summaryOk ? 'ok' : 'warn'}`}>{summary}</span>
            <button className="link" onClick={() => void patchSettings({ advancedUI: true })}>⚙ Avanzado</button>
          </div>
        </header>
        <p className="muted">Activa lo que quieras usar. DictaFlow elige la mejor opción para tu {window.api.platform === 'android' ? 'teléfono' : 'equipo'} y descarga solo lo necesario.</p>

        <div className="service-row">
          <div className="service-copy">
            <b>Dictado por voz</b>
            <p>Convierte lo que hablas en texto para escribir sin teclear.</p>
            <small className={dictationReady ? 'ok' : 'warn'}>
              {dictationReady
                ? dictCurrent === 'telefono' ? 'Listo · motor del teléfono' : 'Listo · Whisper'
                : 'Falta preparar el dictado'}
            </small>
          </div>
          <div className="service-control">
            <select value={dictCurrent} aria-label="Calidad del dictado" disabled={!!busy}
              onChange={(e) => { void pick('dictation', dictOptions.find((o) => o.id === e.target.value)) }}>
              {!dictOptions.some((o) => o.id === dictCurrent) && <option value={dictCurrent}>Elegir…</option>}
              {dictOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}{o.installed || !o.sizeBytes ? '' : ` · ${formatBytes(o.sizeBytes)}`}
                </option>
              ))}
            </select>
            {!dictationReady && (
              <button className="primary" onClick={() => void useSetup.getState().ask({ service: 'dictation' })}>Preparar</button>
            )}
          </div>
        </div>

        <div className="service-row">
          <div className="service-copy">
            <b>Redacción con IA</b>
            <p>Corrige, ordena y reescribe lo que dictas. También traduce y resume.</p>
            <small className={feature.ai ? (aiReady ? 'ok' : 'warn') : 'muted'}>
              {feature.ai ? (aiReady ? 'Listo' : services.aiActive.detail) : 'Desactivado'}
            </small>
          </div>
          <div className="service-control">
            <label className="switch" aria-label="Activar redacción con IA">
              <input type="checkbox" role="switch" checked={feature.ai} disabled={busy === 'ai'}
                onChange={(e) => void toggle('ai', e.target.checked)} />
              <span className="slider" aria-hidden="true" />
            </label>
            <button className="link" onClick={() => void useSetup.getState().ask({ service: 'ai' })}>
              {feature.ai ? (aiReady ? 'Cambiar' : 'Elegir') : aiReady ? 'Activar' : 'Elegir'}
            </button>
          </div>
        </div>

        <div className="service-row">
          <div className="service-copy">
            <b>Lectura en voz alta</b>
            <p>Lee documentos, respuestas y traducciones en voz alta.</p>
            <small className={feature.tts ? (ttsReady ? 'ok' : 'warn') : 'muted'}>
              {feature.tts ? (ttsReady ? 'Listo' : 'Falta descargar una voz') : 'Desactivado'}
            </small>
          </div>
          <div className="service-control">
            <label className="switch" aria-label="Activar lectura en voz alta">
              <input type="checkbox" role="switch" checked={feature.tts} disabled={busy === 'tts'}
                onChange={(e) => void toggle('tts', e.target.checked)} />
              <span className="slider" aria-hidden="true" />
            </label>
          </div>
          {settings.ttsProvider !== 'openai' && (
            <div className="service-extra">
              <label>Voz para {settings.primaryLang === 'es' ? 'español' : 'English'}
                <select value={settings.ttsVoice[settings.primaryLang]} disabled={!!busy}
                  onChange={(e) => { void pick('tts', ttsOptions.find((o) => o.id === e.target.value)) }}>
                  {!ttsOptions.some((o) => o.id === settings.ttsVoice[settings.primaryLang]) && <option value={settings.ttsVoice[settings.primaryLang]}>{ttsLabel}</option>}
                  {ttsOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}{o.installed || !o.sizeBytes ? '' : ` · ${formatBytes(o.sizeBytes)}`}
                    </option>
                  ))}
                </select>
              </label>
              {!ttsReady && (
                <button className="link" onClick={() => void useSetup.getState().ask({ service: 'tts', lang: settings.primaryLang })}>Preparar voz</button>
              )}
            </div>
          )}
        </div>

        <div className="service-row">
          <div className="service-copy">
            <b>Texto en vivo</b>
            <p>Mira tus palabras aparecer mientras hablas. Es opcional.</p>
            <small className={feature.liveText ? (liveReady ? 'ok' : 'warn') : 'muted'}>{liveDetail}</small>
          </div>
          <div className="service-control">
            {feature.liveText && !liveReady && (
              <button className="link" onClick={() => void useSetup.getState().ask({ service: 'live', lang: settings.primaryLang })}>Descargar</button>
            )}
            <label className="switch" aria-label="Activar texto en vivo">
              <input type="checkbox" role="switch" checked={feature.liveText} disabled={busy === 'liveText'}
                onChange={(e) => void toggle('liveText', e.target.checked)} />
              <span className="slider" aria-hidden="true" />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Idiomas</h2>
        <div className="row">
          <label>Principal
            <select value={settings.primaryLang} onChange={(e) => {
              const primary = e.target.value as Lang
              void patchSettings({ primaryLang: primary, secondaryLang: settings.secondaryLang === primary ? null : settings.secondaryLang })
            }}>
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
        <h2>Apariencia</h2>
        <div className="seg" role="radiogroup" aria-label="Tema">
          {THEMES.map(([t, icon, label]) => (
            <button key={t} role="radio" aria-checked={settings.theme === t} className={settings.theme === t ? 'on' : ''}
              onClick={() => void patchSettings({ theme: t })}><UiIcon id={icon} /> {label}</button>
          ))}
        </div>
      </section>

      <Updates />
      <BackupCard />

      <section className="card">
        <label className="inline check">
          <input type="checkbox" checked={settings.advancedUI} onChange={(e) => void patchSettings({ advancedUI: e.target.checked })} />
          Opciones avanzadas
        </label>
        <p className="muted">Modelos, motores, claves API y todos los controles técnicos. Para quien quiera configurar la app al detalle.</p>
      </section>
    </div>
  )
}
