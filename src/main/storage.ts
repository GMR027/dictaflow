// Lectura y escritura de documentos con versión.
//
// Todo lo que se guarda en disco lleva un número de versión. Al leer un
// documento de una versión anterior se aplica la migración correspondiente, de
// modo que un cambio de formato no rompe la instalación de quien ya usaba la
// aplicación.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** Versión actual del formato de los datos guardados. */
export const SCHEMA_VERSION = 2

export interface Envelope<T> {
  version: number
  data: T
}

/** Lee un JSON; si el fichero no existe o está roto, devuelve el valor de reserva. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** Escribe un JSON de forma atómica: un fallo a mitad no deja el fichero corrupto. */
export function writeJson(file: string, data: unknown, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  renameSync(tmp, file)
}

/**
 * Lee un documento con versión, aplicando las migraciones pendientes.
 *
 * Un documento sin envolver (el formato v1) se trata como versión 1.
 */
export function readVersioned<T>(file: string, fallback: T, migrate: (data: unknown, from: number) => T): T {
  const raw = readJson<unknown>(file, undefined)
  if (raw === undefined) return fallback
  const isObject = raw !== null && typeof raw === 'object'
  if (!isObject || !('version' in raw)) return migrate(raw, 1)
  const env = raw as Envelope<unknown>
  if (env.version === SCHEMA_VERSION) return env.data as T
  return migrate(env.data, env.version)
}

/** Escribe un documento con versión. */
export function writeVersioned<T>(file: string, data: T): void {
  writeJson(file, { version: SCHEMA_VERSION, data } satisfies Envelope<T>)
}
