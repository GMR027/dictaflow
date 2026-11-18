// Catálogo único de voces. Todas las funciones que sintetizan texto (lector, audio,
// resúmenes, traducciones, voces personales) leen de aquí: no hay listas paralelas.
//
// Los tamaños y los SHA-256 de cada fichero vienen de manifest.json, que genera
// tools/build-manifest.mjs a partir de las fuentes oficiales.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { Voice, VoiceStatus } from '@shared/voice'
import { VOICE_META as META } from '@shared/voice-catalog'
import manifest from './manifest.json'
import { dataDir } from '../paths'

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
