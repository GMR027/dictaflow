import { useEffect, useState } from 'react'
import type { BackupInfo, Diagnostics } from '@shared/diagnostics'

/**
 * Informe de diagnóstico: qué versión corre, qué motores hay instalados, qué
 * modelos, cuánto espacio se usa y si algo no está como debería.
 */
export function DiagnosticsPanel(): JSX.Element {
  const [d, setD] = useState<Diagnostics | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const load = (): void => void window.api.diagnostics().then(setD).catch((e) => setMsg((e as Error).message))
  useEffect(load, [])

  const backup = async (): Promise<void> => {
    setBusy('backup'); setMsg('')
    try {
      const r: BackupInfo = await window.api.createBackup()
      setMsg(`Copia guardada: ${r.file} (${r.sizeMB} MB, ${r.contents.length} ficheros)`)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy('') }
  }

  const restore = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setBusy('restore'); setMsg('')
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const r = await window.api.restoreBackup(bytes)
      setMsg(`Restaurados ${r.restored.length} ficheros${r.skipped.length ? `; sin claves: ${r.skipped.join(', ')}` : ''}. Reinicia la aplicación.`)
      load()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy('') }
  }

  const copy = (): void => {
    if (!d) return
    void window.api.copy(JSON.stringify(d, null, 2))
    setMsg('Informe copiado al portapapeles.')
  }

  if (!d) return <section className="card"><h2>Diagnóstico</h2><p className="muted">{msg || 'Recogiendo información…'}</p></section>

  const problemas: string[] = []
  if (!d.paths.writable) problemas.push('La carpeta de datos no se puede escribir: revisa sus permisos.')
  if (d.engines.whisper.models.length === 0) problemas.push('No hay ningún modelo de Whisper descargado.')
  if (d.engines.whisper.fallbackReason) problemas.push(`El motor elegido (${d.settings.sttEngine}) no está disponible: ${d.engines.whisper.fallbackReason}`)
  if (d.engines.piper.installed && d.engines.piper.voices.length === 0) problemas.push('El motor de voz está instalado pero no hay ninguna voz descargada.')
  if (!d.engines.ollama.installed && d.settings.sttProvider === 'local') problemas.push('Ollama no está instalado: la redacción con IA local no funcionará.')

  return (
    <section className="card">
      <h2>Diagnóstico</h2>
      <div className="row">
        <button onClick={load} disabled={!!busy}>Actualizar</button>
        <button onClick={() => void copy()}>📋 Copiar informe</button>
        <span className="muted">{msg}</span>
      </div>
      {problemas.length > 0 && (
        <ul className="warn">
          {problemas.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <table>
        <tbody>
          <tr><td><b>Aplicación</b></td><td>{d.app.version || '—'} · Electron {d.app.electron} · Node {d.app.node}</td></tr>
          <tr><td><b>Sistema</b></td><td>{d.system.platform} {d.system.release} · {d.system.arch} · {d.system.cores} núcleos</td></tr>
          <tr><td><b>CPU</b></td><td>{d.system.cpu} · AVX2 {d.hardware.cpuFlags.avx2 ? 'sí' : 'no'}</td></tr>
          <tr><td><b>Memoria</b></td><td>{d.system.ramGB} GB en total · {d.system.freeGB} GB libres</td></tr>
          <tr><td><b>GPU</b></td><td>{d.system.gpu} <span className="muted">({d.hardware.gpuVendor})</span></td></tr>
          <tr><td><b>Disco</b></td><td>{d.hardware.diskFreeGB} GB libres</td></tr>
          <tr><td><b>Motor de voz</b></td><td>{d.engines.whisper.active} · modelos: {d.engines.whisper.models.join(', ') || 'ninguno'}</td></tr>
          <tr><td><b>whisper.cpp</b></td><td>{d.engines.whispercpp.binary ? `binario en ${d.engines.whispercpp.binary}` : 'no instalado'}</td></tr>
          <tr><td><b>Voces (Piper)</b></td><td>{d.engines.piper.installed ? `motor instalado · ${d.engines.piper.voices.length} voces` : 'motor no instalado'}</td></tr>
          <tr><td><b>Ollama</b></td><td>{d.engines.ollama.installed ? (d.engines.ollama.running ? 'en marcha' : 'parado') : 'no instalado'} · {d.engines.ollama.models.length} modelos</td></tr>
          <tr><td><b>Espacio usado</b></td><td>{d.storage.dataMB} MB en total · {d.storage.modelsMB} MB de modelos · {d.storage.voicesMB} MB de voces</td></tr>
          <tr><td><b>Carpeta de datos</b></td><td><code>{d.paths.data}</code> {d.paths.writable ? '✓' : '✗ sin permiso de escritura'}</td></tr>
          <tr><td><b>Modo offline estricto</b></td><td>{d.settings.strictOffline ? 'activo' : 'desactivado'}</td></tr>
        </tbody>
      </table>

      <h3>Copia de seguridad</h3>
      <p className="muted">
        Se guarda todo lo que has creado: ajustes, biblioteca, reuniones, prompts, historial, las voces
        descargadas y los modelos. <b>Las claves de los servicios en la nube no se copian</b> (van cifradas
        con el llavero de tu sistema y no se pueden llevar a otro equipo): al restaurar, vuelve a escribirlas.
      </p>
      <div className="row">
        <button onClick={() => void backup()} disabled={!!busy}>{busy === 'backup' ? 'Guardando…' : '⬇ Crear copia de seguridad'}</button>
        <label className="btn">⬆ Restaurar desde un archivo
          <input type="file" accept=".zip" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
    </section>
  )
}
