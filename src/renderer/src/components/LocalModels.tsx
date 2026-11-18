import { useEffect, useState } from 'react'
import {
  formatBytes, LOCAL_MODELS, modelFit,
  type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelKind, type LocalModelProgress
} from '@shared/local-models'
import { useApp } from '../store'

const BADGE = { recommended: '★ Recomendado', ok: 'Compatible', slow: '⚠ Pesado para este teléfono' } as const
const TITLE: Record<LocalModelKind, [string, string]> = {
  stt: ['Voz → texto (Whisper)', 'Transcribe lo que dictas. Funciona sin conexión.'],
  llm: ['Redacción con IA', 'Pule, reescribe, traduce y resume tus textos dentro del teléfono, sin enviarlos a ningún servidor.']
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
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const file = (id: string): LocalModelFile | undefined => files.find((f) => f.id === id)
  const active = (m: LocalModel): boolean => (m.kind === 'stt' ? settings.sttModel : settings.localLlm) === m.id
  const select = (m: LocalModel): Promise<void> => patchSettings(m.kind === 'stt' ? { sttModel: m.id } : { localLlm: m.id })

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
    if (active(m)) await patchSettings(m.kind === 'stt' ? { sttModel: '' } : { localLlm: '' })
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

  const kinds: LocalModelKind[] = only ? [only] : ['stt', 'llm']
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
            const ready = !!f && !f.partial
            const p = progress[m.id]
            const busy = p?.state === 'downloading' || p?.state === 'verifying'
            const fit = modelFit(m, device?.ramGB ?? 0)
            const pct = p && p.total ? Math.floor((p.received / p.total) * 100) : 0
            return (
              <div key={m.id} className={`rec ${fit}`}>
                {ready && <input type="radio" name={`local-${kind}`} checked={active(m)} onChange={() => void select(m)} aria-label={`Usar ${m.label}`} />}
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
                </span>
                <em>{ready && active(m) ? '✓ En uso' : BADGE[fit]}</em>
                {busy
                  ? <button onClick={() => void window.api.cancelModel(m.id)}>Cancelar</button>
                  : ready
                    ? <button className="link" onClick={() => void remove(m)}>Borrar</button>
                    : <button className={fit === 'recommended' ? 'primary' : ''} onClick={() => void download(m)}>{f?.partial ? 'Continuar' : 'Descargar'}</button>}
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
