// Migraciones de los datos guardados.
//
// El formato de ajustes, bibliotecas y reuniones lleva un número de versión.
// Cuando cambia, aquí se describe cómo pasar del formato viejo al nuevo: sin
// esto, un cambio de formato dejaría sin ajustes ni historial a quien ya usaba
// la aplicación.
import type { Settings } from '@shared/types'

/** Versión actual del formato de los datos guardados. */
export const SCHEMA_VERSION = 2

/**
 * Ajusta los ajustes de una versión anterior a la actual.
 * v1 guardaba los ajustes sin envolver; v2 los envuelve con la versión.
 */
export function migrateSettings(data: unknown, from: number): Partial<Settings> {
  if (from >= SCHEMA_VERSION) return (data ?? {}) as Partial<Settings>
  const old = (data ?? {}) as Record<string, unknown>
  const patch: Partial<Settings> = { ...old } as Partial<Settings>
  // En v1 la velocidad de voz era un número suelto y las voces, un mapa por idioma.
  if (typeof old.ttsSpeed === 'number') patch.ttsSpeed = old.ttsSpeed
  if (old.ttsVoice && typeof old.ttsVoice === 'object') patch.ttsVoice = old.ttsVoice as Settings['ttsVoice']
  // Los filtros del micrófono llegaron en v2: si no estaban, se usan los valores por defecto.
  if (!old.micFilters) delete patch.micFilters
  return patch
}
