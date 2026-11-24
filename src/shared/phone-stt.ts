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
}
