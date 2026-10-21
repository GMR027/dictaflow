/**
 * Utilidades de red sin dependencias de Electron, para que se puedan probar
 * fuera de la aplicación.
 */

/** Direcciones que son este mismo equipo. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export const isLocalUrl = (url: string): boolean => LOCAL_HOSTS.has(new URL(url).hostname)

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

/**
 * Petición a un servicio del propio equipo (whisper.cpp, Ollama en modo local).
 * Nunca sale de la máquina, así que no necesita ni registro ni bloqueo, pero
 * se comprueba la dirección para que no sirva de atajo hacia internet.
 */
export async function localFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isLocalUrl(url)) throw new Error(`localFetch solo admite direcciones locales: ${url}`)
  return fetch(url, init)
}
