import { useState } from 'react'
import type { Lang } from '@shared/types'
import { useServices } from '../services'
import { useApp } from '../store'
import { Logo } from './Logo'
import { OnboardingSetup } from './OnboardingSetup'

const ANDROID = window.api.platform === 'android'
const LANGS: Record<Lang, string> = { es: 'Español', en: 'English' }

export function Onboarding(): JSX.Element {
  const { settings, patchSettings, sttLoading } = useApp()
  const services = useServices()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  /** El usuario preparó el dictado en el paso 2; si lo omitió, no se fuerza una descarga. */
  const [prepared, setPrepared] = useState(false)

  const finish = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      // Solo se carga si hay un modelo de Whisper preparado; en Android puede usarse
      // únicamente el motor del teléfono y entonces no hay nada que cargar.
      const hasWhisper = !ANDROID || !!settings.sttModel
      if (prepared && hasWhisper) await window.api.loadStt()
      await patchSettings({ onboarded: true })
    } catch (e) {
      setMsg(`No se pudo preparar el dictado: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  const dictation = services.isReady('dictation')
  const ai = settings.features.ai && services.isReady('ai')
  const voice = settings.features.tts && services.isReady('tts')

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
              <select value={settings.primaryLang} onChange={(e) => {
                const primary = e.target.value as Lang
                void patchSettings({ primaryLang: primary, secondaryLang: settings.secondaryLang === primary ? null : settings.secondaryLang })
              }}>
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
            <h1>Preparar DictaFlow</h1>
            <OnboardingSetup onDone={(ok) => { setPrepared(ok); setStep(2) }} onBack={() => setStep(0)} />
          </>
        )}
        {step === 2 && (
          <>
            <h1>{dictation && voice ? 'Todo listo' : 'Ya puedes empezar'}</h1>
            <ul className="setup-checklist">
              <li className={dictation ? 'ok' : 'warn'}>{dictation ? '✓' : '○'} Dictado: {dictation ? 'listo para usar' : 'se puede preparar desde Ajustes'}</li>
              <li className={voice ? 'ok' : 'warn'}>{voice ? '✓' : '○'} Lectura en voz alta: {voice ? 'lista' : 'se puede activar cuando quieras'}</li>
              <li className={ai ? 'ok' : 'warn'}>{ai ? '✓' : '○'} Redacción con IA: {ai ? 'lista' : 'opcional, se activa desde Ajustes o al usarla'}</li>
            </ul>
            <p className="muted">Puedes cambiar o borrar lo descargado cuando quieras en Ajustes → Servicios.</p>
            {busy && <p>{msg || 'Preparando el dictado…'} {sttLoading}</p>}
            {!busy && msg && <p className="warn">{msg}</p>}
          </>
        )}
        <div className="row end">
          {step === 2 && <button onClick={() => setStep(1)} disabled={busy}>Atrás</button>}
          {step === 0 && <button className="primary" onClick={() => setStep(1)}>Siguiente</button>}
          {step === 2 && <button className="primary" onClick={() => void finish()} disabled={busy}>Empezar</button>}
        </div>
      </div>
    </div>
  )
}
