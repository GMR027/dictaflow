import { useRef, useState } from 'react'
import { Mic } from './audio'
import { useApp } from './store'

/** Dictado rápido a un campo de texto (pulsar para hablar, volver a pulsar para transcribir). */
export function useQuickDictation(onText: (text: string) => void): { recording: boolean; busy: boolean; toggle: () => Promise<void>; error: string } {
  const mic = useRef<Mic | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settings = useApp((s) => s.settings)

  const toggle = async (): Promise<void> => {
    if (mic.current) {
      await mic.current.stop()
      mic.current = null
      setRecording(false)
      return
    }
    setError('')
    const m = new Mic({
      deviceId: settings.micDeviceId, mode: 'controlled', onLevel: () => undefined,
      onSegment: async (pcm) => {
        setBusy(true)
        try {
          const r = await window.api.transcribeDetailed(pcm, settings.primaryLang)
          if (r.text) onText(r.text)
        } catch (e) {
          setError((e as Error).message)
        } finally {
          setBusy(false)
        }
      }
    })
    try {
      await m.start()
      mic.current = m
      setRecording(true)
    } catch (e) {
      setError(`Micrófono: ${(e as Error).message}`)
    }
  }
  return { recording, busy, toggle, error }
}
