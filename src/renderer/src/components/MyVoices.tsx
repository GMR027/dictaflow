import { useEffect, useState } from 'react'
import type { Lang, PersonalVoice, VoiceRecording } from '@shared/types'
import type { GeneratedClip } from '@shared/voice'
import { useApp } from '../store'

const cuando = (ms: number): string => new Date(ms).toLocaleString()

/**
 * «Mis voces»: las voces que el usuario ha creado a partir de sus propias
 * grabaciones, las grabaciones originales, los audios generados y las frases
 * de prueba.
 *
 * El consentimiento es obligatorio: no se guarda ninguna voz sin saying quién
 * autoriza y cuándo. Todo se queda en el equipo.
 */
export function MyVoices(): JSX.Element {
  const { flash } = useApp()
  const [voices, setVoices] = useState<PersonalVoice[]>([])
  const [recordings, setRecordings] = useState<VoiceRecording[]>([])
  const [generated, setGenerated] = useState<GeneratedClip[]>([])
  const [engine, setEngine] = useState<{ ok: boolean; message: string; url: string } | null>(null)
  const [engineUrl, setEngineUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  // Formulario de voz nueva
  const [name, setName] = useState('')
  const [lang, setLang] = useState<Lang>('es')
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
  }
  useEffect(refresh, [])

  const addRecording = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setBusy('grab'); setError('')
    try {
      const data = new Uint8Array(await f.arrayBuffer())
      const r = await window.api.addRecording(f.name, data, speaker || 'Sin nombre', 0)
      setRecordings((all) => [r, ...all])
      flash(`Grabación añadida: ${r.name}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  const addVoice = async (): Promise<void> => {
    setError('')
    try {
      const v = await window.api.savePersonalVoice({
        id: crypto.randomUUID(),
        name: name.trim(),
        engine: 'servicio-local',
        lang,
        sampleId: sampleId || undefined,
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
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="view split">
      <section className="card side">
        <header><h2>🎙 Mis voces</h2></header>
        {engine && (
          <p className={engine.ok ? 'ok' : 'warn'}>
            {engine.ok ? '✓ ' : '⚠ '}{engine.message}
          </p>
        )}
        <div className="row">
          <input className="grow" value={engineUrl} onChange={(e) => setEngineUrl(e.target.value)} placeholder="http://127.0.0.1:8020" />
          <button onClick={() => void window.api.setCloneEngineUrl(engineUrl).then(refresh)}>Guardar</button>
        </div>
        <p className="muted">
          El motor de clonación es un servicio local que tú pones en marcha. Esta versión no incluye
          ninguno dentro: los que existen ocupan entre 2 y 3 GB y algunos no se pueden usar
          comercialmente. Todo lo demás (grabaciones, voces, audios) sí vive en tu equipo.
        </p>
        <div className="list">
          {voices.length === 0 && <p className="muted">Todavía no has creado ninguna voz.</p>}
          {voices.map((v) => (
            <div key={v.id} className="item pick">
              <b>{v.name}</b> <small className="muted">· {v.lang === 'es' ? 'español' : 'inglés'}</small><br />
              <small className="muted">
                Autoriza: {v.consent.authorizedBy} · {cuando(v.consent.date)}
              </small><br />
              <button className="link" onClick={() => void test(v)}>🔊 Probar</button>
              <button className="link" onClick={() => void window.api.removePersonalVoice(v.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card wide">
        <h2>Crear una voz</h2>
        <p className="warn">
          Solo clona tu propia voz o la de alguien que te haya dado permiso. Al guardar se anota
          quién autoriza y cuándo; ese dato se guarda con la voz y va en las copias de seguridad.
        </p>
        <div className="row">
          <input className="grow" placeholder="Nombre de la voz" value={name} onChange={(e) => setName(e.target.value)} />
          <label>Idioma
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
        </div>
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
          <button className="primary" onClick={() => void addVoice()} disabled={!name.trim() || !authorizedBy.trim()}>Guardar voz</button>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}

        <h2>Grabaciones originales</h2>
        <p className="muted">Los audios de partida. Se guardan aparte de los modelos derivados.</p>
        <div className="row">
          <label className="btn">+ Añadir grabación
            <input type="file" accept="audio/*" hidden onChange={(e) => { void addRecording(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <input placeholder="De quién es la voz" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
        </div>
        <div className="list">
          {recordings.length === 0 && <p className="muted">No hay grabaciones.</p>}
          {recordings.map((r) => (
            <div key={r.id} className="item pick">
              <b>{r.name}</b> · {r.speaker}<br />
              <small className="muted">{cuando(r.createdAt)}</small>
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
              <small className="muted">{g.text.slice(0, 90)} · {cuando(g.createdAt)}</small>
              <button className="link" onClick={() => void window.api.removeGenerated(g.id).then(refresh)}>quitar</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
