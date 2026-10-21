// Catálogo único de voces. Todas las funciones que sintetizan texto (lector, audio,
// resúmenes, traducciones, voces personales) leen de aquí: no hay listas paralelas.
//
// Los tamaños y los SHA-256 de cada fichero vienen de manifest.json, que genera
// tools/build-manifest.mjs a partir de las fuentes oficiales.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { Voice, VoiceStatus } from '@shared/voice'
import manifest from './manifest.json'
import { dataDir } from '../store'

export const voicesDir = join(dataDir, 'voices')
export const piperDir = join(dataDir, 'piper')
export const piperBin = join(piperDir, 'piper', 'piper')

interface ManifestVoice {
  id: string
  dir: string
  model: { url: string; size: number; sha256: string }
  config: { url: string; size: number; sha256: string }
  sample: string | null
}
interface Manifest {
  generated: string
  piper: { id: string; url: string; size: number; sha256: string; declaredSize: number }
  voices: ManifestVoice[]
}

const MANIFEST = manifest as unknown as Manifest

/** Metadatos de cada voz: procedencia, licencia y condiciones de uso. */
const META: Record<string, Omit<Voice, 'id' | 'engine' | 'sizeBytes' | 'sampleUrl'>> = {
  'es_ES-davefx-medium': {
    langs: ['es'], variant: 'es_ES', speaker: 'davefx', label: 'Español (España) · Dave',
    quality: 'medium', license: 'CC0', usage: 'libre',
    source: 'OHF-Voice/voice-datasets · rhasspy/piper-voices'
  },
  'es_ES-sharvard-medium': {
    langs: ['es'], variant: 'es_ES', speaker: 'sharvard', label: 'Español (España) · Harvard',
    quality: 'medium', license: 'CC BY 3.0', usage: 'libre',
    source: 'Harvard sentences grabadas · rhasspy/piper-voices'
  },
  'es_MX-ald-medium': {
    langs: ['es'], variant: 'es_MX', speaker: 'ald', label: 'Español (México) · Ald',
    quality: 'medium', license: 'Unlicense', usage: 'libre',
    source: 'rmcpantoja/Ald_Mexican_Spanish_speech_dataset · rhasspy/piper-voices'
  },
  'es_MX-ald-x_low': {
    langs: ['es'], variant: 'es_MX', speaker: 'ald', label: 'Español (México) · Ald (ligera)',
    quality: 'x_low', license: 'Unlicense', usage: 'libre',
    source: 'Sintetizado a partir de es_MX-ald-medium con frases de Tatoeba',
    note: 'Mucho más pequeña y rápida; menos fiel al timbre original.'
  },
  'es_MX-claude-high': {
    langs: ['es'], variant: 'es_MX', speaker: 'claude', label: 'Español (México) · Claude (alta)',
    quality: 'high', license: 'Apache-2.0', usage: 'libre',
    source: 'Corpus de español de México (Apache-2.0) · rhasspy/piper-voices'
  },
  'en_US-lessac-medium': {
    langs: ['en'], variant: 'en_US', speaker: 'lessac', label: 'English (US) · Lessac',
    quality: 'medium', license: 'Licencia Blizzard 2013 (cstr.ed.ac.uk)', usage: 'terminos-propios',
    source: 'Lessac Blizzard Challenge 2013 · rhasspy/piper-voices'
  },
  'en_US-amy-medium': {
    langs: ['en'], variant: 'en_US', speaker: 'amy', label: 'English (US) · Amy',
    quality: 'medium', license: 'MIT (mimic3-voices)', usage: 'libre',
    source: 'MycroftAI/mimic3-voices · rhasspy/piper-voices'
  },
  'en_US-kristin-medium': {
    langs: ['en'], variant: 'en_US', speaker: 'kristin', label: 'English (US) · Kristin',
    quality: 'medium', license: 'Dominio público', usage: 'libre',
    source: 'Corpus de habla inglesa de dominio público · rhasspy/piper-voices'
  },
  'en_US-hfc_female-medium': {
    langs: ['en'], variant: 'en_US', speaker: 'hfc_female', label: 'English (US) · HFC (mujer)',
    quality: 'medium', license: 'CC BY-NC-SA 4.0', usage: 'no-comercial',
    source: 'Corpus HFC (cmu) · rhasspy/piper-voices'
  },
  'en_US-ryan-high': {
    langs: ['en'], variant: 'en_US', speaker: 'ryan', label: 'English (US) · Ryan (alta)',
    quality: 'high', license: 'CC BY-NC-SA 4.0', usage: 'no-comercial',
    source: 'Corpus LibriTTS-R · rhasspy/piper-voices'
  },
  'en_GB-alan-medium': {
    langs: ['en'], variant: 'en_GB', speaker: 'alan', label: 'English (UK) · Alan',
    quality: 'medium', license: 'MIT (mimic3-voices)', usage: 'libre',
    source: 'MycroftAI/mimic3-voices · rhasspy/piper-voices'
  }
}

/** El catálogo completo, ordenado por idioma y luego por calidad. */
export const VOICE_CATALOG: Voice[] = MANIFEST.voices
  .map((v): Voice => ({
    id: v.id,
    engine: 'piper',
    sizeBytes: v.model.size,
    sampleUrl: v.sample ?? undefined,
    ...(META[v.id] ?? {
      langs: ['es'] as Voice['langs'],
      variant: v.dir.split('/')[1] ?? '',
      speaker: v.id,
      label: v.id,
      quality: 'medium' as const,
      license: 'Sin verificar',
      usage: 'terminos-propios' as const,
      source: 'rhasspy/piper-voices'
    })
  }))
  .sort((a, b) => a.langs[0].localeCompare(b.langs[0]) || a.variant.localeCompare(b.variant) || a.id.localeCompare(b.id))

/** Datos de descarga (URL y hash) de una voz del catálogo. */
export const voiceManifest = (id: string): ManifestVoice | undefined => MANIFEST.voices.find((v) => v.id === id)

/** Datos de descarga del motor Piper. */
export const piperManifest = (): Manifest['piper'] => MANIFEST.piper

/** Ruta del modelo de voz ya descargado. */
export const voiceModelPath = (id: string): string => join(voicesDir, `${id}.onnx`)
/** Ruta de la configuración del modelo de voz. */
export const voiceConfigPath = (id: string): string => join(voicesDir, `${id}.onnx.json`)

/**
 * Estado de cada voz del catálogo. Una voz está instalada solo si están el modelo
 * y su configuración: con el modelo solo, Piper fallaría al sintetizar.
 */
export function voiceStatus(): VoiceStatus[] {
  mkdirSync(voicesDir, { recursive: true })
  const installed = new Set(
    readdirSync(voicesDir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.replace(/\.onnx$/, ''))
  )
  const hasConfig = new Set(
    readdirSync(voicesDir)
      .filter((f) => f.endsWith('.onnx.json'))
      .map((f) => f.replace(/\.onnx\.json$/, ''))
  )
  return VOICE_CATALOG.map((v) => {
    const ok = installed.has(v.id) && hasConfig.has(v.id)
    const status: VoiceStatus = { ...v, installed: ok }
    if (ok) {
      try {
        status.installedAt = statSync(voiceModelPath(v.id)).mtimeMs
      } catch {
        /* sin fecha: no importa */
      }
    }
    return status
  })
}

/** Voces instaladas (con modelo y configuración). */
export const installedVoiceIds = (): string[] => voiceStatus().filter((v) => v.installed).map((v) => v.id)

/** Borra una voz descargada. No toca nada más. */
export function removeVoice(id: string): void {
  for (const f of [voiceModelPath(id), voiceConfigPath(id)]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
}

/** ¿Está instalado el motor de voz? */
export const piperInstalled = (): boolean => existsSync(piperBin)
