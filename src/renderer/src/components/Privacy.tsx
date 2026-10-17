import { useEffect, useState } from 'react'
import type { NetEvent } from '@shared/types'
import { useApp } from '../store'

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
          Modo offline estricto: bloquea cualquier conexión que no sea a tu propio equipo
        </label>
        <p className="muted">La transcripción de voz siempre se hace en tu equipo. Solo el texto de redacción sale si eliges un servicio en la nube.</p>
        <p>Tus datos están en <code>{dir}</code> <button onClick={() => void window.api.openDataDir()}>Abrir carpeta</button></p>
      </section>
      <section className="card grow">
        <header>
          <h2>Actividad de red</h2>
          <button onClick={() => void window.api.clearNetEvents().then(refresh)}>Limpiar</button>
        </header>
        {events.length === 0
          ? <p className="ok">Sin conexiones externas en esta sesión.</p>
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
