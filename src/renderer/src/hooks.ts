import { useEffect, useRef, useState } from 'react'
import { applyDictionary } from '@shared/dictionary'
import { createMic, type MicLike } from './audio'
import { ensureMicPermission, phoneSttBias, phoneSttDisponible } from './phone-mic'
import { ensureService } from './services'
import { useApp } from './store'

/** Dictado rápido a un campo de texto (pulsar para hablar, volver a pulsar para transcribir). */
export function useQuickDictation(onText: (text: string) => void): { recording: boolean; busy: boolean; toggle: () => Promise<void>; error: string } {
  const mic = useRef<MicLike | null>(null)
  const phone = useRef<{ unsub: () => void } | null>(null)
  const sinTelefono = useRef(false)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settings = useApp((s) => s.settings)

  useEffect(() => () => {
    if (!phone.current) return
    phone.current.unsub()
    phone.current = null
    void window.api.phoneStt.cancel().catch(() => undefined)
  }, [])

  const toggle = async (): Promise<void> => {
    if (phone.current) {
      const { unsub } = phone.current
      phone.current = null
      try {
        await window.api.phoneStt.stop()
      } catch {
        // El motor ya estaba detenido.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 120))
      unsub()
      setRecording(false)
      return
    }
    if (mic.current) {
      await mic.current.stop()
      mic.current = null
      setRecording(false)
      return
    }
    /** Camino normal: micrófono del WebView y Whisper. */
    const startWhisper = async (): Promise<void> => {
      setError('')
      const m = createMic({
        deviceId: settings.micDeviceId, mode: 'controlled', onLevel: () => undefined, filters: settings.micFilters,
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
        },
        onEnded: () => setRecording(false)
      })
      try {
        await m.start()
        mic.current = m
        setRecording(true)
      } catch (e) {
        setError(`Micrófono: ${(e as Error).message}`)
      }
    }

    setError('')
    if (!(await ensureService('dictation'))) return
    if (!sinTelefono.current && await phoneSttDisponible(settings)) {
      let unsub: (() => void) | null = null
      let fallo = false
      try {
        unsub = await window.api.phoneStt.on({
          onPartial: () => undefined,
          onLevel: () => undefined,
          onFinal: (t) => {
            const text = applyDictionary(t, settings.dictionary)
            if (!text.trim()) return
            setBusy(true)
            try { onText(text) } finally { setBusy(false) }
          },
          onError: (m) => {
            fallo = true
            unsub?.()
            unsub = null
            // Solo se cambia a Whisper si la sesión ya estaba en marcha; durante el arranque
            // lo resuelve el catch de abajo.
            const activo = phone.current !== null
            phone.current = null
            sinTelefono.current = true
            console.debug(`[stt] motor del teléfono: ${m}`)
            if (activo) {
              void (async () => {
                await window.api.phoneStt.cancel().catch(() => undefined)
                setRecording(false)
                await startWhisper()
              })()
            }
          }
        })
        await ensureMicPermission()
        await window.api.phoneStt.start({ lang: settings.primaryLang, continuous: false, bias: phoneSttBias(settings) })
        if (fallo) throw new Error('El motor de voz del teléfono falló al arrancar.')
        phone.current = { unsub }
        setRecording(true)
        return
      } catch {
        unsub?.()
        phone.current = null
        sinTelefono.current = true
        await window.api.phoneStt.cancel().catch(() => undefined)
      }
    }
    await startWhisper()
  }
  return { recording, busy, toggle, error }
}
