import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, type SecretName, type Settings } from '@shared/types'

export const dataDir = join(app.getPath('home'), '.local', 'share', 'dictaflow')
export const modelsDir = join(dataDir, 'models')
mkdirSync(modelsDir, { recursive: true })

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

const settingsFile = join(dataDir, 'settings.json')
const secretsFile = join(dataDir, 'secrets.json')

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(settingsFile, {}) }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  writeJson(settingsFile, next)
  return next
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

export interface HistoryItem {
  id: string
  createdAt: number
  raw: string
  polished: string
  kind: 'rewrite' | 'prompt'
}

const historyFile = join(dataDir, 'history.json')
export const getHistory = (): HistoryItem[] => readJson<HistoryItem[]>(historyFile, [])
export const saveHistory = (items: HistoryItem[]): void => writeJson(historyFile, items.slice(0, 500))

/** Colecciones simples (prompts, reuniones, biblioteca) guardadas como JSON en la carpeta de datos. */
export type Collection = 'prompts' | 'meetings' | 'library'
export const getCollection = <T>(name: Collection): T[] => readJson<T[]>(join(dataDir, `${name}.json`), [])
export const saveCollection = (name: Collection, items: unknown[]): void => writeJson(join(dataDir, `${name}.json`), items)
