import { useEffect } from 'react'
import { AudioTools } from './components/AudioTools'
import { Dictation } from './components/Dictation'
import { Jobs } from './components/Jobs'
import { Logo } from './components/Logo'
import { Meetings } from './components/Meetings'
import { Prompts } from './components/Prompts'
import { Reader } from './components/Reader'
import { Translate } from './components/Translate'
import { Manual } from './components/Manual'
import { Onboarding } from './components/Onboarding'
import { Privacy } from './components/Privacy'
import { Settings } from './components/Settings'
import type { Theme } from '@shared/types'
import { useApp, type View } from './store'

const THEMES: [Theme, string, string][] = [['system', '🖥', 'Sistema'], ['dark', '🌙', 'Oscuro'], ['light', '☀', 'Claro']]

const NAV: { id: View; label: string }[] = [
  { id: 'dictado', label: '🎤 Dictado' },
  { id: 'prompts', label: '📚 Prompts' },
  { id: 'audio', label: '🎧 Audio' },
  { id: 'lector', label: '📖 Lector' },
  { id: 'reuniones', label: '🗂 Reuniones' },
  { id: 'traduccion', label: '🌐 Traducción' },
  { id: 'ajustes', label: '⚙ Ajustes' },
  { id: 'privacidad', label: '🔒 Privacidad' },
  { id: 'manual', label: '❓ Manual' }
]

export function App(): JSX.Element | null {
  const { ready, init, settings, view, setView, patchSettings } = useApp()
  useEffect(() => { void init() }, [init])
  // «Sistema» = sin atributo: manda prefers-color-scheme. Oscuro/Claro fijan la paleta con independencia del SO.
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])
  if (!ready) return null
  if (!settings.onboarded) return <Onboarding />

  // Nube = cualquier proveedor que no sea un servidor en este mismo equipo
  const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(settings.llm.baseUrl ?? '')
  const cloud = (settings.llm.kind === 'ollama' || settings.llm.kind === 'openai-compat') && isLoopback ? null : settings.llm.kind
  const cloudAudio = settings.sttProvider === 'openai' || settings.ttsProvider === 'openai'
  const local = !cloud && !cloudAudio

  return (
    <div className="shell">
      <aside>
        <h1 className="brand"><Logo size={30} />DictaFlow</h1>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? 'on' : ''} onClick={() => setView(n.id)}>{n.label}</button>
          ))}
        </nav>
        <div className="theme" role="radiogroup" aria-label="Tema">
          {THEMES.map(([t, icon, label]) => (
            <button key={t} role="radio" aria-checked={settings.theme === t} title={label} className={settings.theme === t ? 'on' : ''}
              onClick={() => void patchSettings({ theme: t })}>{icon}</button>
          ))}
        </div>
        <div className={`badge ${local ? 'local' : 'cloud'}`} title="Estado de privacidad">
          {local ? '🟢 Todo local' : `🟠 Nube: ${[cloud, cloudAudio ? 'audio' : ''].filter(Boolean).join(' + ')}`}
        </div>
        <Jobs />
      </aside>
      <main>
        {view === 'dictado' && <Dictation />}
        {view === 'prompts' && <Prompts />}
        {view === 'audio' && <AudioTools />}
        {view === 'lector' && <Reader />}
        {view === 'reuniones' && <Meetings />}
        {view === 'traduccion' && <Translate />}
        {view === 'ajustes' && <Settings />}
        {view === 'privacidad' && <Privacy />}
        {view === 'manual' && <Manual />}
      </main>
    </div>
  )
}
