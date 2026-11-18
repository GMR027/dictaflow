import { useEffect, useState } from 'react'
import {
  formatBytes, LOCAL_MODELS, modelFit, modelReady,
  type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelKind, type LocalModelProgress
} from '@shared/local-models'
import { useApp } from '../store'

const BADGE = { recommended: '★ Recomendado', ok: 'Compatible', slow: '⚠ Pesado para este teléfono' } as const
const TITLE: Record<LocalModelKind, [string, string]> = {
  stt: ['Voz → texto (Whisper)', 'Transcribe lo que dictas. Funciona sin conexión.'],
  llm: ['Redacción con IA', 'Pule, reescribe, traduce y resume tus textos dentro del teléfono, sin enviarlos a ningún servidor.'],
  tts: ['Lectura en voz alta (voces)', 'Lee tus textos, documentos y traducciones sin conexión. Elige una voz por idioma; con ▶ la escuchas antes de descargarla.']
}

/** Reproduce un audio (WAV o MP3) y espera a que termine. */
function play(bytes: Uint8Array, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
    const a = new Audio(url)
    a.onended = () => { URL.revokeObjectURL(url); resolve() }
    a.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo reproducir el audio.')) }
    void a.play().catch(reject)
  })
}

/**
 * Android: descarga, elige y borra los modelos de IA que corren dentro del teléfono.
 * Se usa en Ajustes → Servicios de IA y en el asistente inicial (`only` limita a un tipo).
 */
export function LocalModels({ only }: { only?: LocalModelKind }): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [files, setFiles] = useState<LocalModelFile[]>([])
  const [progress, setProgress] = useState<Record<string, LocalModelProgress>>({})
  const [test, setTest] = useState<string | null>(null)
  const [listen, setListen] = useState<{ id: string; msg: string } | null>(null)

  const refresh = (): void => {
    void window.api.listLocalModels().then(setFiles)
    void window.api.deviceInfo().then(setDevice)
  }

  useEffect(() => {
    refresh()
    return window.api.onModelProgress((p) => {
      setProgress((x) => ({ ...x, [p.id]: p }))
      if (p.state !== 'downloading' && p.state !== 'verifying') refresh()
      // Al terminar el primer modelo de cada tipo, se deja elegido.
      if (p.state === 'done') {
        const m = LOCAL_MODELS.find((x) => x.id === p.id)
        const s = useApp.getState().settings
        if (m?.kind === 'stt' && !s.sttModel) void patchSettings({ sttModel: m.id })
        if (m?.kind === 'llm' && !s.localLlm) void patchSettings({ localLlm: m.id })
        // Voz: se elige si la del idioma aún no está descargada (la de fábrica no lo está).
        if (m?.kind === 'tts' && m.voice && m.lang) {
          const { voice, lang } = m
          void window.api.listLocalModels().then((fs) => {
            const actual = LOCAL_MODELS.find((x) => x.kind === 'tts' && x.voice === useApp.getState().settings.ttsVoice[lang])
            if (!actual || !modelReady(actual, fs)) void patchSettings({ ttsVoice: { ...useApp.getState().settings.ttsVoice, [lang]: voice } })
          })
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const file = (id: string): LocalModelFile | undefined => files.find((f) => f.id === id)
  const active = (m: LocalModel): boolean =>
    m.kind === 'tts' ? !!m.lang && settings.ttsVoice[m.lang] === m.voice : (m.kind === 'stt' ? settings.sttModel : settings.localLlm) === m.id
  const select = (m: LocalModel): Promise<void> =>
    m.kind === 'tts' && m.lang && m.voice
      ? patchSettings({ ttsVoice: { ...settings.ttsVoice, [m.lang]: m.voice } })
      : patchSettings(m.kind === 'stt' ? { sttModel: m.id } : { localLlm: m.id })
  const unselect = (m: LocalModel): Partial<typeof settings> | null =>
    m.kind === 'tts' ? null : m.kind === 'stt' ? { sttModel: '' } : { localLlm: '' }

  /** Voz descargada: la dice el propio teléfono. Si no, la muestra oficial (se pide a Hugging Face). */
  const listenVoice = async (m: LocalModel, ready: boolean): Promise<void> => {
    if (!m.voice || !m.lang) return
    setListen({ id: m.id, msg: ready ? 'Generando…' : 'Descargando muestra…' })
    try {
      const frase = m.lang === 'es' ? 'Hola. Así suena esta voz en tu teléfono, sin conexión a internet.' : 'Hello. This is how this voice sounds on your phone, offline.'
      const t0 = performance.now()
      const bytes = ready ? await window.api.synthesize(frase, m.lang, m.voice) : await window.api.voiceSample(m.voice)
      setListen({ id: m.id, msg: ready ? `▶ generada en ${((performance.now() - t0) / 1000).toFixed(1)} s` : '▶ muestra' })
      await play(bytes, ready ? 'audio/wav' : 'audio/mpeg')
      setListen(null)
    } catch (e) {
      setListen({ id: m.id, msg: `✗ ${(e as Error).message}` })
    }
  }

  const download = async (m: LocalModel): Promise<void> => {
    setProgress((x) => ({ ...x, [m.id]: { id: m.id, state: 'downloading', received: file(m.id)?.bytes ?? 0, total: m.bytes } }))
    try {
      await window.api.downloadModel(m)
    } catch (e) {
      setProgress((x) => ({ ...x, [m.id]: { id: m.id, state: 'error', received: 0, total: m.bytes, error: (e as Error).message } }))
    }
  }

  const remove = async (m: LocalModel): Promise<void> => {
    if (!confirm(`¿Borrar ${m.label} (${formatBytes(m.bytes)}) del teléfono?`)) return
    await window.api.removeModel(m.id)
    const off = unselect(m)
    if (active(m) && off) await patchSettings(off)
    setProgress((x) => ({ ...x, [m.id]: { id: m.id, state: 'cancelled', received: 0, total: m.bytes } }))
    refresh()
  }

  const runTest = async (): Promise<void> => {
    setTest('Redactando… (la primera vez el modelo tarda unos segundos en cargar)')
    const t0 = performance.now()
    try {
      const out = await window.api.testLLM()
      setTest(`✓ «${out}» · ${((performance.now() - t0) / 1000).toFixed(1)} s`)
    } catch (e) {
      setTest(`✗ ${(e as Error).message}`)
    }
  }

  const kinds: LocalModelKind[] = only ? [only] : ['stt', 'llm', 'tts']
  const used = files.filter((f) => !f.partial).reduce((a, f) => a + f.bytes, 0)

  return (
    <>
      <p className="muted">
        {device ? `Este teléfono: ${device.ramGB} GB de RAM · ${device.cores} núcleos · ${device.freeGB} GB libres` : 'Revisando el teléfono…'}
        {used > 0 && ` · modelos: ${formatBytes(used)}`}
      </p>
      {kinds.map((kind) => (
        <div key={kind}>
          <h3>{TITLE[kind][0]}</h3>
          <p className="muted">{TITLE[kind][1]}</p>
          {LOCAL_MODELS.filter((m) => m.kind === kind).map((m) => {
            const f = file(m.id)
            const ready = modelReady(m, files)
            const extra = m.extra && progress[m.extra.id]
            const p = progress[m.id] ?? (extra?.state === 'error' ? extra : undefined)
            const busy = p?.state === 'downloading' || p?.state === 'verifying'
            const fit = modelFit(m, device?.ramGB ?? 0)
            const pct = p && p.total ? Math.floor((p.received / p.total) * 100) : 0
            return (
              <div key={m.id} className={`rec ${fit}`}>
                {ready && <input type="radio" name={`local-${kind}${m.lang ? `-${m.lang}` : ''}`} checked={active(m)} onChange={() => void select(m)} aria-label={`Usar ${m.label}`} />}
                <span>
                  <b>{m.label}</b> <small>{formatBytes(m.bytes)}</small><br />
                  <small>{m.note}</small>
                  {busy && (
                    <>
                      <br />
                      <progress max={100} value={p.state === 'verifying' ? undefined : pct} />{' '}
                      <small>{p.state === 'verifying' ? 'Verificando…' : `${pct}% · ${formatBytes(p.received)} de ${formatBytes(p.total)}`}</small>
                    </>
                  )}
                  {p?.state === 'error' && <><br /><small className="warn">{p.error}</small></>}
                  {!busy && f?.partial && <><br /><small className="muted">Descarga a medias ({formatBytes(f.bytes)}): continúa donde se quedó.</small></>}
                  {listen?.id === m.id && <><br /><small className={listen.msg.startsWith('✗') ? 'warn' : 'muted'}>{listen.msg}</small></>}
                </span>
                {kind === 'tts' && (
                  <button className="link" onClick={() => void listenVoice(m, ready)} disabled={!!listen && !listen.msg.startsWith('✗')} aria-label={`Escuchar ${m.label}`}>▶</button>
                )}
                <em>{ready && active(m) ? '✓ En uso' : BADGE[fit]}</em>
                {busy
                  ? <button onClick={() => void window.api.cancelModel(m.id)}>Cancelar</button>
                  : ready
                    ? <button className="link" onClick={() => void remove(m)}>Borrar</button>
                    : <button className={fit === 'recommended' ? 'primary' : ''} onClick={() => void download(m)}>{f?.partial || (m.extra && file(m.id)) ? 'Continuar' : 'Descargar'}</button>}
              </div>
            )
          })}
          {kind === 'llm' && files.some((f) => f.id === settings.localLlm && !f.partial) && (
            <p>
              <button onClick={() => void runTest()} disabled={test?.startsWith('Redactando') ?? false}>Probar redacción</button>{' '}
              {test && <small className={test.startsWith('✗') ? 'warn' : 'muted'}>{test}</small>}
            </p>
          )}
        </div>
      ))}
      <p className="muted">Usa Wi-Fi para descargar y deja la app abierta hasta que termine; si se interrumpe, la descarga continúa donde se quedó.</p>
    </>
  )
}
