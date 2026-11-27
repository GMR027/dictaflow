// Motor de voz del propio teléfono (Android): tipos compartidos por la interfaz y el preload.
//
// Solo existe la vía on-device: si el teléfono no la tiene, se usa Whisper. Así la promesa de
// «local primero» se mantiene sin depender de la nube.
export interface PhoneSttInfo {
  onDevice: boolean
  sistema: boolean
  motor: string
}

export interface PhoneSttStart {
  lang: 'es' | 'en'
  continuous: boolean
  /** Términos del diccionario para que el reconocedor escriba bien los nombres propios. */
  bias: string[]
}

export interface PhoneSttStartResult {
  onDevice: boolean
  lang?: string
}

/** Idiomas que puede reconocer el motor on-device de la app. */
export type PhoneSttLang = 'es' | 'en'

/**
 * Estado del paquete de idioma del motor on-device (Android 13+).
 * En Android 12 no se puede consultar: `checkable` llega en false y se intenta usar igual.
 */
export interface PhoneSttLanguageStatus {
  checkable: boolean
  installed: boolean
  /** Android ya lo está descargando o lo tiene programado. */
  pending: boolean
  /** El motor admite el idioma y se puede descargar. */
  supported: boolean
  /** La app puede pedir la descarga (Android 13+). */
  downloadable: boolean
}

export type PhoneSttDownloadState = 'progress' | 'done' | 'scheduled' | 'dialog' | 'error'

export interface PhoneSttDownloadProgress {
  state: PhoneSttDownloadState
  /** Porcentaje 0-100 cuando Android lo informa (Android 14+). */
  pct?: number
  message?: string
}

/**
 * `dialog`: Android 13 abrió su propio aviso de descarga y hay que esperar.
 * `scheduled`: Android la hará más tarde; esta sesión debe seguir con Whisper.
 */
export interface PhoneSttDownloadResult {
  state: 'done' | 'scheduled' | 'dialog'
}

export interface PhoneSttHandlers {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onLevel: (level: number) => void
  onError: (message: string) => void
  onState?: (state: string) => void
}

export interface PhoneSttApi {
  available: () => Promise<PhoneSttInfo>
  start: (opts: PhoneSttStart) => Promise<PhoneSttStartResult>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  /** Registra los eventos del plugin; devuelve la función para darse de baja. */
  on: (handlers: PhoneSttHandlers) => Promise<() => void>
  /** Android 13+: ¿está instalado el paquete de idioma del motor on-device? */
  languageStatus: (lang: PhoneSttLang) => Promise<PhoneSttLanguageStatus>
  /** Android 13+: pide a Android que descargue el paquete de idioma. */
  downloadLanguage: (
    lang: PhoneSttLang,
    onProgress?: (p: PhoneSttDownloadProgress) => void
  ) => Promise<PhoneSttDownloadResult>
}
