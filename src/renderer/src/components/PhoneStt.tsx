import { useEffect, useState } from 'react'
import type { PhoneSttInfo } from '@shared/phone-stt'
import { useApp } from '../store'

/**
 * Ajuste del motor de voz on-device del teléfono. Se muestra en Ajustes → Servicios de IA.
 * Si el teléfono no lo trae, la app usa Whisper sin interrumpir el dictado.
 */
export function PhoneSttSettings(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [info, setInfo] = useState<PhoneSttInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.phoneStt.available().then(setInfo).catch((e) => setError((e as Error).message))
  }, [])

  return (
    <section className="card">
      <h2>Motor de voz del teléfono</h2>
      <p className="muted">
        El teléfono puede transcribir en décimas de segundo con su modelo on-device, sin enviar audio
        a internet. Si no está disponible o le falta el idioma, DictaFlow usa Whisper.
      </p>
      <label className="inline check">
        <input type="checkbox" checked={settings.sttPhone === 'auto'}
          onChange={(e) => void patchSettings({ sttPhone: e.target.checked ? 'auto' : 'off' })} />
        Usar el motor on-device cuando esté disponible
      </label>
      <p className={info?.onDevice ? 'ok' : 'warn'}>
        {error
          ? `No se pudo comprobar: ${error}`
          : info == null
            ? 'Comprobando…'
            : info.onDevice
              ? '✓ Disponible en este teléfono (on-device)'
              : info.sistema
                ? '✗ No hay motor on-device; se usará Whisper. El motor del sistema puede usar la nube y no se usa.'
                : '✗ No hay motor de voz en el teléfono; se usará Whisper.'}
      </p>
      <p className="muted help">
        Solo se usa el reconocedor on-device del teléfono. Si falla, la app vuelve a Whisper
        automáticamente y no se pierde ninguna frase. No se envía audio a Google desde esta opción.
      </p>
    </section>
  )
}
