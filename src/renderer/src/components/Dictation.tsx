import { useEffect, useState } from 'react'
import type { DictationMode, Lang, PromptTarget, Tone } from '@shared/types'
import { listMics } from '../audio'
import { modeLabel, useApp } from '../store'

const TARGETS: Record<PromptTarget, string> = {
  generic: 'Genérico', 'claude-code': 'Claude Code', opencode: 'opencode', cursor: 'Cursor', chatgpt: 'ChatGPT'
}
const LANGS: Record<Lang, string> = { es: 'Español', en: 'English' }
const TONES: Record<Tone, string> = { neutral: 'Neutro', formal: 'Formal', casual: 'Cercano', concise: 'Conciso' }

export function Dictation(): JSX.Element {
  const s = useApp()
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [copied, setCopied] = useState(false)
  const [undo, setUndo] = useState(false)

  useEffect(() => { void listMics().then(setMics) }, [])

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
  const [dev, setDev] = useState(false)
  const st = s.settings
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

  return (
    <div className="view">
      <section className="bar card">
        <label>
          Micrófono
          <select value={s.settings.micDeviceId} disabled={s.recording}
            onChange={(e) => void s.patchSettings({ micDeviceId: e.target.value })}>
            <option value="default">Predeterminado del sistema</option>
            {mics.filter((m) => m.deviceId !== 'default').map((m) => (
              <option key={m.deviceId} value={m.deviceId}>{m.label || `Micrófono ${m.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>
        </label>
        <div className="meter" aria-label="Nivel del micrófono">
          <div style={{ width: `${Math.min(100, s.level * 600)}%` }} />
        </div>
        <div className="seg" role="radiogroup" aria-label="Modo de dictado">
          {(Object.keys(modeLabel) as DictationMode[]).map((m) => (
            <button key={m} role="radio" aria-checked={s.settings.mode === m}
              className={s.settings.mode === m ? 'on' : ''} onClick={() => void changeMode(m)}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </section>

      {s.notice && <div className="notice" role="status">{s.notice}</div>}
      {s.error && <div className="error" role="alert">{s.error} <button className="link" onClick={() => useApp.setState({ error: null })}>cerrar</button></div>}

      <section className="card grow">
        <header>
          <h2>1 · Transcripción</h2>
          <div className="row tight">
            <label className="inline">Idioma
              <select value={s.settings.primaryLang} aria-label="Idioma de la transcripción"
                onChange={(e) => void s.patchSettings({ primaryLang: e.target.value as Lang })}>
                {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="inline switch">
              <input type="checkbox" role="switch" checked={s.settings.stopEnabled}
                onChange={(e) => void s.patchSettings({ stopEnabled: e.target.checked })} />
              <span className="slider" aria-hidden="true" /> Botón detener
            </label>
          </div>
          <span className="muted">
            {s.sttLoading ? `Descargando modelo… ${s.sttLoading}` : busy ? 'Transcribiendo…' : s.recording ? 'Escuchando…' : ''}
          </span>
        </header>
        <textarea value={s.raw} onChange={(e) => s.setRaw(e.target.value)} spellCheck
          placeholder={s.settings.mode === 'controlled'
            ? 'Pulsa el botón, habla y vuelve a pulsar para transcribir.'
            : 'Activa el parlante: se transcribe cada frase cuando haces una pausa.'} />
        {s.draft && <p className="muted draft" aria-live="polite">{s.draft}</p>}
        <div className="row">
          <button className={`mic ${s.recording ? 'rec' : ''}`} onClick={() => void s.toggleRecording()}>
            {s.recording
              ? (s.settings.mode === 'controlled' ? '■ Detener y transcribir' : '■ Desactivar parlante')
              : (s.settings.mode === 'controlled' ? '🎤 Pulsar para hablar' : '🎤 Activar parlante')}
          </button>
          <button className="danger" onClick={() => void s.cancel()}
            disabled={!s.settings.stopEnabled || (!s.recording && !busy)}
            title={s.settings.stopEnabled ? 'Interrumpe la grabación y descarta el audio' : 'Actívalo con el interruptor «Botón detener»'}>
            ⏹ Detener transcripción
          </button>
          <button onClick={() => void s.rewrite('rewrite')} disabled={!s.raw.trim() || s.rewriting}>Redactar con IA</button>
        </div>
      </section>

      <section className="card grow">
        <header>
          <h2>2 · Redacción con IA</h2>
          <div className="row tight">
            <label className="inline">Tono
              <select value={s.settings.tone} onChange={(e) => void s.patchSettings({ tone: e.target.value as Tone })}>
                {Object.entries(TONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="inline check">
              <input type="checkbox" checked={s.settings.autoRewrite}
                onChange={(e) => void s.patchSettings({ autoRewrite: e.target.checked })} /> Automático
            </label>
          </div>
        </header>
        <textarea value={s.polished} onChange={(e) => s.setPolished(e.target.value)}
          placeholder={s.rewriting ? 'Redactando…' : 'Aquí aparecerá el texto mejorado por la IA.'} />
        <div className="row">
          <button onClick={() => void s.rewrite('rewrite', true)} disabled={!s.raw.trim() || s.rewriting}>🔄 Rehacer</button>
          <button onClick={() => void s.rewrite('prompt')} disabled={!s.raw.trim() || s.rewriting}>💻 Convertir en prompt</button>
          <button onClick={() => void s.rewrite('changes')} disabled={!s.raw.trim() || s.rewriting}
            title="Lista de cambios concretos para pedirle modificaciones a una IA sobre un proyecto ya existente">🛠 Instrucciones de cambio</button>
          <button onClick={() => void copy()} disabled={!s.polished && !s.raw}>{copied ? '✓ Copiado' : '📋 Copiar'}</button>
          <button className="danger" onClick={remove} disabled={!s.polished && !s.raw}>🗑 Eliminar</button>
          <button onClick={() => void s.savePrompt()} disabled={!s.polished}>💾 Guardar prompt</button>
          <button onClick={() => void s.exportNote()} disabled={!s.polished && !s.raw}>📝 A notas</button>
          <button onClick={() => void exportPdf()} disabled={!s.polished && !s.raw}>📄 PDF</button>
          {undo && <button className="link" onClick={() => { s.undoClear(); setUndo(false) }}>Deshacer</button>}
          {s.versions.length > 1 && <span className="muted">{s.versions.length} versiones</span>}
        </div>
      </section>

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
              <button onClick={() => void send('claude-code')} disabled={!st.projectDir || (!s.polished && !s.raw)}>▶ Enviar a Claude Code</button>
              <button onClick={() => void send('opencode')} disabled={!st.projectDir || (!s.polished && !s.raw)}>▶ Enviar a opencode</button>
              <span className="muted">Abre una terminal en el proyecto, tras pedirte confirmación.</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
