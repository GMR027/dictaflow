// Única puerta de salida a la red de la aplicación.
//
// Todo lo que sale de DictaFlow pasa por aquí: se puede bloquear en modo offline
// estricto y queda registrado en la pestaña Privacidad con el tamaño real de lo
// enviado (cualquier tipo de cuerpo, no solo texto).
import type { NetEvent } from '@shared/types'
import { getSettings } from './store'

const events: NetEvent[] = []

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
export const isLocalUrl = (url: string): boolean => LOCAL_HOSTS.has(new URL(url).hostname)

export const getNetEvents = (): NetEvent[] => events
export const clearNetEvents = (): void => void (events.length = 0)

/** Tamaño en bytes del cuerpo de una petición, sea del tipo que sea. */
export function bodyBytes(body: BodyInit | null | undefined): number {
  if (body == null) return 0
  if (typeof body === 'string') return Buffer.byteLength(body)
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString())
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let n = 0
    for (const [, value] of body.entries()) {
      n += typeof value === 'string' ? Buffer.byteLength(value) : value.size
    }
    return n
  }
  return 0
}

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
