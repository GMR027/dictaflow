import { useEffect, useState } from 'react'
import type { HardwareInfo, HwProfile, HwProfileSetting, SttEngine } from '@shared/types'
import { classify, PROFILES, type Classification } from '@shared/profiles'
import { useApp } from '../store'

type Status = Awaited<ReturnType<typeof window.api.sttStatus>>

const MODELS: Record<string, string> = {
  'Xenova/whisper-tiny': 'tiny · 75 MB · muy rápido, errores frecuentes en español',
  'Xenova/whisper-base': 'base · 145 MB · rápido, precisión aceptable',
  'Xenova/whisper-small': 'small · 480 MB · buen equilibrio (recomendado)',
  'Xenova/whisper-medium': 'medium · 1,5 GB · el más preciso, lento en CPU'
}

function Help({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="muted help">{children}</p>
}

export function Performance(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [cls, setCls] = useState<Classification | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = (): void => void window.api.sttStatus().then(setStatus)
  useEffect(() => {
    void window.api.detectHardware().then(({ hw }) => { setHw(hw); setCls(classify(hw)) })
    refresh()
    return window.api.onSttProgress((p) => {
      if (p.file?.startsWith('ggml-')) setMsg(p.status === 'done' ? '' : `${p.file} ${Math.round(p.progress ?? 0)}%`)
    })
  }, [])

  const apply = (id: HwProfile): Promise<void> => patchSettings({ hwProfile: id, ...PROFILES[id].settings })
  const choose = async (v: HwProfileSetting): Promise<void> => {
    if (v === 'auto') {
      await patchSettings({ hwProfile: 'auto', ...(cls ? PROFILES[cls.profile].settings : {}) })
    } else await apply(v)
  }
  const detect = async (): Promise<void> => {
    if (!hw) return
    setBusy('bench'); setMsg('Midiendo la velocidad de la voz en este equipo…')
    try {
      const b = await window.api.benchStt()
      const c = classify(hw, { model: b.model, ms: b.ms })
      setCls(c)
      setMsg(`Prueba: 3 s de audio se transcriben en ${b.ms} ms (${b.engine}); carga del modelo ${b.loadMs} ms. Perfil sugerido: ${PROFILES[c.profile].label}.`)
      if (settings.hwProfile === 'auto') await patchSettings({ hwProfile: 'auto', ...PROFILES[c.profile].settings })
    } catch (e) { setMsg('✗ ' + (e as Error).message) } finally { setBusy('') }
  }
  const getGgml = async (id: string): Promise<void> => {
    setBusy(id)
    try { await window.api.downloadGgml(id); await patchSettings({ whisperCpp: { ...settings.whisperCpp, model: '' } }); refresh() }
    catch (e) { setMsg('✗ ' + (e as Error).message) } finally { setBusy(''); }
  }

  const eff = settings.hwProfile === 'auto' ? cls?.profile : settings.hwProfile
  return (
    <>
      <section className="card">
        <h2>Perfil de rendimiento</h2>
        <p className="muted">Agrupa los ajustes de abajo según lo que aguanta tu equipo. Elegir un perfil cambia el modelo de voz, los borradores y la redacción automática; después puedes ajustar cada cosa por separado.</p>
        {hw && <p className="muted">Equipo: {hw.cpu} · {hw.cores} núcleos · {hw.ramGB} GB RAM · AVX2 {hw.cpuFlags.avx2 ? 'sí' : 'no'} · GPU: {hw.gpu}</p>}
        <div className="services" role="radiogroup" aria-label="Perfil de rendimiento">
          <button role="radio" aria-checked={settings.hwProfile === 'auto'} className={`service ${settings.hwProfile === 'auto' ? 'on' : ''}`} onClick={() => void choose('auto')}>
            <b>Automático</b>
            <span className="muted">DictaFlow decide según RAM, CPU, GPU y una prueba corta{cls ? `: ${PROFILES[cls.profile].label}` : ''}</span>
          </button>
          {(Object.keys(PROFILES) as HwProfile[]).map((id) => (
            <button key={id} role="radio" aria-checked={settings.hwProfile === id} className={`service ${settings.hwProfile === id ? 'on' : ''}`} onClick={() => void choose(id)}>
              <b>{PROFILES[id].label}</b><span className="muted">{PROFILES[id].summary}</span>
            </button>
          ))}
        </div>
        {eff && <p className="muted">{PROFILES[eff].detail}</p>}
        {cls && <p className="muted">Por qué: {cls.reasons.join('; ')}.</p>}
        <div className="row">
          <button onClick={() => void detect()} disabled={!hw || !!busy}>{busy === 'bench' ? 'Midiendo…' : '⏱ Probar velocidad de este equipo'}</button>
          <span className="muted">{msg}</span>
        </div>
        <Help>La prueba transcribe 3 s de audio con el motor activo y, si el perfil es Automático, lo ajusta al resultado. Carga el modelo si no estaba cargado.</Help>
      </section>

      <section className="card">
        <h2>Motor de voz</h2>
        <p className="muted">Puedes tener los dos instalados y elegir cuál usar. Si el elegido no está disponible, DictaFlow usa Transformers.js para no interrumpir el dictado y te lo indica aquí.</p>
        <div className="services" role="radiogroup" aria-label="Motor de voz">
          {([['transformers', 'Whisper · Transformers.js', 'Incluido en la aplicación. Solo CPU. Funciona en cualquier equipo compatible.'],
            ['whispercpp', 'whisper.cpp', 'Servidor externo (whisper-server). Admite modelos cuantizados y, si lo compilas con soporte de GPU (Vulkan en AMD), puede usarla.']] as [SttEngine, string, string][]).map(([k, label, sum]) => (
            <button key={k} role="radio" aria-checked={settings.sttEngine === k} className={`service ${settings.sttEngine === k ? 'on' : ''}`}
              onClick={() => void patchSettings({ sttEngine: k }).then(refresh)}>
              <b>{label}</b><span className="muted">{sum}</span>
              {status?.active === k && <span className="ok">En uso</span>}
            </button>
          ))}
        </div>
        {status?.fallbackReason && settings.sttEngine === 'whispercpp' && <p className="warn" role="alert">whisper.cpp no está disponible, se usa Transformers.js: {status.fallbackReason}</p>}
        {settings.sttEngine === 'transformers' && (
          <label>Modelo de Whisper
            <select value={settings.sttModel} onChange={(e) => void patchSettings({ sttModel: e.target.value })}>
              {!(settings.sttModel in MODELS) && <option value={settings.sttModel}>{settings.sttModel}</option>}
              {Object.entries(MODELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
          </label>
        )}
        {settings.sttEngine === 'whispercpp' && (
          <>
            <label>Ruta de whisper-server <span className={status?.cpp.bin ? 'ok' : 'warn'}>{status?.cpp.bin ? '· encontrado' : '· no encontrado'}</span>
              <input value={settings.whisperCpp.bin} placeholder={status?.cpp.bin || 'Vacío: se busca en el PATH'}
                onChange={(e) => void patchSettings({ whisperCpp: { ...settings.whisperCpp, bin: e.target.value } }).then(refresh)} />
            </label>
            {!status?.cpp.bin && <p className="muted">Instalación: <code>git clone https://github.com/ggml-org/whisper.cpp &amp;&amp; cd whisper.cpp &amp;&amp; cmake -B build &amp;&amp; cmake --build build -j --config Release</code>; el binario queda en <code>build/bin/whisper-server</code>. Para GPU AMD añade <code>-DGGML_VULKAN=1</code> al primer comando de cmake.</p>}
            <label>Modelo ggml (ruta)
              <input value={settings.whisperCpp.model} placeholder={status?.cpp.model || 'Vacío: se usa uno de los descargados abajo'}
                onChange={(e) => void patchSettings({ whisperCpp: { ...settings.whisperCpp, model: e.target.value } }).then(refresh)} />
            </label>
            {status?.cpp.ggml.map((m) => (
              <div key={m.id} className="rec ok">
                <span><b>{m.label}</b> <small>~{m.sizeMB} MB</small></span>
                {m.installed ? <em className="ok">✓ descargado</em> : <button onClick={() => void getGgml(m.id)} disabled={!!busy}>{busy === m.id ? `Descargando… ${msg}` : 'Descargar'}</button>}
              </div>
            ))}
          </>
        )}
      </section>

      <section className="card">
        <h2>Transcripción</h2>
        <label className="inline check">
          <input type="checkbox" checked={settings.draftsEnabled} onChange={(e) => void patchSettings({ draftsEnabled: e.target.checked })} /> Texto provisional mientras hablas
        </label>
        <Help>Muestra en gris lo que va entendiendo de la frase en curso. Cuesta CPU porque retranscribe el audio cada pocos segundos; en equipos lentos conviene apagarlo para que la transcripción final salga antes.</Help>
        <label>Pausa que cierra una frase: {settings.pauseMs} ms
          <input type="range" min={500} max={1600} step={50} value={settings.pauseMs} onChange={(e) => void patchSettings({ pauseMs: Number(e.target.value) })} />
        </label>
        <Help>Solo en «Parlante activo». Es el silencio que debe haber para que se considere terminada una frase y se transcriba. Menos tiempo = el texto aparece antes, pero se corta si dudas a mitad de frase. Más tiempo = frases más completas y precisas, con más espera.</Help>
        <h3>Procesado del micrófono</h3>
        <label className="inline check">
          <input type="checkbox" checked={settings.micFilters.echoCancellation} onChange={(e) => void patchSettings({ micFilters: { ...settings.micFilters, echoCancellation: e.target.checked } })} /> Cancelación de eco
        </label>
        <label className="inline check">
          <input type="checkbox" checked={settings.micFilters.noiseSuppression} onChange={(e) => void patchSettings({ micFilters: { ...settings.micFilters, noiseSuppression: e.target.checked } })} /> Supresión de ruido
        </label>
        <label className="inline check">
          <input type="checkbox" checked={settings.micFilters.autoGainControl} onChange={(e) => void patchSettings({ micFilters: { ...settings.micFilters, autoGainControl: e.target.checked } })} /> Control automático de ganancia
        </label>
        <Help>Son los filtros que aplica el navegador antes de que el audio llegue a Whisper. La supresión de ruido y el control de ganancia suelen <b>empeorar</b> la precisión del reconocimiento y consumen CPU. La cancelación de eco conviene dejarla si hablas con el altavoz encendido. <button className="link" onClick={() => void patchSettings({ micFilters: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } })}>Usar lo recomendado para reconocer voz</button></Help>
      </section>

      <section className="card">
        <h2>Redacción con IA</h2>
        <label className="inline check">
          <input type="checkbox" checked={settings.autoRewrite} onChange={(e) => void patchSettings({ autoRewrite: e.target.checked })} /> Redactar automáticamente
        </label>
        <Help>Redacta solo cuando termina de transcribir. La transcripción original se muestra siempre primero, sin esperar a la IA. Si lo apagas, redactas con el botón cuando quieras.</Help>
        <label>Espera antes de redactar: {(settings.rewriteDelayMs / 1000).toFixed(1)} s
          <input type="range" min={500} max={6000} step={250} value={settings.rewriteDelayMs} onChange={(e) => void patchSettings({ rewriteDelayMs: Number(e.target.value) })} />
        </label>
        <Help>Tiempo desde la última frase hasta que se envía a la IA. Si sigues dictando, se espera de nuevo. Menos = el texto redactado llega antes, pero se lanzan más peticiones al modelo.</Help>
        <label className="inline check">
          <input type="checkbox" checked={settings.rewriteIncremental} onChange={(e) => void patchSettings({ rewriteIncremental: e.target.checked })} /> Redactar solo lo nuevo
        </label>
        <Help>En automático, cada vez se redacta únicamente lo dictado desde la última redacción y se añade al final. El tiempo de la IA no crece con la longitud del dictado. Si lo desactivas, se rehace todo el texto cada vez (más coherencia entre frases, más lento). «Rehacer» y el modo prompt siempre procesan todo.</Help>
        <label className="inline check">
          <input type="checkbox" checked={settings.guardNumbers} onChange={(e) => void patchSettings({ guardNumbers: e.target.checked })} /> Proteger cifras y horas
        </label>
        <Help>Si la IA cambia números, horas o cantidades (por ejemplo «cinco y media» → «5:30», o «tres» → «cuatro»), reintenta una vez y, si persiste, conserva tu texto dictado y te avisa. Escribir los números en cifras o en palabras es equivalente.</Help>
      </section>
    </>
  )
}
