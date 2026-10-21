import { safeStorage } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, type HistoryItem, type LibraryDoc, type LibraryMeta, type SecretName, type Settings } from '@shared/types'
import { dataDir, modelsDir } from './paths'
import { migrateSettings } from './migrate'
import { readJson, readVersioned, writeJson, writeVersioned } from './storage'

export { dataDir, modelsDir }
export { SCHEMA_VERSION } from './migrate'

const settingsFile = join(dataDir, 'settings.json')
const secretsFile = join(dataDir, 'secrets.json')

/**
 * Ajustes del usuario. Se guardan con la versión del esquema para poder
 * migrarlos si el formato cambia.
 */
export function getSettings(): Settings {
  //Si hay un guardado pendiente, ese es el estado actual: el disco puede ir retrasado.
  if (pending) return pending
  const stored = readVersioned<Partial<Settings>>(settingsFile, {}, migrateSettings)
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

/** Colecciones simples (prompts, reuniones) guardadas como documentos en la carpeta de datos. */
export type Collection = 'prompts' | 'meetings'
export const getCollection = <T>(name: Collection): T[] =>
  readVersioned<T[]>(join(dataDir, `${name}.json`), [], (d) => (Array.isArray(d) ? (d as T[]) : []))
export const saveCollection = (name: Collection, items: unknown[]): void => writeVersioned(join(dataDir, `${name}.json`), items)

/**
 * Biblioteca: el índice va en library.json y el texto de cada documento en
 * library/<id>.json. Así, cambiar el punto de lectura no reescribe el libro.
 */
const libraryDir = join(dataDir, 'library')

export const getLibrary = (): LibraryMeta[] =>
  readVersioned<LibraryMeta[]>(join(dataDir, 'library.json'), [], (d) => (Array.isArray(d) ? (d as LibraryMeta[]) : []))

/** Un documento con su texto completo. */
export const getLibraryDoc = (id: string): LibraryDoc | null =>
  readVersioned<LibraryDoc | null>(join(libraryDir, `${id}.json`), null, (d) => (d as LibraryDoc) ?? null)

/** Guarda un documento y actualiza el índice. */
export const saveLibraryDoc = (doc: LibraryDoc): void => {
  mkdirSync(libraryDir, { recursive: true })
  writeVersioned(join(libraryDir, `${doc.id}.json`), doc)
  const index = getLibrary()
  const meta: LibraryMeta = {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    chapters: doc.chapters.map((c) => ({ title: c.title, chars: c.text.length })),
    addedAt: doc.addedAt,
    progress: doc.progress
  }
  const i = index.findIndex((m) => m.id === doc.id)
  if (i >= 0) index[i] = meta
  else index.unshift(meta)
  writeVersioned(join(dataDir, 'library.json'), index)
}

/** Actualiza solo el punto de lectura, sin tocar el texto. */
export const updateLibraryProgress = (id: string, progress: LibraryDoc['progress']): void => {
  const index = getLibrary()
  const i = index.findIndex((m) => m.id === id)
  if (i < 0) return
  index[i] = { ...index[i], progress }
  writeVersioned(join(dataDir, 'library.json'), index)
}

/** Borra un documento de la biblioteca y su contenido. */
export const removeLibraryDoc = (id: string): void => {
  const file = join(libraryDir, `${id}.json`)
  if (existsSync(file)) rmSync(file, { force: true })
  writeVersioned(join(dataDir, 'library.json'), getLibrary().filter((m) => m.id !== id))
}
