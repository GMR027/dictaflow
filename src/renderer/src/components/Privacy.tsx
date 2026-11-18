import { useEffect, useState } from 'react'
import type { NetEvent } from '@shared/types'
import { useApp } from '../store'

const ANDROID = window.api.platform === 'android'

export function Privacy(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [events, setEvents] = useState<NetEvent[]>([])
  const [dir, setDir] = useState('')

  const refresh = async (): Promise<void> => {
    const r = await window.api.getNetEvents()
    setEvents(r.events)
    setDir(r.dataDir)
  }
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="view">
      <section className="card">
        <h2>Privacidad</h2>
        <label className="inline check">
          <input type="checkbox" checked={settings.strictOffline} onChange={(e) => void patchSettings({ strictOffline: e.target.checked })} />
          {ANDROID
            ? 'Modo offline estricto: bloquea toda conexión a internet'
            : 'Modo offline estricto: bloquea cualquier conexión que no sea a tu propio equipo'}
        </label>
        <p className="muted">{ANDROID
          ? 'Tu voz, tus textos y tus documentos se procesan dentro del teléfono. La app solo se conecta para descargar modelos y voces y para buscar actualizaciones.'
          : 'La transcripción de voz siempre se hace en tu equipo. Solo el texto de redacción sale si eliges un servicio en la nube.'}</p>
        <p>Tus datos están en <code>{dir}</code> {window.api.platform !== 'android' && <button onClick={() => void window.api.openDataDir()}>Abrir carpeta</button>}</p>
      </section>
      <section className="card grow">
        <header>
          <h2>Actividad de red</h2>
          <button onClick={() => void window.api.clearNetEvents().then(refresh)}>Limpiar</button>
        </header>
        {events.length === 0
          ? <p className="ok">Sin conexiones externas en esta sesión.</p>
          : ANDROID
            ? (
              // En el teléfono una tabla de 4 columnas no cabe: una línea por conexión.
              <ul className="netlist">{events.map((e, i) => (
                <li key={i}><b>{e.purpose}</b><br /><span className="muted">{new Date(e.ts).toLocaleTimeString()} · {e.host}</span></li>
              ))}</ul>
            )
            : (
            <table>
              <thead><tr><th>Hora</th><th>Destino</th><th>Motivo</th><th>Bytes enviados</th></tr></thead>
              <tbody>{events.map((e, i) => (
                <tr key={i}><td>{new Date(e.ts).toLocaleTimeString()}</td><td>{e.host}</td><td>{e.purpose}</td><td>{e.bytes}</td></tr>
              ))}</tbody>
            </table>
            )}
      </section>
    </div>
  )
}
