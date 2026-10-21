import { useEffect, useState } from 'react'
import type { Lang, PersonalVoice, VoiceRecording } from '@shared/types'
import type { GeneratedClip } from '@shared/voice'
import { SAMPLE_RATE } from '../audio'
import { decodeToMono16k, encodeWav } from '../audioio'
import { useApp } from '../store'
import { useTtsStatus, VoicePicker } from './TtsSetup'

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

  const addRecording = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setBusy('grab'); setError('')
    try {
      // Cualquier formato (mp3, m4a, ogg…) se convierte a WAV mono 16 kHz:
      // así se puede reproducir y la duración es real.
      const pcm = await decodeToMono16k(new Uint8Array(await f.arrayBuffer()))
      const wav = encodeWav(pcm)
      const r = await window.api.addRecording(f.name.replace(/\.[^.]+$/, '') + '.wav', wav, speaker || 'Sin nombre', pcm.length / SAMPLE_RATE)
      setRecordings((all) => [r, ...all])
      flash(`Grabación añadida: ${r.name}`)
    } catch (e) { setError(`No se pudo leer el audio: ${(e as Error).message}`) } finally { setBusy('') }
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

  return (
    <div className="view split">
      <section className="card side">
        <header><h2>🎙 Mis voces</h2></header>
        {engineKind === 'servicio-local' && engine && (
          <p className={engine.ok ? 'ok' : 'warn'}>
            {engine.ok ? '✓ ' : '⚠ '}{engine.message}
          </p>
        )}
        {engineKind === 'servicio-local' && (
          <>
            <div className="row">
              <input className="grow" value={engineUrl} onChange={(e) => setEngineUrl(e.target.value)} placeholder="http://127.0.0.1:8020" />
              <button onClick={() => void window.api.setCloneEngineUrl(engineUrl).then(refresh)}>Guardar</button>
            </div>
            <p className="muted">
              El motor de clonación es opcional: un servicio local que tú pones en marcha. Esta versión no incluye
              ninguno dentro; la opción «Voz local (Piper)» funciona sin instalar nada más.
            </p>
          </>
        )}
        <div className="list">
          {voices.length === 0 && <p className="muted">Todavía no has creado ninguna voz.</p>}
          {voices.map((v) => (
            <div key={v.id} className="item pick">
              <b>{v.name}</b> <small className="muted">· {v.lang === 'es' ? 'español' : 'inglés'} · {v.engine === 'piper' ? 'voz local' : 'clonación'}</small><br />
              <small className="muted">
                Autoriza: {v.consent.authorizedBy} · {cuando(v.consent.date)}
              </small><br />
              <button className="link" onClick={() => void test(v)}>🔊 Probar</button>
              <button className="link" onClick={() => void window.api.removePersonalVoice(v.id).then(refresh)}>quitar</button>
              {!v.available && <p className="warn">{v.unavailableReason ?? 'No disponible ahora mismo.'}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="card wide">
        <h2>Crear una voz</h2>
        <p className="warn">
          Solo usa tu propia voz o la de alguien que te haya dado permiso. Al guardar se anota
          quién autoriza y cuándo; ese dato se guarda con la voz y va en las copias de seguridad.
        </p>
        <div className="row">
          <input className="grow" placeholder="Nombre de la voz" value={name} onChange={(e) => setName(e.target.value)} />
          <label>Idioma
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
          <label>Motor
            <select value={engineKind} onChange={(e) => setEngineKind(e.target.value as 'piper' | 'servicio-local')}>
              <option value="piper">Voz local (Piper)</option>
              <option value="servicio-local">Clonación (servicio local)</option>
            </select>
          </label>
        </div>
        {engineKind === 'piper' && (
          <div className="row">
            {piperVoices.length ? (
              <label className="grow">Voz que leerá
                <select value={piperVoice} onChange={(e) => setPiperVoice(e.target.value)}>
                  {piperVoices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
            ) : (
              <div className="grow">
                <p className="warn">No hay ninguna voz local descargada para {lang === 'es' ? 'español' : 'inglés'}.</p>
                <VoicePicker lang={lang} value={piperVoice} onChange={setPiperVoice} info={tts} onChanged={refreshTts} />
              </div>
            )}
            <p className="muted">La voz local funciona sin conexión y sin descargar un motor de clonación.</p>
          </div>
        )}
        <div className="row">
          <label className="grow">Grabación de referencia
            <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
              <option value="">(ninguna)</option>
              {recordings.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.speaker}</option>)}
            </select>
          </label>
          <label className="grow">Frase de prueba
            <input value={testPhrase} onChange={(e) => setTestPhrase(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="grow">Autoriza el uso de esta voz
            <input placeholder="Tu nombre (obligatorio)" value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} />
          </label>
          <label className="grow">Notas del consentimiento
            <input placeholder="p. ej. uso personal" value={consentNotes} onChange={(e) => setConsentNotes(e.target.value)} />
          </label>
          <button className="primary" onClick={() => void addVoice()} disabled={!name.trim() || !authorizedBy.trim() || (engineKind === 'piper' && !piperVoice)}>Guardar voz</button>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}

        <h2>Grabaciones originales</h2>
        <p className="muted">Los audios de partida. Se convierten a WAV para poder escucharlos aquí mismo.</p>
        <div className="row">
          <label className="btn">{busy === 'grab' ? 'Leyendo…' : '+ Añadir grabación'}
            <input type="file" accept="audio/*" hidden onChange={(e) => { void addRecording(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <input placeholder="De quién es la voz" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
        </div>
        <div className="list">
          {recordings.length === 0 && <p className="muted">No hay grabaciones.</p>}
          {recordings.map((r) => (
            <div key={r.id} className="item pick">
              <b>{r.name}</b> · {r.speaker}<br />
              <small className="muted">{cuando(r.createdAt)} · {dur(r.durationSec)}</small>
              <button className="link" onClick={() => void play(r.path)} disabled={playing === r.path}>
                {playing === r.path ? '🔊 Reproduciendo…' : '▶ Escuchar'}
              </button>
              <button className="link" onClick={() => void window.api.removeRecording(r.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>

        <h2>Audios generados</h2>
        <div className="list">
          {generated.length === 0 && <p className="muted">Todavía no has generado audios con tus voces.</p>}
          {generated.map((g) => (
            <div key={g.id} className="item pick">
              <b>{g.voiceName}</b><br />
              <small className="muted">{g.text.slice(0, 90)} · {cuando(g.createdAt)} · {dur(g.durationSec)}</small>
              <button className="link" onClick={() => void play(g.path)} disabled={playing === g.path}>
                {playing === g.path ? '🔊 Reproduciendo…' : '▶ Escuchar'}
              </button>
              <button className="link" onClick={() => void window.api.removeGenerated(g.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
        <p className="muted">
          Consejo: para usar una voz local en el lector y en texto a voz, elige el mismo catálogo en
          Ajustes → Audio. Las voces personales se guardan en tu equipo.
        </p>
        <button className="link" onClick={() => void patchSettings({ ttsVoice: { ...settings.ttsVoice, [lang]: piperVoice } })} disabled={engineKind !== 'piper'}>
          Usar «{piperVoice}» también en Texto → Voz
        </button>
      </section>
    </div>
  )
}
