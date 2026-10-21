// Única puerta de salida a la red de la aplicación.
//
// Todo lo que sale de DictaFlow pasa por aquí: se puede bloquear en modo offline
// estricto y queda registrado en la pestaña Privacidad con el tamaño real de lo
// enviado (cualquier tipo de cuerpo, no solo texto).
import type { NetEvent } from '@shared/types'
import { getSettings } from './store'
import { bodyBytes, isLocalUrl } from './net/local'

const events: NetEvent[] = []

export { bodyBytes, isLocalUrl }

export const getNetEvents = (): NetEvent[] => events
export const clearNetEvents = (): void => void (events.length = 0)

/** Anota una petición saliente en el registro de la pestaña Privacidad. */
export function logNetEvent(purpose: string, url: string, bytes = 0): void {
  if (isLocalUrl(url)) return
  events.unshift({ ts: Date.now(), host: new URL(url).hostname, purpose, bytes })
  events.length = Math.min(events.length, 200)
}

/**
 * Petición de red de la aplicación. Bloqueada en modo offline estricto si el
 * destino no es este mismo equipo, y registrada siempre que salga.
 */
export async function netFetch(purpose: string, url: string, init?: RequestInit): Promise<Response> {
  const local = isLocalUrl(url)
  if (!local && getSettings().strictOffline) {
    throw new Error(`Modo offline estricto: bloqueada la conexión a ${new URL(url).hostname}`)
  }
  const res = await fetch(url, init)
  if (!local) logNetEvent(purpose, url, bodyBytes(init?.body))
  return res
}
