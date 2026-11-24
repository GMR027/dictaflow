import { lazy, Suspense, useEffect, useState } from 'react'
import { Dictation } from './components/Dictation'
import { Jobs } from './components/Jobs'
import { Logo } from './components/Logo'
import { Onboarding } from './components/Onboarding'
import { UpdatePrompt } from './components/Updates'
import { Aura } from './components/Aura'
import { NavIcon } from './components/NavIcon'
import { UiIcon, type UiGlyph } from './components/UiIcon'

const ANDROID = window.api.platform === 'android'
import type { Theme } from '@shared/types'
import { useApp, type View } from './store'

// Las pantallas pesadas (PDF, audio, reuniones, ajustes) se cargan al abrirlas. El dictado,
// que es la entrada por defecto, va en el paquete inicial.
const AudioTools = lazy(() => import('./components/AudioTools').then((m) => ({ default: m.AudioTools })))
const Automations = lazy(() => import('./components/Automations').then((m) => ({ default: m.Automations })))
const Calendar = lazy(() => import('./components/Calendar').then((m) => ({ default: m.Calendar })))
const Manual = lazy(() => import('./components/Manual').then((m) => ({ default: m.Manual })))
const Meetings = lazy(() => import('./components/Meetings').then((m) => ({ default: m.Meetings })))
const MyVoices = lazy(() => import('./components/MyVoices').then((m) => ({ default: m.MyVoices })))
const Privacy = lazy(() => import('./components/Privacy').then((m) => ({ default: m.Privacy })))
const Prompts = lazy(() => import('./components/Prompts').then((m) => ({ default: m.Prompts })))
const Reader = lazy(() => import('./components/Reader').then((m) => ({ default: m.Reader })))
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })))
const Translate = lazy(() => import('./components/Translate').then((m) => ({ default: m.Translate })))

/** Esqueleto mientras arranca la app o se carga una pantalla. */
function Cargando({ overlay = false, label = 'Cargando…' }: { overlay?: boolean; label?: string }): JSX.Element {
  return (
    <div className={overlay ? 'boot' : 'view-loading'}>
      <div className={overlay ? 'boot-mark' : 'boot-mark small'} />
      <p>{label}</p>
    </div>
  )
}

const THEMES: [Theme, UiGlyph, string][] = [['system', 'monitor', 'Sistema'], ['dark', 'moon', 'Oscuro'], ['light', 'sun', 'Claro']]

const NAV: { id: View; label: string }[] = [
  { id: 'dictado', label: 'Dictado' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'audio', label: 'Audio' },
  { id: 'lector', label: 'Lector' },
  { id: 'reuniones', label: 'Reuniones' },
  { id: 'traduccion', label: 'Traducción' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'voces', label: 'Mis voces' },
  { id: 'automatizaciones', label: 'Automatizaciones' },
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'privacidad', label: 'Privacidad' },
  { id: 'manual', label: 'Manual' }
]

/** Secciones fijas de la barra inferior; el resto vive en «Más». */
const MOBILE_NAV: View[] = ['dictado', 'lector', 'reuniones', 'traduccion']

/** Pantalla estrecha (el teléfono en vertical). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 600px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const onChange = (): void => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export function App(): JSX.Element | null {
  const { ready, init, settings, view, setView, patchSettings } = useApp()
  const narrow = useNarrow()
  const [more, setMore] = useState(false)
  useEffect(() => { void init() }, [init])
  // Al cambiar de sección o volver al escritorio, la hoja «Más» se cierra.
  useEffect(() => { setMore(false) }, [view, narrow])
  // «Sistema» = sin atributo: manda prefers-color-scheme. Oscuro/Claro fijan la paleta con independencia del SO.
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])
  // Teléfono: la barra inferior se desliza sola hasta la sección activa.
  useEffect(() => { document.querySelector('aside nav button.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }, [view, ready])
  if (!ready) return <Cargando overlay label="Cargando DictaFlow…" />
  if (!settings.onboarded) return <><Onboarding /><UpdatePrompt />{ANDROID && <Aura />}</>

  // Nube = cualquier proveedor que no sea un servidor en este mismo equipo. En Android la IA
  // corre siempre dentro del teléfono.
  const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(settings.llm.baseUrl ?? '')
  const cloud = window.api.platform === 'android' || ((settings.llm.kind === 'ollama' || settings.llm.kind === 'openai-compat') && isLoopback) ? null : settings.llm.kind
  const cloudAudio = settings.sttProvider === 'openai' || settings.ttsProvider === 'openai'
  const local = !cloud && !cloudAudio
  const privacyText = local
    ? '● Todo local'
    : `● Nube: ${[cloud, cloudAudio ? 'audio' : ''].filter(Boolean).join(' + ') || 'servicio'}`

  return (
    <div className="shell">
      <aside>
        <h1 className="brand"><Logo size={30} />DictaFlow</h1>
        <nav>
          {narrow ? (
            <>
              {NAV.filter((n) => MOBILE_NAV.includes(n.id)).map((n) => (
                <button key={n.id} className={view === n.id ? 'on' : ''} onClick={() => setView(n.id)}>
                  <NavIcon id={n.id} /> {n.label}
                </button>
              ))}
              <button className={!MOBILE_NAV.includes(view) ? 'on' : ''} aria-expanded={more}
                aria-haspopup="dialog" onClick={() => setMore((v) => !v)}>
                <NavIcon id="more" /> Más
              </button>
            </>
          ) : NAV.map((n) => (
            <button key={n.id} className={view === n.id ? 'on' : ''} onClick={() => setView(n.id)}>
              <NavIcon id={n.id} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="theme" role="radiogroup" aria-label="Tema">
          {THEMES.map(([t, icon, label]) => (
            <button key={t} role="radio" aria-checked={settings.theme === t} aria-label={label} title={label} className={settings.theme === t ? 'on' : ''}
              onClick={() => void patchSettings({ theme: t })}><UiIcon id={icon} /></button>
          ))}
        </div>
        <div className={`badge ${local ? 'local' : 'cloud'}`} title="Estado de privacidad">
          {local ? '🟢 Todo local' : `🟠 Nube: ${[cloud, cloudAudio ? 'audio' : ''].filter(Boolean).join(' + ')}`}
        </div>
        <Jobs />
      </aside>
      <main>
        {ANDROID && (
          <header className="mobile-bar">
            <span className="mobile-brand"><Logo size={22} /> DictaFlow</span>
            <span className={`privacy-pill ${local ? 'local' : 'cloud'}`}>{privacyText}</span>
          </header>
        )}
        <Suspense fallback={<Cargando />}>
          {view === 'dictado' && <Dictation />}
          {view === 'prompts' && <Prompts />}
          {view === 'audio' && <AudioTools />}
          {view === 'lector' && <Reader />}
          {view === 'reuniones' && <Meetings />}
          {view === 'traduccion' && <Translate />}
          {view === 'agenda' && <Calendar />}
          {view === 'voces' && <MyVoices />}
          {view === 'automatizaciones' && <Automations />}
          {view === 'ajustes' && <Settings />}
          {view === 'privacidad' && <Privacy />}
          {view === 'manual' && <Manual />}
        </Suspense>
      </main>
      {narrow && more && (
        <>
          <div className="more-backdrop" onClick={() => setMore(false)} />
          <div className="more-sheet" role="dialog" aria-label="Más secciones">
            <div className="more-grid">
              {NAV.map((n) => (
                <button key={n.id} className={view === n.id ? 'on' : ''}
                  onClick={() => { setView(n.id); setMore(false) }}>
                  <NavIcon id={n.id} /> {n.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <UpdatePrompt />
      {ANDROID && <Aura />}
    </div>
  )
}
