// Modelos de sherpa-onnx descargables en escritorio: texto en vivo (Kroko) y Kokoro. Son los mismos
// del teléfono (src/shared/local-models.ts) y se guardan con los mismos nombres, en una carpeta
// propia. Whisper, la redacción y Piper siguen con sus gestores de siempre.
//
// La interfaz manda el modelo entero, pero aquí solo se acepta uno del catálogo y se descargan sus
// URL y sus sumas del catálogo, nunca las que lleguen por IPC.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { cpus, totalmem } from 'os'
import { statfs } from 'fs/promises'
import { join } from 'path'
import { companions, LOCAL_MODELS, type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelProgress } from '@shared/local-models'
import { KOKORO_MODEL } from '@shared/kokoro'
import { downloadFile } from './download'
import { netFetch } from './netlog'
import { dataDir, getSettings } from './store'

export const localDir = join(dataDir, 'local')
export const localPath = (id: string): string => join(localDir, id)

/** Modelos que el escritorio descarga con este gestor. */
export const DESKTOP_MODELS: LocalModel[] = LOCAL_MODELS.filter((m) => m.kind === 'live' || m.id === KOKORO_MODEL.id)
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

/** Descarga un modelo y sus archivos, uno tras otro, avisando del progreso de cada uno. */
export async function downloadLocal(requested: LocalModel, emit: (p: LocalModelProgress) => void): Promise<void> {
  const m = catalogModel(requested.id)
  if (!m) throw new Error('Ese modelo no se descarga en escritorio.')
  if (getSettings().strictOffline) throw new Error('Modo offline estricto activo: desactívalo en Privacidad para descargar.')
  if (running.has(m.id)) return
  const ctrl = new AbortController()
  running.set(m.id, ctrl)
  try {
    for (const f of [{ id: m.id, url: m.url, bytes: m.bytes, sha256: m.sha256 }, ...companions(m)]) {
      const total = f.bytes
      emit({ id: f.id, state: 'downloading', received: 0, total })
      try {
        await downloadFile({
          purpose: `sherpa:${m.kind}`, url: f.url, dest: localPath(f.id), sha256: f.sha256, size: f.bytes, signal: ctrl.signal,
          onPct: (pct) => emit({ id: f.id, state: pct >= 100 ? 'verifying' : 'downloading', received: Math.round((total * pct) / 100), total })
        }, netFetch)
        emit({ id: f.id, state: 'done', received: total, total })
      } catch (e) {
        const cancelled = ctrl.signal.aborted
        emit({ id: f.id, state: cancelled ? 'cancelled' : 'error', received: 0, total, error: cancelled ? undefined : (e as Error).message })
        throw e
      }
    }
    // El modelo principal avisa el último: la interfaz lo da por listo cuando están todos.
    emit({ id: m.id, state: 'done', received: m.bytes, total: m.bytes })
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
