// Utilidades del motor de voz del teléfono, compartidas por Dictado, Traducción y dictado rápido.
import type { Settings } from '@shared/types'
import type { PhoneSttLang, PhoneSttLanguageStatus } from '@shared/phone-stt'
import { useSetup } from './setup'

let permission: Promise<void> | null = null

/**
 * Pide el permiso del micrófono. El reconocedor nativo no lo pide por su cuenta, y el WebView
 * solo lo concede al llamar a `getUserMedia`. Se pide una vez por sesión de la app.
 */
export function ensureMicPermission(): Promise<void> {
  permission ??= navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s) => { s.getTracks().forEach((t) => t.stop()) })
    .catch((e) => { permission = null; throw e })
  return permission
}

/** Estado del paquete de idioma del motor on-device; null si no se puede consultar. */
export async function phoneLanguageStatus(lang: PhoneSttLang): Promise<PhoneSttLanguageStatus | null> {
  if (window.api.platform !== 'android') return null
  try {
    return await window.api.phoneStt.languageStatus(lang)
  } catch {
    return null
  }
}

/**
 * true si el motor on-device puede reconocer ese idioma ahora mismo.
 * En Android 12 no se puede consultar: se intenta y, si falla, se cae a Whisper.
 */
export async function phoneSttDisponible(settings: Settings, lang: PhoneSttLang = settings.primaryLang): Promise<boolean> {
  if (window.api.platform !== 'android' || settings.sttPhone !== 'auto') return false
  try {
    const info = await window.api.phoneStt.available()
    if (!info.onDevice) return false
    const estado = await phoneLanguageStatus(lang)
    return !estado?.checkable || estado.installed
  } catch {
    return false
  }
}

/**
 * Deja listo el motor del teléfono para ese idioma. Si falta el paquete, abre la ventana para
 * descargarlo y espera la decisión del usuario. Devuelve true si se puede usar el motor.
 *
 * Si no se puede descargar (Android antiguo, motor sin soporte, modo offline estricto) devuelve
 * false sin molestar: quien llama sigue con Whisper.
 */
export async function prepararPhoneStt(settings: Settings, lang: PhoneSttLang): Promise<boolean> {
  if (window.api.platform !== 'android' || settings.sttPhone !== 'auto') return false
  try {
    const info = await window.api.phoneStt.available()
    if (!info.onDevice) return false
    let estado = await phoneLanguageStatus(lang)
    // En el primer uso el permiso del micrófono puede faltar todavía: se pide ahora, antes de
    // decidir si hay que descargar el idioma.
    if (!estado) {
      try {
        await ensureMicPermission()
        estado = await phoneLanguageStatus(lang)
      } catch {
        return false
      }
    }
    if (!estado || !estado.checkable || estado.installed) return true
    if (!estado.supported || !estado.downloadable || estado.pending) return false
    if (settings.strictOffline) return false
    return await useSetup.getState().ask({ service: 'dictation', phoneLang: lang })
  } catch {
    return false
  }
}

/**
 * Descarga el paquete de idioma y espera a que esté disponible. En Android 13 el aviso lo pinta
 * Android y aquí se comprueba cada pocos segundos; en Android 14+ llega el porcentaje real.
 */
export async function downloadPhoneLanguage(
  lang: PhoneSttLang,
  onProgress?: (pct: number | null) => void,
  cancelado: () => boolean = () => false
): Promise<'done' | 'scheduled' | 'unavailable'> {
  const resultado = await window.api.phoneStt.downloadLanguage(lang, (p) => {
    if (cancelado()) return
    if (p.state === 'progress') onProgress?.(typeof p.pct === 'number' ? p.pct : null)
    else if (p.state === 'dialog') onProgress?.(null)
  })
  if (resultado.state === 'done') return 'done'
  if (resultado.state === 'scheduled') return 'scheduled'
  if (resultado.state !== 'dialog') return 'unavailable'

  // Android 13: no hay progreso; se comprueba el estado hasta que Android termine.
  onProgress?.(null)
  for (let i = 0; i < 150; i++) {
    if (cancelado()) return 'unavailable'
    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    const estado = await phoneLanguageStatus(lang)
    if (estado?.installed) return 'done'
    if (estado?.checkable && !estado.pending && !estado.supported) return 'unavailable'
  }
  return 'unavailable'
}

/** Términos del diccionario para que el reconocedor escriba bien los nombres propios. */
export function phoneSttBias(settings: Settings): string[] {
  return settings.dictionary.map((d) => d.to || d.from).filter(Boolean).slice(0, 50)
}
