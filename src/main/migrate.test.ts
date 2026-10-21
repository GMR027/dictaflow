import { describe, expect, it } from 'vitest'
import { migrateSettings, SCHEMA_VERSION } from './migrate'

describe('migrateSettings', () => {
  it('deja intactos los ajustes que ya están en la versión actual', () => {
    const s = { primaryLang: 'en', ttsSpeed: 1.2 }
    expect(migrateSettings(s, SCHEMA_VERSION)).toEqual(s)
  })

  it('migra los ajustes del formato v1 (sin envolver)', () => {
    const viejo = { primaryLang: 'en', ttsSpeed: 1.5, ttsVoice: { es: 'es_MX-ald-medium', en: 'en_US-amy-medium' }, projectDir: '/tmp/x' }
    const m = migrateSettings(viejo, 1)
    expect(m.primaryLang).toBe('en')
    expect(m.ttsSpeed).toBe(1.5)
    expect(m.ttsVoice).toEqual(viejo.ttsVoice)
    expect(m.projectDir).toBe('/tmp/x')
  })

  it('no inventa filtros de micrófono en una migración', () => {
    const m = migrateSettings({ primaryLang: 'es' }, 1)
    expect('micFilters' in m).toBe(false)
  })

  it('conserva los filtros de micrófono si ya estaban', () => {
    const m = migrateSettings({ micFilters: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }, 1)
    expect(m.micFilters).toEqual({ echoCancellation: true, noiseSuppression: false, autoGainControl: false })
  })

  it('aguanta un documento vacío o corrupto', () => {
    expect(migrateSettings(undefined, 1)).toEqual({})
    expect(migrateSettings(null, 1)).toEqual({})
  })
})
