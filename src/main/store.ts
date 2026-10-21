import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS, type HistoryItem, type SecretName, type Settings } from '@shared/types'
import { dataDir, modelsDir } from './paths'
import { migrateSettings, SCHEMA_VERSION } from './migrate'

export { dataDir, modelsDir }

/**
 * Versión del formato de los datos guardados. Al subirla hay que añadir la
 * migración correspondiente en `migrate.ts`; así un cambio de formato no rompe
 * la instalación de quien ya usaba la aplicación.
 */
export { SCHEMA_VERSION } from './migrate'


/** Envoltura con versión de todo lo que se guarda en disco. */
interface Envelope<T> {
  version: number
  data: T
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** Escribe a disco de forma atómica: un fallo a mitad no deja el fichero corrupto. */
function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
}

/** Lee un documento con versión, aplicando las migraciones pendientes. */
function readVersioned<T>(file: string, fallback: T, migrate: (data: unknown, from: number) => T): T {
  const raw = readJson<unknown>(file, undefined)
  if (raw === undefined) return fallback
  const isObject = raw !== null && typeof raw === 'object'
  // Formato antiguo (v1): el documento era el dato sin envolver.
  if (!isObject || !('version' in raw)) return migrate(raw, 1)
  const env = raw as Envelope<unknown>
  if (env.version === SCHEMA_VERSION) return env.data as T
  return migrate(env.data, env.version)
}

/** Escribe un documento con versión. */
function writeVersioned<T>(file: string, data: T): void {
  writeJson(file, { version: SCHEMA_VERSION, data } satisfies Envelope<T>)
}

const settingsFile = join(dataDir, 'settings.json')
const secretsFile = join(dataDir, 'secrets.json')

/**
 * Ajustes del usuario. Se guardan con la versión del esquema para poder
 * migrarlos si el formato cambia.
 */
export function getSettings(): Settings {
  //Si hay un guardado pendiente, ese es el estado actual: el disco puede ir retrasado.
  if (pending) return pending
  const stored = readVersioned<Partial<Settings>>(settingsFile, {}, migrate)
  return { ...DEFAULT_SETTINGS, ...stored }
}

/**
 * Guarda los ajustes. La escritura se agrupa: mover un deslizador genera
 * decenas de cambios por segundo y no tiene sentido tocar el disco en cada uno.
 * `flushSettings` fuerza la escritura (al cerrar la aplicación).
 */
export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  pending = next
  if (!settingsTimer) settingsTimer = setTimeout(flushSettings, 300)
  return next
}

let pending: Settings | null = null
let settingsTimer: NodeJS.Timeout | null = null

/** Escribe ya los ajustes pendientes. */
export function flushSettings(): void {
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = null
  if (!pending) return
  writeVersioned(settingsFile, pending)
  pending = null
}

/** v1 guardaba los ajustes sin envolver; v2 los envuelve con la versión. */
function migrate(data: unknown, from: number): Partial<Settings> {
  return migrateSettings(data, from)
}

export function setSecret(name: SecretName, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El keyring del sistema no está disponible; no se guardará la clave sin cifrar.')
  const all = readJson<Record<string, string>>(secretsFile, {})
  if (value) all[name] = safeStorage.encryptString(value).toString('base64')
  else delete all[name]
  writeJson(secretsFile, all)
}

export function getSecret(name: SecretName): string {
  const enc = readJson<Record<string, string>>(secretsFile, {})[name]
  if (!enc) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

export function hasSecret(name: SecretName): boolean {
  return !!readJson<Record<string, string>>(secretsFile, {})[name]
}

const historyFile = join(dataDir, 'history.json')
export const getHistory = (): HistoryItem[] => readVersioned<HistoryItem[]>(historyFile, [], (d) => (Array.isArray(d) ? d : []))
export const saveHistory = (items: HistoryItem[]): void => writeVersioned(historyFile, items.slice(0, 500))

/** Colecciones simples (prompts, reuniones, biblioteca) guardadas como documentos en la carpeta de datos. */
export type Collection = 'prompts' | 'meetings' | 'library'
export const getCollection = <T>(name: Collection): T[] =>
  readVersioned<T[]>(join(dataDir, `${name}.json`), [], (d) => (Array.isArray(d) ? (d as T[]) : []))
export const saveCollection = (name: Collection, items: unknown[]): void => writeVersioned(join(dataDir, `${name}.json`), items)
