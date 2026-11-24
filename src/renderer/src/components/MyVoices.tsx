import { useEffect, useRef, useState } from 'react'
import type { Lang, PersonalVoice, VoiceRecording } from '@shared/types'
import type { GeneratedClip } from '@shared/voice'
import { REFERENCE_SCRIPT, TEST_PHRASES } from '@shared/voice-phrases'
import { createMic, SAMPLE_RATE, type MicLike } from '../audio'
import { decodeToMono16k, encodeWav } from '../audioio'
import { useApp } from '../store'
import { useTtsStatus, VoicePicker } from './TtsSetup'
import { RecButton } from './RecButton'

const cuando = (ms: number): string => new Date(ms).toLocaleString()
const dur = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/**
 * «Mis voces»: las voces que el usuario ha creado, las grabaciones originales,
 * los audios generados y las frases de prueba.
 *
 * Una voz personal puede usar una voz local de Piper (funciona sin conexión y
 * sin descargar modelos de 2–3 GB) o un servicio local de clonación que el
 * usuario ponga en marcha. El consentimiento es obligatorio.
 */
export function MyVoices(): JSX.Element {
  const { flash, settings, patchSettings } = useApp()
  const [voices, setVoices] = useState<PersonalVoice[]>([])
  const [recordings, setRecordings] = useState<VoiceRecording[]>([])
  const [generated, setGenerated] = useState<GeneratedClip[]>([])
  const [engine, setEngine] = useState<{ ok: boolean; message: string; url: string } | null>(null)
  const [engineUrl, setEngineUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [playing, setPlaying] = useState('')
  const [tts, refreshTts] = useTtsStatus()

  // Formulario de voz nueva
  const [name, setName] = useState('')
  const [lang, setLang] = useState<Lang>('es')
  const [engineKind, setEngineKind] = useState<'piper' | 'servicio-local'>('piper')
  const [piperVoice, setPiperVoice] = useState(settings.ttsVoice.es)
  const [sampleId, setSampleId] = useState('')
  const [authorizedBy, setAuthorizedBy] = useState('')
  const [consentNotes, setConsentNotes] = useState('')
  const [testPhrase, setTestPhrase] = useState('Esta es una prueba de mi voz.')
  const [speaker, setSpeaker] = useState('')
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [recSec, setRecSec] = useState(0)
  const mic = useRef<MicLike | null>(null)
  const recStart = useRef(0)

  const refresh = (): void => {
    void window.api.listPersonalVoices().then(setVoices)
    void window.api.listRecordings().then(setRecordings)
    void window.api.listGenerated().then(setGenerated)
    void window.api.cloneEngine().then((e) => { setEngine(e); setEngineUrl(e.url) })
    refreshTts()
  }
  useEffect(refresh, [])

  useEffect(() => {
    if (engineKind === 'piper') setPiperVoice(settings.ttsVoice[lang])
  }, [lang, engineKind, settings.ttsVoice])
  // Si la frase de prueba es una de ejemplo, cambia con el idioma.
  useEffect(() => {
    setTestPhrase((t) => (TEST_PHRASES.es.includes(t) || TEST_PHRASES.en.includes(t) || t === 'Esta es una prueba de mi voz.' ? TEST_PHRASES[lang][0] : t))
  }, [lang])
  useEffect(() => () => { void mic.current?.stop(true) }, [])
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setRecSec((Date.now() - recStart.current) / 1000), 500)
    return () => clearInterval(id)
  }, [recording])

  const play = async (path: string): Promise<void> => {
    setError('')
    setPlaying(path)
    try {
      const bytes = await window.api.personalAudio(path)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
      const a = new Audio(url)
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); setPlaying('') }
      await a.play()
    } catch (e) {
      setError((e as Error).message)
      setPlaying('')
    }
  }

  const saveRecording = async (fileName: string, pcm: Float32Array): Promise<void> => {
    const r = await window.api.addRecording(fileName, encodeWav(pcm), speaker || authorizedBy || 'Sin nombre', pcm.length / SAMPLE_RATE)
    setRecordings((all) => [r, ...all])
    setSampleId(r.id)
    flash(`Grabación añadida: ${r.name}`)
  }

  const addRecording = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setBusy('grab'); setError('')
    try {
      // Cualquier formato (mp3, m4a, ogg…) se convierte a WAV mono 16 kHz:
      // así se puede reproducir y la duración es real.
      const pcm = await decodeToMono16k(new Uint8Array(await f.arrayBuffer()))
      await saveRecording(f.name.replace(/\.[^.]+$/, '') + '.wav', pcm)
    } catch (e) { setError(`No se pudo leer el audio: ${(e as Error).message}`) } finally { setBusy('') }
  }

  /** Graba la muestra de referencia leyendo el guion en voz alta. */
  const toggleRecord = async (): Promise<void> => {
    setError('')
    if (mic.current) {
      await mic.current.stop(); mic.current = null; setRecording(false); setLevel(0)
      return
    }
    const m = createMic({
      deviceId: settings.micDeviceId, mode: 'controlled', onLevel: setLevel,
      // Sin supresión de ruido ni ganancia automática: la muestra debe sonar como tu voz real.
      filters: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      onSegment: (pcm) => {
        if (pcm.length < SAMPLE_RATE * 5) { setError('La muestra es muy corta: lee el texto completo (unos 30 segundos).'); return }
        void saveRecording(`muestra-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`, pcm).catch((e: Error) => setError(e.message))
      },
      onEnded: () => { setRecording(false); setLevel(0) }
    })
    try { await m.start(); mic.current = m; recStart.current = Date.now(); setRecSec(0); setRecording(true) }
    catch (e) { setError(`Micrófono: ${(e as Error).message}`) }
  }

  const addVoice = async (): Promise<void> => {
    setError('')
    try {
      const v = await window.api.savePersonalVoice({
        id: crypto.randomUUID(),
        name: name.trim(),
        engine: engineKind,
        lang,
        sampleId: sampleId || undefined,
        piperVoice: engineKind === 'piper' ? piperVoice : undefined,
        consent: { authorizedBy: authorizedBy.trim(), date: Date.now(), notes: consentNotes },
        createdAt: Date.now(),
        testPhrase,
        available: false
      })
      setVoices((all) => [v, ...all])
      setName(''); setAuthorizedBy(''); setConsentNotes('')
      refresh()
    } catch (e) { setError((e as Error).message) }
  }

  const test = async (v: PersonalVoice): Promise<void> => {
    setError('')
    try {
      const r = await window.api.synthesizePersonal(v.id, v.testPhrase)
      flash(`Audio generado: ${r.path}`)
      refresh()
      void play(r.path)
    } catch (e) { setError((e as Error).message) }
  }

  const piperVoices = (tts?.catalog ?? []).filter((v) => v.installed && v.langs.includes(lang))

  const ANDROID = window.api.platform === 'android'
  const voiceList = (
    <div className="list voices">
      {voices.length === 0 && <p className="muted">Todavía no has creado ninguna voz. Empieza abajo: son cuatro pasos.</p>}
      {voices.map((v) => (
        <div key={v.id} className="item voice-card">
          <div className="grow">
            <b>{v.name}</b> <small className="muted">· {v.lang === 'es' ? 'español' : 'inglés'} · {v.engine === 'piper' ? 'voz local' : 'clonación'}</small><br />
            <small className="muted">Autoriza: {v.consent.authorizedBy} · {cuando(v.consent.date)}</small>
            {!v.available && <p className="warn">{v.unavailableReason ?? 'No disponible ahora mismo.'}</p>}
          </div>
          <button onClick={() => void test(v)}>▶ Probar</button>
          <button className="link" onClick={() => void window.api.removePersonalVoice(v.id).then(refresh)}>quitar</button>
        </div>
      ))}
    </div>
  )

  return (
    <div className={`view ${ANDROID ? '' : 'split'} my-voices`}>
      <section className={`card ${ANDROID ? '' : 'side'}`}>
        <header><h2>🎙 Mis voces</h2></header>
        {voiceList}
      </section>

      <section className="card wide">
        <h2>Crear una voz</h2>
        <p className="muted">Solo usa tu propia voz o la de alguien que te haya dado permiso. Al guardar se anota quién autoriza y cuándo.</p>

        <div className="step">
          <span className="step-n">1</span>
          <div className="step-body">
            <h3>Nombre e idioma</h3>
            <div className="form-grid">
              <label>Nombre de la voz
                <input placeholder="p. ej. «Mi voz de trabajo»" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>Idioma
                <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  <option value="es">Español</option><option value="en">English</option>
                </select>
              </label>
              {!ANDROID && (
                <label>Motor
                  <select value={engineKind} onChange={(e) => setEngineKind(e.target.value as 'piper' | 'servicio-local')}>
                    <option value="piper">Voz local (Piper)</option>
                    <option value="servicio-local">Clonación (servicio local)</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="step">
          <span className="step-n">2</span>
          <div className="step-body">
            <h3>{engineKind === 'piper' ? 'Voz que leerá' : 'Servicio de clonación'}</h3>
            {engineKind === 'piper' && (piperVoices.length ? (
              <div className="form-grid">
                <label>Voz local
                  <select value={piperVoice} onChange={(e) => setPiperVoice(e.target.value)}>
                    {piperVoices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <>
                <p className="warn">No hay ninguna voz local descargada para {lang === 'es' ? 'español' : 'inglés'}.</p>
                <VoicePicker lang={lang} value={piperVoice} onChange={setPiperVoice} info={tts} onChanged={refreshTts} />
              </>
            ))}
            {engineKind === 'piper' && <p className="muted">Funciona sin conexión. {ANDROID ? 'En el teléfono las voces personales usan una voz local; la muestra que grabes sirve para clonarla en la app de escritorio.' : ''}</p>}
            {engineKind === 'servicio-local' && (
              <>
                {engine && <p className={engine.ok ? 'ok' : 'warn'}>{engine.ok ? '✓ ' : '⚠ '}{engine.message}</p>}
                <div className="row">
                  <input className="grow" value={engineUrl} onChange={(e) => setEngineUrl(e.target.value)} placeholder="http://127.0.0.1:8020" aria-label="Dirección del servicio de clonación" />
                  <button onClick={() => void window.api.setCloneEngineUrl(engineUrl).then(refresh)}>Guardar</button>
                </div>
                <p className="muted">Un servicio local que tú pones en marcha; DictaFlow no incluye ninguno.</p>
              </>
            )}
          </div>
        </div>

        <div className="step">
          <span className="step-n">3</span>
          <div className="step-body">
            <h3>Muestra de tu voz</h3>
            <p className="muted">Lee este texto en voz alta, con calma y en un sitio silencioso (unos 30 segundos). Mantén el teléfono a un palmo de la boca.</p>
            <blockquote className="script">{REFERENCE_SCRIPT[lang]}</blockquote>
            <div className="source-pick">
              <RecButton recording={recording} level={level} onClick={() => void toggleRecord()} idle="Grabar muestra" active="Terminar"
                hint={recording ? `${Math.floor(recSec)} s${recSec < 20 ? ' · sigue leyendo' : ' · ¡bien!'}` : undefined} />
              <label className="btn">{busy === 'grab' ? 'Leyendo…' : '📁 Subir un audio'}
                <input type="file" accept="audio/*" hidden onChange={(e) => { void addRecording(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            </div>
            <div className="form-grid">
              <label>De quién es la voz
                <input placeholder="Nombre de quien habla" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
              </label>
              <label>Grabación de referencia
                <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
                  <option value="">(ninguna)</option>
                  {recordings.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.speaker}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="step">
          <span className="step-n">4</span>
          <div className="step-body">
            <h3>Frase de prueba y permiso</h3>
            <div className="form-grid">
              <label className="full">Frase de prueba
                <input placeholder="Lo que dirá la voz al probarla" value={testPhrase} onChange={(e) => setTestPhrase(e.target.value)} />
              </label>
            </div>
            <div className="chips scroll" aria-label="Frases de ejemplo">
              {TEST_PHRASES[lang].map((f) => (
                <button key={f} className={`chip ${testPhrase === f ? 'on' : ''}`} onClick={() => setTestPhrase(f)} title={f}>{f.length > 38 ? f.slice(0, 36) + '…' : f}</button>
              ))}
            </div>
            <div className="form-grid">
              <label>Autoriza el uso de esta voz
                <input placeholder="Tu nombre (obligatorio)" value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} />
              </label>
              <label>Notas del consentimiento
                <input placeholder="p. ej. uso personal" value={consentNotes} onChange={(e) => setConsentNotes(e.target.value)} />
              </label>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => void addVoice()} disabled={!name.trim() || !authorizedBy.trim() || (engineKind === 'piper' && !piperVoice)}>💾 Guardar voz</button>
              {engineKind === 'piper' && piperVoice && (
                <button className="link" onClick={() => void patchSettings({ ttsVoice: { ...settings.ttsVoice, [lang]: piperVoice } })}>Usar esta voz también en Texto → Voz</button>
              )}
            </div>
          </div>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}

        <details className="opts" open={!ANDROID}>
          <summary>Grabaciones originales ({recordings.length})</summary>
          <div className="list">
            {recordings.length === 0 && <p className="muted">No hay grabaciones.</p>}
            {recordings.map((r) => (
              <div key={r.id} className="item voice-card">
                <div className="grow"><b>{r.name}</b> · {r.speaker}<br /><small className="muted">{cuando(r.createdAt)} · {dur(r.durationSec)}</small></div>
                <button onClick={() => void play(r.path)} disabled={playing === r.path}>{playing === r.path ? '🔊' : '▶'}</button>
                <button className="link" onClick={() => void window.api.removeRecording(r.id).then(refresh)}>quitar</button>
              </div>
            ))}
          </div>
        </details>

        <details className="opts">
          <summary>Audios generados ({generated.length})</summary>
          <div className="list">
            {generated.length === 0 && <p className="muted">Todavía no has generado audios con tus voces.</p>}
            {generated.map((g) => (
              <div key={g.id} className="item voice-card">
                <div className="grow"><b>{g.voiceName}</b><br /><small className="muted">{g.text.slice(0, 90)} · {cuando(g.createdAt)} · {dur(g.durationSec)}</small></div>
                <button onClick={() => void play(g.path)} disabled={playing === g.path}>{playing === g.path ? '🔊' : '▶'}</button>
                <button className="link" onClick={() => void window.api.removeGenerated(g.id).then(refresh)}>quitar</button>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  )
}
