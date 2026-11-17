// Diccionario personal: sustituye las palabras mal transcritas por su forma correcta.
// Lógica pura compartida por el escritorio (`src/main/stt.ts`) y Android (`platform/tauri.ts`).
import type { DictEntry } from './types'

/**
 * Las expresiones se compilan una vez y se reutilizan: compilar un patrón por
 * entrada del diccionario en cada transcripción costaba CPU sin motivo.
 */
let cache: { key: string; rules: { re: RegExp; to: string }[] } | null = null

export function applyDictionary(text: string, entries: DictEntry[]): string {
  const key = JSON.stringify(entries)
  if (!cache || cache.key !== key) {
    const rules = entries
      .filter(({ from, to }) => from.trim() && to.trim())
      .map(({ from, to }) => {
        const esc = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return { re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to: to.trim() }
      })
    cache = { key, rules }
  }
  let out = text
  for (const { re, to } of cache.rules) out = out.replace(re, to)
  return out
}
