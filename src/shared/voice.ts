import type { Lang } from './types'

/** Motor de síntesis que produce la voz. */
export type VoiceEngine = 'piper' | 'cloud' | 'sherpa-onnx'

/** Calidad del modelo de voz (Piper: x_low, low, medium, high). */
export type VoiceQuality = 'x_low' | 'low' | 'medium' | 'high'

/** Condiciones de uso de la voz, resumidas a partir de su licencia. */
export type VoiceUsage = 'libre' | 'no-comercial' | 'terminos-propios'

/**
 * Una voz del catálogo compartido. Todas las funciones que sintetizan texto
 * (lector, audio, resúmenes, traducciones) consumen esta misma lista: no hay
 * catálogos paralelos.
 */
export interface Voice {
  id: string
  engine: VoiceEngine
  /** Idiomas que la voz puede hablar. */
  langs: Lang[]
  /** Variante regional, p. ej. «es_MX». */
  variant: string
  /** Nombre corto de la persona o del corpus de entrenamiento. */
  speaker: string
  label: string
  quality: VoiceQuality
  /** Tamaño exacto del modelo en disco, en bytes. */
  sizeBytes: number
  /** Licencia del modelo de voz, tal como la declara su ficha. */
  license: string
  /** Condiciones de uso resumidas, para no tener que leer la licencia para usar la voz. */
  usage: VoiceUsage
  /** Procedencia: ficha del modelo y corpus de entrenamiento. */
  source: string
  /** Muestra de audio para escuchar antes de descargar. */
  sampleUrl?: string
  /** Requisitos adicionales para usarla. */
  requires?: string[]
  note?: string
}

/** Voz del catálogo con el estado de instalación en este equipo. */
export interface VoiceStatus extends Voice {
  installed: boolean
  installedAt?: number
  /** Motivo por el que no se puede usar ahora mismo. */
  unavailable?: string
}

export interface VoiceFilter {
  lang?: Lang
  engine?: VoiceEngine
  quality?: VoiceQuality
  /** Texto libre: busca en la etiqueta, el identificador y la variante. */
  query?: string
}

/** ¿La voz puede hablar ese idioma? */
export const speaks = (v: Voice, lang: Lang): boolean => v.langs.includes(lang)

/** Filtra el catálogo por idioma, motor, calidad y texto libre. */
export function filterVoices(voices: Voice[], f: VoiceFilter): Voice[] {
  const q = (f.query ?? '').trim().toLowerCase()
  return voices.filter((v) => {
    if (f.lang && !speaks(v, f.lang)) return false
    if (f.engine && v.engine !== f.engine) return false
    if (f.quality && v.quality !== f.quality) return false
    if (q && !`${v.id} ${v.label} ${v.variant} ${v.speaker}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Idiomas disponibles en el catálogo. */
export const catalogLangs = (voices: Voice[]): Lang[] => {
  const seen = new Set<Lang>()
  for (const v of voices) for (const l of v.langs) seen.add(l)
  return [...seen].sort()
}

/** Tamaño en MB con un decimal, para la interfaz. */
export const mb = (bytes: number): string => (bytes / 1048576).toFixed(1)

/** Un audio generado con una voz personal. */
export interface GeneratedClip {
  id: string
  voiceId: string
  voiceName: string
  text: string
  path: string
  createdAt: number
  durationSec: number
}
