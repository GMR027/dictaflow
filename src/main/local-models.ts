// Modelos de sherpa-onnx descargables en escritorio: texto en vivo (Kroko), Kokoro y Supertonic.
// Son los mismos del teléfono (src/shared/local-models.ts) y se guardan con los mismos nombres, en
// una carpeta propia. Whisper, la redacción y Piper siguen con sus gestores de siempre.
//
// La interfaz manda el modelo entero, pero aquí solo se acepta uno del catálogo y se descargan sus
// URL y sus sumas del catálogo, nunca las que lleguen por IPC.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { cpus, totalmem } from 'os'
import { statfs } from 'fs/promises'
import { join } from 'path'
import { companions, LOCAL_MODELS, type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelProgress } from '@shared/local-models'
import { KOKORO_MODEL } from '@shared/kokoro'
import { SUPERTONIC_MODEL } from '@shared/supertonic'
import { downloadFile } from './download'
import { netFetch } from './netlog'
import { dataDir, getSettings } from './store'

export const localDir = join(dataDir, 'local')
export const localPath = (id: string): string => join(localDir, id)

/** Modelos que el escritorio descarga con este gestor. */
export const DESKTOP_MODELS: LocalModel[] = LOCAL_MODELS.filter(
  (m) => m.kind === 'live' || m.id === KOKORO_MODEL.id || m.id === SUPERTONIC_MODEL.id
)
const catalogModel = (id: string): LocalModel | undefined => DESKTOP_MODELS.find((m) => m.id === id)

export function listLocalFiles(): LocalModelFile[] {
  if (!existsSync(localDir)) return []
  return readdirSync(localDir)
    .filter((f) => !f.startsWith('.'))
    .map((id) => ({ id, bytes: statSync(localPath(id)).size, partial: false }))
}

/** ¿Están todos los archivos del modelo? */
export const localReady = (m: LocalModel): boolean => [m.id, ...companions(m).map((x) => x.id)].every((id) => existsSync(localPath(id)))

export async function deviceInfo(): Promise<DeviceInfo> {
  let freeGB = 0
  try {
    mkdirSync(localDir, { recursive: true })
    const s = await statfs(localDir)
    freeGB = Math.round((s.bavail * s.bsize) / 1e9)
  } catch { /* desconocido */ }
  return { ramGB: Math.round(totalmem() / 1024 ** 3), freeGB, cores: cpus().length }
}

const running = new Map<string, AbortController>()

/**
 * Descarga un modelo y sus archivos, uno tras otro. El progreso se informa sobre el modelo
 * principal y suma todos los archivos: la tarjeta no da el modelo por listo hasta que están todos.
 */
export async function downloadLocal(requested: LocalModel, emit: (p: LocalModelProgress) => void): Promise<void> {
  const m = catalogModel(requested.id)
  if (!m) throw new Error('Ese modelo no se descarga en escritorio.')
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  if (running.has(m.id)) return
  const ctrl = new AbortController()
  running.set(m.id, ctrl)
  const files = [...companions(m), { id: m.id, url: m.url, bytes: m.bytes, sha256: m.sha256 }]
  const total = files.reduce((n, f) => n + f.bytes, 0)
  let done = 0
  // Un evento por cada 1 % (y no por cada trozo): la interfaz no se satura con 8.000 avisos.
  let lastPct = -1
  const send = (p: LocalModelProgress): void => {
    if (p.state === 'downloading' && p.total) {
      const pct = Math.floor((p.received / p.total) * 100)
      if (pct === lastPct) return
      lastPct = pct
    } else {
      lastPct = -1
    }
    emit(p)
  }
  try {
    for (const f of files) {
      send({ id: m.id, state: 'downloading', received: done, total })
      try {
        await downloadFile({
          purpose: `sherpa:${m.kind}`, url: f.url, dest: localPath(f.id), sha256: f.sha256, size: f.bytes, signal: ctrl.signal,
          onPct: (pct) => send({
            id: m.id,
            state: pct >= 100 ? 'verifying' : 'downloading',
            received: done + Math.round((f.bytes * pct) / 100),
            total
          })
        }, netFetch)
        done += f.bytes
        send({ id: m.id, state: 'downloading', received: done, total })
      } catch (e) {
        const cancelled = ctrl.signal.aborted
        // El error también se publica con el id del archivo que falló, para poder nombrarlo.
        send({ id: f.id, state: cancelled ? 'cancelled' : 'error', received: done, total, error: cancelled ? undefined : (e as Error).message })
        send({ id: m.id, state: cancelled ? 'cancelled' : 'error', received: done, total, error: cancelled ? undefined : (e as Error).message })
        throw e
      }
    }
    send({ id: m.id, state: 'done', received: total, total })
  } finally {
    running.delete(m.id)
  }
}

export function cancelLocal(id: string): void {
  running.get(id)?.abort()
}

export function removeLocal(id: string): void {
  const m = catalogModel(id)
  const ids = m ? [m.id, ...companions(m).map((x) => x.id)] : [id]
  for (const f of ids) {
    // Solo nombres del catálogo y sin rutas: nada fuera de la carpeta de modelos.
    if (!DESKTOP_MODELS.some((x) => x.id === f || companions(x).some((c) => c.id === f))) continue
    rmSync(localPath(f), { force: true })
  }
}
