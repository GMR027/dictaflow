import { useEffect, useRef, useState } from 'react'
import type { DictationMode, Lang, PromptTarget, Tone } from '@shared/types'
import { listMics } from '../audio'
import { COMMAND_SPECS } from '../commands'
import { modeLabel, useApp } from '../store'
import { BotTyping } from './BotTyping'
import { MoreMenu } from './MoreMenu'
import { RecButton } from './RecButton'
import { Sheet } from './Sheet'

const TARGETS: Record<PromptTarget, string> = {
  generic: 'Genérico', 'claude-code': 'Claude Code', opencode: 'opencode', cursor: 'Cursor', chatgpt: 'ChatGPT'
}
const LANGS: Record<Lang, string> = { es: 'Español', en: 'English' }
const TONES: Record<Tone, string> = { neutral: 'Neutro', formal: 'Formal', casual: 'Cercano', concise: 'Conciso' }
const ANDROID = window.api.platform === 'android'

export function Dictation(): JSX.Element {
  const s = useApp()
  const st = s.settings
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [copied, setCopied] = useState(false)
  const [undo, setUndo] = useState(false)
  const [dev, setDev] = useState(false)
  const [help, setHelp] = useState(false)
  /** La redacción con IA acaba de terminar: el borde queda verde hasta que se edita o se vuelve a grabar. */
  const [done, setDone] = useState(false)
  const wasRewriting = useRef(false)

  useEffect(() => { void listMics().then(setMics) }, [])
  useEffect(() => {
    if (wasRewriting.current && !s.rewriting && s.polished.trim()) setDone(true)
    if (s.rewriting) setDone(false)
    wasRewriting.current = s.rewriting
  }, [s.rewriting, s.polished])
  useEffect(() => { if (s.recording) setDone(false) }, [s.recording])

  const copy = async (): Promise<void> => {
    await s.copyPolished()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const remove = (): void => {
    s.clearAll()
    setUndo(true)
    setTimeout(() => setUndo(false), 6000)
  }
  const changeMode = async (mode: DictationMode): Promise<void> => {
    if (s.recording) await s.stop()
    await s.patchSettings({ mode })
  }
  const busy = s.transcribing > 0
  const controlled = st.mode === 'controlled'
  const hasText = !!(s.polished || s.raw)
  const noRaw = !s.raw.trim() || s.rewriting
  const pickProject = async (): Promise<void> => void s.patchSettings({ projectDir: (await window.api.pickProject()) || st.projectDir })
  const exportPdf = async (): Promise<void> => {
    try {
      const texto = s.polished || s.raw
      const f = await window.api.generatePdf(texto.slice(0, 60), texto, 'dictado')
      useApp.getState().flash(`📄 PDF guardado: ${f}`)
    } catch (e) {
      useApp.setState({ error: (e as Error).message })
    }
  }
  const send = async (agent: 'claude-code' | 'opencode'): Promise<void> => {
    try { await window.api.launchAgent(agent, s.polished || s.raw) } catch (e) { useApp.setState({ error: (e as Error).message }) }
  }

  const status = s.sttLoading ? `Descargando modelo… ${s.sttLoading}` : busy ? 'Transcribiendo' : s.recording ? 'Escuchando…' : ''

  return (
    <div className="view dictation">
      {s.notice && <div className="notice" role="status">{s.notice}</div>}
      {s.error && <div className="error" role="alert">{s.error} <button className="link" onClick={() => useApp.setState({ error: null })}>cerrar</button></div>}

      <section className="card grow">
        <header>
          <h2>1 · Transcripción</h2>
          <div className="chips">
            <select className="chip" value={st.primaryLang} aria-label="Idioma de la transcripción"
              onChange={(e) => void s.patchSettings({ primaryLang: e.target.value as Lang })}>
              {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {st.voiceCommands && <button className="chip" onClick={() => setHelp(true)}>🎙 Comandos</button>}
          </div>
        </header>

        <div className={`field ${busy || s.draft ? 'live' : ''}`}>
          <textarea value={s.raw} onChange={(e) => s.setRaw(e.target.value)} spellCheck
            placeholder={controlled
              ? 'Pulsa el micrófono, habla y vuelve a pulsar para transcribir.'
              : 'Activa el parlante: se transcribe cada frase cuando haces una pausa.'} />
          {s.draft && <p className="live-draft" aria-live="polite">{s.draft}</p>}
          {busy && !s.draft && <BotTyping label="Transcribiendo" />}
        </div>

        <RecButton recording={s.recording} level={s.level} onClick={() => void s.toggleRecording()}
          idle={controlled ? 'Pulsa para hablar' : 'Activar parlante'}
          active={controlled ? 'Detener y transcribir' : 'Desactivar parlante'}
          hint={status && !busy ? status : undefined} />

        <div className="actions center">
          <div className="seg" role="radiogroup" aria-label="Modo de dictado">
            {(Object.keys(modeLabel) as DictationMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={st.mode === m}
                className={st.mode === m ? 'on' : ''} onClick={() => void changeMode(m)}>
                {modeLabel[m]}
              </button>
            ))}
          </div>
          {st.stopEnabled && (s.recording || busy) && (
            <button className="danger" onClick={() => void s.cancel()} title="Interrumpe la grabación y descarta el audio">✕ Descartar</button>
          )}
          {!st.autoRewrite && <button onClick={() => void s.rewrite('rewrite')} disabled={noRaw}>✨ Redactar</button>}
        </div>

        <details className="opts">
          <summary>Opciones del micrófono</summary>
          <div className="row">
            <label className="grow">Micrófono
              <select value={st.micDeviceId} disabled={s.recording}
                onChange={(e) => void s.patchSettings({ micDeviceId: e.target.value })}>
                <option value="default">Predeterminado del sistema</option>
                {mics.filter((m) => m.deviceId !== 'default').map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>{m.label || `Micrófono ${m.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
            </label>
            <label className="inline switch">
              <input type="checkbox" role="switch" checked={st.stopEnabled}
                onChange={(e) => void s.patchSettings({ stopEnabled: e.target.checked })} />
              <span className="slider" aria-hidden="true" /> Botón para descartar
            </label>
          </div>
        </details>
      </section>

      <section className="card grow">
        <header>
          <h2>2 · Redacción con IA {done && <span className="field-done-tag">✓ Lista</span>}</h2>
          <label className="inline check">
            <input type="checkbox" checked={st.autoRewrite}
              onChange={(e) => void s.patchSettings({ autoRewrite: e.target.checked })} /> Automática
          </label>
        </header>
        <div className="tones" role="radiogroup" aria-label="Tono">
          {(Object.entries(TONES) as [Tone, string][]).map(([k, v]) => (
            <button key={k} role="radio" aria-checked={st.tone === k} className={`chip ${st.tone === k ? 'on' : ''}`}
              onClick={() => void s.patchSettings({ tone: k })}>{v}</button>
          ))}
        </div>
        <div className={`field ${s.rewriting ? 'live' : done ? 'done' : ''}`}>
          <textarea value={s.polished} onChange={(e) => { s.setPolished(e.target.value); setDone(false) }}
            placeholder="Aquí aparecerá el texto mejorado por la IA." />
          {s.rewriting && <BotTyping label="Redactando" />}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => void copy()} disabled={!hasText}>{copied ? '✓ Copiado' : '📋 Copiar'}</button>
          <button onClick={() => void s.rewrite('rewrite', true)} disabled={noRaw}>🔄 Rehacer</button>
          <button onClick={() => void s.exportNote()} disabled={!hasText}>📝 A notas</button>
          <MoreMenu items={[
            { label: '📄 Exportar PDF', onClick: () => void exportPdf(), disabled: !hasText },
            { label: '💻 Convertir en prompt', onClick: () => void s.rewrite('prompt'), disabled: noRaw },
            { label: '🛠 Instrucciones de cambio', onClick: () => void s.rewrite('changes'), disabled: noRaw },
            { label: '💾 Guardar prompt', onClick: () => void s.savePrompt(), disabled: !s.polished },
            { label: '🗑 Eliminar todo', onClick: remove, disabled: !hasText, danger: true }
          ]} />
          {undo && <button className="link" onClick={() => { s.undoClear(); setUndo(false) }}>Deshacer</button>}
          {s.versions.length > 1 && <span className="muted">{s.versions.length} versiones</span>}
        </div>
      </section>

      {!ANDROID && (
        <section className="card">
          <header>
            <h2>💻 Modo programador</h2>
            <button className="link" onClick={() => setDev(!dev)}>{dev ? 'ocultar' : 'mostrar'}</button>
          </header>
          {dev && (
            <>
              <p className="muted">«Convertir en prompt» y «Instrucciones de cambio» usan el destino y el contexto del proyecto (estructura, README, CLAUDE.md, dependencias). Solo se leen archivos de texto básicos, nada se envía salvo al modelo que elegiste.</p>
              <div className="row">
                <label>Destino del prompt
                  <select value={st.promptTarget} onChange={(e) => void s.patchSettings({ promptTarget: e.target.value as PromptTarget })}>
                    {Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <div className="grow">
                  <label>Carpeta del proyecto
                    <input readOnly value={st.projectDir || 'Sin proyecto (prompt genérico)'} />
                  </label>
                </div>
                <button onClick={() => void pickProject()}>Elegir…</button>
                {st.projectDir && <button onClick={() => void s.patchSettings({ projectDir: '' })}>Quitar</button>}
              </div>
              <div className="row">
                <button onClick={() => void send('claude-code')} disabled={!st.projectDir || !hasText}>▶ Enviar a Claude Code</button>
                <button onClick={() => void send('opencode')} disabled={!st.projectDir || !hasText}>▶ Enviar a opencode</button>
                <span className="muted">Abre una terminal en el proyecto, tras pedirte confirmación.</span>
              </div>
            </>
          )}
        </section>
      )}

      {help && (
        <Sheet title="🎙 Comandos de voz" onClose={() => setHelp(false)}>
          <p className="muted">
            Di el comando como una frase sola, o al final de lo que dictas precedido de <b>«Flow»</b>:
            «…nos vemos mañana. <b>Flow, redacta</b>». «Punto y aparte» y «salto de línea» funcionan en medio del texto, sin «Flow».
          </p>
          <ul className="netlist">
            {COMMAND_SPECS.map((c) => <li key={c.id}><b>{c.label}</b><br /><span className="muted">{c.say}</span></li>)}
          </ul>
        </Sheet>
      )}
    </div>
  )
}
