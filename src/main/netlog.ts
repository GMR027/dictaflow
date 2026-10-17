import type { NetEvent } from '@shared/types'
import { getSettings } from './store'

const events: NetEvent[] = []

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
export const isLocalUrl = (url: string): boolean => LOCAL_HOSTS.has(new URL(url).hostname)

export const getNetEvents = (): NetEvent[] => events
export const clearNetEvents = (): void => void (events.length = 0)

/** Todo acceso a red de la app pasa por aquí: se registra y se puede bloquear. */
export async function netFetch(purpose: string, url: string, init?: RequestInit): Promise<Response> {
  const local = isLocalUrl(url)
  if (!local && getSettings().strictOffline) {
    throw new Error(`Modo offline estricto: bloqueada la conexión a ${new URL(url).hostname}`)
  }
  const res = await fetch(url, init)
  if (!local) {
    events.unshift({
      ts: Date.now(),
      host: new URL(url).hostname,
      purpose,
      bytes: typeof init?.body === 'string' ? init.body.length : 0
    })
    events.length = Math.min(events.length, 200)
  }
  return res
}
