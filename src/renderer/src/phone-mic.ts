// Utilidades del motor de voz del teléfono, compartidas por Dictado, Traducción y dictado rápido.
import type { Settings } from '@shared/types'

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

/** true si el usuario lo permite y el teléfono tiene motor on-device (no se usa la nube). */
export async function phoneSttDisponible(settings: Settings): Promise<boolean> {
  if (window.api.platform !== 'android' || settings.sttPhone !== 'auto') return false
  try {
    return (await window.api.phoneStt.available()).onDevice
  } catch {
    return false
  }
}

/** Términos del diccionario para que el reconocedor escriba bien los nombres propios. */
export function phoneSttBias(settings: Settings): string[] {
  return settings.dictionary.map((d) => d.to || d.from).filter(Boolean).slice(0, 50)
}
