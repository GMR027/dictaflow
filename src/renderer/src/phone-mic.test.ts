import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { PhoneSttLanguageStatus } from '@shared/phone-stt'
import { useSetup } from './setup'
import { downloadPhoneLanguage, phoneSttDisponible, prepararPhoneStt } from './phone-mic'

const listo: PhoneSttLanguageStatus = {
  checkable: true, installed: true, pending: false, supported: true, downloadable: true
}
const falta: PhoneSttLanguageStatus = {
  checkable: true, installed: false, pending: false, supported: true, downloadable: true
}

let api: Record<string, any>
const settings = { ...DEFAULT_SETTINGS, sttPhone: 'auto' as const }

beforeEach(() => {
  api = {
    platform: 'android',
    phoneStt: {
      available: vi.fn(async () => ({ onDevice: true, sistema: true, motor: 'on-device' })),
      languageStatus: vi.fn(async () => listo),
      downloadLanguage: vi.fn(async () => ({ state: 'done' as const }))
    }
  }
  ;(globalThis as Record<string, unknown>).window = { api }
})

afterEach(() => { vi.restoreAllMocks() })

describe('motor de voz del teléfono', () => {
  it('está disponible si el idioma ya está instalado', async () => {
    expect(await phoneSttDisponible(settings, 'es')).toBe(true)
    expect(api.phoneStt.languageStatus).toHaveBeenCalledWith('es')
  })

  it('en Android 12, que no puede consultarlo, se intenta igual', async () => {
    api.phoneStt.languageStatus.mockResolvedValue({ ...listo, checkable: false, installed: false })
    expect(await phoneSttDisponible(settings, 'es')).toBe(true)
  })

  it('no usa el teléfono si el usuario lo desactivó o no hay motor', async () => {
    expect(await phoneSttDisponible({ ...settings, sttPhone: 'off' }, 'es')).toBe(false)
    api.phoneStt.available.mockResolvedValue({ onDevice: false, sistema: true, motor: 'sistema' })
    expect(await phoneSttDisponible(settings, 'es')).toBe(false)
  })

  it('si falta el idioma, abre la ventana de descarga y respeta la decisión', async () => {
    api.phoneStt.languageStatus.mockResolvedValue(falta)
    const ask = vi.spyOn(useSetup.getState(), 'ask').mockResolvedValue(true)
    expect(await prepararPhoneStt(settings, 'es')).toBe(true)
    expect(ask).toHaveBeenCalledWith({ service: 'dictation', phoneLang: 'es' })

    ask.mockResolvedValue(false)
    expect(await prepararPhoneStt(settings, 'es')).toBe(false)
  })

  it('no ofrece descargar en modo offline estricto ni si Android lo tiene programado', async () => {
    api.phoneStt.languageStatus.mockResolvedValue(falta)
    const ask = vi.spyOn(useSetup.getState(), 'ask').mockResolvedValue(true)
    expect(await prepararPhoneStt({ ...settings, strictOffline: true }, 'es')).toBe(false)
    api.phoneStt.languageStatus.mockResolvedValue({ ...falta, pending: true })
    expect(await prepararPhoneStt(settings, 'es')).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('si el idioma ya está instalado no pregunta nada', async () => {
    const ask = vi.spyOn(useSetup.getState(), 'ask').mockResolvedValue(true)
    expect(await prepararPhoneStt(settings, 'en')).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('en Android 13 espera a que el idioma aparezca instalado', async () => {
    vi.useFakeTimers()
    try {
      api.phoneStt.downloadLanguage.mockResolvedValue({ state: 'dialog' })
      const estados = [falta, falta, listo]
      api.phoneStt.languageStatus.mockImplementation(async () => estados.shift() ?? listo)
      const descarga = downloadPhoneLanguage('es')
      await vi.advanceTimersByTimeAsync(6000)
      expect(await descarga).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })
})
