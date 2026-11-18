// Ficha de cada voz Piper (procedencia, licencia, idioma): la misma en escritorio y en Android.
// Escritorio descarga las voces de rhasspy/piper-voices (src/main/catalog/manifest.json); Android,
// la copia preparada para sherpa-onnx (src/shared/local-models.ts). La voz es la misma.
import type { Voice } from './voice'

export type VoiceMeta = Omit<Voice, 'id' | 'engine' | 'sizeBytes' | 'sampleUrl'>

/** Metadatos de cada voz: procedencia, licencia y condiciones de uso. */
export const VOICE_META: Record<string, VoiceMeta> = {
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

/** Muestra oficial de la voz (rhasspy/piper-voices), para escucharla antes de descargarla. */
export function voiceSampleUrl(id: string): string {
  const [variant, speaker, quality] = id.split('-')
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${variant.split('_')[0]}/${variant}/${speaker}/${quality}/samples/speaker_0.mp3`
}
