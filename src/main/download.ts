// Descarga de ficheros con verificación de integridad.
//
// Reglas:
//  - Se descarga siempre a `<destino>.part` y se renombra al terminar: un archivo
//    a medias nunca se confunde con uno instalado.
//  - Si se conoce el SHA-256, se comprueba antes de renombrar. Si no coincide, el
//    archivo se borra y la descarga falla.
//  - Se puede cancelar con un AbortSignal.
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { netFetch } from './netlog'

export interface DownloadRequest {
  /** Motivo de la descarga; aparece en el registro de red. */
  purpose: string
  url: string
  /** Ruta final del fichero. */
  dest: string
  /** SHA-256 esperado. Si no se indica, no se verifica el contenido. */
  sha256?: string
  /** Tamaño esperado en bytes, para avisar antes de descargar. */
  size?: number
  /** Progreso 0-100. */
  onPct?: (pct: number) => void
  signal?: AbortSignal
}

export interface DownloadResult {
  bytes: number
  sha256: string
  /** true si el fichero ya estaba y no hubo que descargarlo. */
  cached: boolean
}

/** Error de descarga con un motivo que la interfaz puede enseñar tal cual. */
export class DownloadError extends Error {
  constructor(message: string, readonly reason: 'red' | 'integridad' | 'cancelado' | 'disco') {
    super(message)
    this.name = 'DownloadError'
  }
}

/** SHA-256 de un fichero ya descargado. */
export function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Descarga un fichero a disco verificando su integridad.
 * Si el destino ya existe y su hash coincide con el esperado, no se vuelve a descargar.
 */
export async function downloadFile(req: DownloadRequest): Promise<DownloadResult> {
  const { purpose, url, dest, sha256, size, onPct, signal } = req
  mkdirSync(dirname(dest), { recursive: true })

  // Ya está y es el que esperamos: no se vuelve a bajar.
  if (existsSync(dest) && sha256) {
    try {
      if (fileSha256(dest) === sha256) return { bytes: size ?? 0, sha256, cached: true }
    } catch {
      /* ilegible: se vuelve a descargar */
    }
  }

  const tmp = join(dirname(dest), `.${Date.now()}-${Math.random().toString(36).slice(2)}.part`)
  const hash = createHash('sha256')
  let got = 0
  try {
    const res = await netFetch(purpose, url, { signal })
    if (!res.ok || !res.body) throw new DownloadError(`No se pudo descargar (${res.status}): ${url}`, 'red')
    const total = Number(res.headers.get('content-length') ?? size ?? 0)
    const src = Readable.fromWeb(res.body as never)
    src.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      if (onPct) onPct(total ? Math.min(100, Math.round((got / total) * 100)) : 0)
    })
    await pipeline(src, createWriteStream(tmp))
  } catch (e) {
    rmSync(tmp, { force: true })
    if (signal?.aborted) throw new DownloadError('Descarga cancelada.', 'cancelado')
    if (e instanceof DownloadError) throw e
    throw new DownloadError(`No se pudo descargar: ${(e as Error).message}`, 'red')
  }

  const digest = hash.digest('hex')
  if (sha256 && digest !== sha256) {
    rmSync(tmp, { force: true })
    throw new DownloadError('El fichero descargado no coincide con la suma de verificación (SHA-256). Se descartó.', 'integridad')
  }
  if (size && got !== size) {
    rmSync(tmp, { force: true })
    throw new DownloadError(`El fichero descargado está incompleto (${got} de ${size} bytes). Se descartó.`, 'integridad')
  }
  renameSync(tmp, dest)
  onPct?.(100)
  return { bytes: got, sha256: digest, cached: false }
}
