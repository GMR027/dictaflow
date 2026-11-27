import { useEffect, useState } from 'react'
import type { PhoneSttInfo, PhoneSttLang, PhoneSttLanguageStatus } from '@shared/phone-stt'
import { useServices } from '../services'
import { useSetup } from '../setup'
import { useApp } from '../store'

const NOMBRE: Record<PhoneSttLang, string> = { es: 'Español', en: 'English' }

/**
 * Ajuste del motor de voz on-device del teléfono. Se muestra en Ajustes → Servicios de IA.
 * Si falta el paquete de idioma, se puede descargar aquí; si el teléfono no trae motor, se usa
 * Whisper sin interrumpir el dictado.
 */
export function PhoneSttSettings(): JSX.Element {
  const { settings, patchSettings } = useApp()
  const [info, setInfo] = useState<PhoneSttInfo | null>(null)
  const [langs, setLangs] = useState<Partial<Record<PhoneSttLang, PhoneSttLanguageStatus>>>({})
  const [error, setError] = useState('')

  const leer = async (): Promise<void> => {
    setError('')
    try {
      const i = await window.api.phoneStt.available()
      setInfo(i)
      if (!i.onDevice) return
      const [es, en] = await Promise.all([
        window.api.phoneStt.languageStatus('es').catch(() => null),
        window.api.phoneStt.languageStatus('en').catch(() => null)
      ])
      setLangs({ es: es ?? undefined, en: en ?? undefined })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { void leer() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const descargar = async (lang: PhoneSttLang): Promise<void> => {
    await useSetup.getState().ask({ service: 'dictation', phoneLang: lang })
    await useServices.getState().refresh()
    await leer()
  }

  const estado = (lang: PhoneSttLang): string => {
    const st = langs[lang]
    if (!st) return 'Comprobando…'
    if (!st.checkable) return 'Se comprobará al usarlo'
    if (st.installed) return '✓ Instalado'
    if (st.pending) return 'Descargándose…'
    if (!st.supported) return 'No disponible en este teléfono'
    return 'Falta descargar'
  }

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

      {info?.onDevice && (
        <div className="service-extra">
          {(['es', 'en'] as PhoneSttLang[]).map((lang) => {
            const st = langs[lang]
            const puede = !settings.strictOffline && !!st?.checkable && !st.installed && st.supported && st.downloadable
            return (
              <div key={lang} className="row tight">
                <b>{NOMBRE[lang]}</b>
                <small className={st?.installed ? 'ok' : st?.checkable ? 'warn' : 'muted'}>{estado(lang)}</small>
                {puede && <button className="link" onClick={() => void descargar(lang)}>Descargar</button>}
              </div>
            )
          })}
        </div>
      )}

      <p className="muted help">
        Solo se usa el reconocedor on-device del teléfono. En Android 13 o posterior, si el idioma
        no está instalado, la app ofrece descargarlo con Android; en versiones anteriores, si falta,
        vuelve a Whisper automáticamente y no se pierde ninguna frase. No se envía audio a Google
        desde esta opción.
      </p>
    </section>
  )
}
