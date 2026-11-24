// Catálogo de los servicios que un usuario puede activar sin saber qué modelo hay debajo.
//
// La interfaz simple (Ajustes → Servicios y el modal de complementos) solo habla de
// «dictado», «redacción», «voz» y «texto en vivo». Aquí se traducen esas palabras a
// opciones concretas: motor del teléfono, un modelo de Whisper, una voz del catálogo…
//
// Es lógica pura: no llama a la interfaz ni a Rust. Así se puede probar y reutilizar en
// el modal, en los ajustes y en el asistente inicial.
import type { LLMKind, Settings } from './types'
import { LOCAL_MODELS, modelReady, recommendedId, totalBytes, type LocalModel, type LocalModelFile } from './local-models'
import type { VoiceStatus } from './voice'
import { speaks } from './voice'

export type ServiceId = 'dictation' | 'ai' | 'tts' | 'live'

/** Qué hace cada servicio, en palabras que se entienden sin ser técnico. */
export interface ServiceInfo {
  title: string
  /** Una frase para la fila de Ajustes. */
  purpose: string
  /** Explicación algo más larga para el modal. */
  detail: string
}

export const SERVICES: Record<ServiceId, ServiceInfo> = {
  dictation: {
    title: 'Dictado por voz',
    purpose: 'Convierte lo que hablas en texto para escribir sin teclear.',
    detail: 'Puedes usar el motor de voz del propio teléfono, que no descarga nada, o Whisper, que se descarga una vez y funciona sin conexión.'
  },
  ai: {
    title: 'Redacción con IA',
    purpose: 'Corrige, ordena y reescribe lo que dictas. También traduce y resume.',
    detail: 'La IA se ejecuta dentro del teléfono o del equipo. Elige una opción: las más ligeras son más rápidas y las de mayor calidad tardan algo más.'
  },
  tts: {
    title: 'Lectura en voz alta',
    purpose: 'Lee documentos, respuestas y traducciones en voz alta.',
    detail: 'Puedes usar una voz que ya trae el teléfono, sin descargar nada, o una voz natural que se descarga una vez y funciona sin conexión.'
  },
  live: {
    title: 'Texto en vivo',
    purpose: 'Mira tus palabras aparecer mientras hablas. Es opcional.',
    detail: 'Muestra un texto provisional al instante. Whisper sigue poniendo el texto definitivo. Gasta un poco más de batería.'
  }
}

/** Cómo se activa una opción. */
export type ServiceAction =
  | { kind: 'model'; modelId: string }
  | { kind: 'voice'; voiceId: string }
  | { kind: 'system-voice'; voiceId: string }
  | { kind: 'system-stt' }
  /** Escritorio: descarga y carga el modelo de Whisper de Transformers.js. */
  | { kind: 'stt-prepare' }
  /** Escritorio: cambiar a un proveedor de IA (Ollama, Claude, opencode…). */
  | { kind: 'provider'; provider: LLMKind }

export interface ServiceOption {
  id: string
  label: string
  note: string
  /** Bytes de descarga; 0 si no hay que descargar nada. */
  sizeBytes: number
  /** Ya está en el dispositivo y se puede usar. */
  installed: boolean
  recommended: boolean
  /** Idioma de la voz o del texto en vivo, si aplica. */
  lang?: 'es' | 'en'
  action: ServiceAction
}

/** Etiquetas sin nombres de archivo: el usuario elige «rápida» o «mejor calidad». */
const STT_LABEL: Record<string, string> = {
  'ggml-tiny-q5_1.bin': 'Rápida (básica)',
  'ggml-base-q5_1.bin': 'Rápida',
  'ggml-small-q5_1.bin': 'Equilibrada',
  'ggml-large-v3-turbo-q5_0.bin': 'Máxima precisión'
}
const STT_NOTE: Record<string, string> = {
  'ggml-tiny-q5_1.bin': 'La más ligera y rápida; comete más errores.',
  'ggml-base-q5_1.bin': 'Rápida y suficiente para frases cortas.',
  'ggml-small-q5_1.bin': 'Buen equilibrio entre precisión y velocidad.',
  'ggml-large-v3-turbo-q5_0.bin': 'La más precisa; tarda más y gasta más batería.'
}
const LLM_LABEL: Record<string, string> = {
  'gemma-3-1b-it-Q4_K_M.gguf': 'Rápida',
  'qwen2.5-1.5b-instruct-q4_k_m.gguf': 'Equilibrada',
  'Llama-3.2-3B-Instruct-Q4_K_M.gguf': 'Mejor calidad',
  'Qwen3-4B-Instruct-2507-Q4_K_M.gguf': 'Máxima calidad'
}
const LLM_NOTE: Record<string, string> = {
  'gemma-3-1b-it-Q4_K_M.gguf': 'Muy rápida; ideal para corregir y pulir frases cortas.',
  'qwen2.5-1.5b-instruct-q4_k_m.gguf': 'Rápida; buena para redactar y traducir textos cortos.',
  'Llama-3.2-3B-Instruct-Q4_K_M.gguf': 'Mejor redacción; algo más lenta.',
  'Qwen3-4B-Instruct-2507-Q4_K_M.gguf': 'La mejor calidad; para actas, prompts y textos largos.'
}

/** Voces Piper que se proponen por defecto en el escritorio. */
const DEFAULT_VOICE: Record<'es' | 'en', string> = {
  es: 'es_ES-davefx-medium',
  en: 'en_US-lessac-medium'
}

const MODEL = (id: string): LocalModel | undefined => LOCAL_MODELS.find((m) => m.id === id)
const isAndroid = (platform: string): boolean => platform === 'android'

/** ¿Está completo el modelo elegido en los ajustes? */
export function selectedModelReady(settings: Pick<Settings, 'sttModel'>, files: LocalModelFile[]): boolean {
  const m = MODEL(settings.sttModel)
  return !!m && m.kind === 'stt' && modelReady(m, files)
}

/** Opciones de dictado: motor del teléfono y/o calidades de Whisper. */
export function dictationOptions(
  platform: string,
  ramGB: number,
  files: LocalModelFile[],
  phoneAvailable: boolean | null,
  desktopSttReady = false
): ServiceOption[] {
  if (!isAndroid(platform)) {
    return [{
      id: 'whisper', label: 'Whisper (recomendado)',
      note: desktopSttReady
        ? 'Modelo listo. La transcripción funciona sin conexión.'
        : 'Se descarga la primera vez y después funciona sin conexión.',
      sizeBytes: 0, installed: desktopSttReady, recommended: true, action: { kind: 'stt-prepare' }
    }]
  }

  const options: ServiceOption[] = []
  if (phoneAvailable) {
    options.push({
      id: 'telefono', label: 'Voz del teléfono',
      note: 'Sin descargas y funciona sin internet. Si falla, DictaFlow usa Whisper.',
      sizeBytes: 0, installed: true, recommended: true, action: { kind: 'system-stt' }
    })
  }
  const recommended = recommendedId('stt', ramGB)
  for (const m of LOCAL_MODELS.filter((x) => x.kind === 'stt')) {
    options.push({
      id: m.id,
      label: STT_LABEL[m.id] ?? m.label,
      note: STT_NOTE[m.id] ?? m.note,
      sizeBytes: totalBytes(m),
      installed: modelReady(m, files),
      recommended: m.id === recommended,
      action: { kind: 'model', modelId: m.id }
    })
  }
  return options
}

/** Opciones de redacción en el teléfono (modelos GGUF). En escritorio se elige proveedor. */
export function llmOptions(ramGB: number, files: LocalModelFile[]): ServiceOption[] {
  const recommended = recommendedId('llm', ramGB)
  return LOCAL_MODELS.filter((m) => m.kind === 'llm').map((m) => ({
    id: m.id,
    label: LLM_LABEL[m.id] ?? m.label,
    note: LLM_NOTE[m.id] ?? m.note,
    sizeBytes: totalBytes(m),
    installed: modelReady(m, files),
    recommended: m.id === recommended,
    action: { kind: 'model', modelId: m.id } as ServiceAction
  }))
}

/** Opciones de lectura: voces del teléfono, voces ya instaladas y una descarga recomendada. */
export function voiceOptions(lang: 'es' | 'en', catalog: VoiceStatus[], current = ''): ServiceOption[] {
  const usable = catalog.filter((v) => speaks(v, lang))
  const installed = usable.filter((v) => v.installed)
  const system = installed.filter((v) => v.engine === 'sistema')
  const natural = installed.filter((v) => v.engine !== 'sistema')
  // El selector simple no debe mostrar las 31 voces de Kokoro/Supertonic: solo la que
  // está en uso y una alternativa. El catálogo completo vive en Ajustes avanzados.
  const currentNatural = natural.find((v) => v.id === current)
  const naturalPick = currentNatural ?? natural[0]
  const options: ServiceOption[] = []
  const add = (v: VoiceStatus, installed: boolean): void => {
    if (options.some((o) => o.id === v.id)) return
    options.push({
      id: v.id,
      label: v.label,
      note: v.engine === 'sistema'
        ? 'Voz del teléfono: sin descargas y sin conexión.'
        : installed ? `Voz natural ya instalada · ${v.variant}` : `Voz natural · ${v.variant}. Se descarga una vez y funciona sin conexión.`,
      sizeBytes: installed ? 0 : v.sizeBytes,
      installed,
      recommended: false,
      lang,
      action: v.engine === 'sistema' ? { kind: 'system-voice', voiceId: v.id } : { kind: 'voice', voiceId: v.id }
    })
  }

  // Las voces del teléfono primero: son las que no obligan a descargar nada.
  for (const v of system.slice(0, 2)) add(v, true)
  // La voz natural en uso (o la primera instalada), para que el selector no cambie sola.
  if (naturalPick) add(naturalPick, true)
  // Si la voz guardada es una del sistema que no entró en las dos primeras, se añade igual.
  if (current && !options.some((o) => o.id === current)) {
    const saved = installed.find((v) => v.id === current)
    if (saved) add(saved, true)
  }
  // Siempre queda una voz natural descargable más, aunque ya haya voces del teléfono.
  const downloadable = usable
    .filter((v) => !v.installed && v.engine === 'piper')
    .sort((a, b) => a.sizeBytes - b.sizeBytes)
  const preferred = usable.find((v) => v.id === DEFAULT_VOICE[lang] && !v.installed)
  const extra = preferred ?? downloadable[0]
  if (extra) add(extra, false)

  // La recomendada es la primera que no exige descarga; si no hay, la descarga propuesta.
  const best = options.find((o) => o.installed) ?? options[0]
  if (best) best.recommended = true
  return options
}

/** Opción de texto en vivo para el idioma que se está usando. */
export function liveOptions(lang: 'es' | 'en', files: LocalModelFile[]): ServiceOption[] {
  return LOCAL_MODELS.filter((m) => m.kind === 'live' && m.lang === lang).map((m) => ({
    id: m.id,
    label: `Texto en vivo · ${lang === 'es' ? 'español' : 'English'}`,
    note: m.note,
    sizeBytes: totalBytes(m),
    installed: modelReady(m, files),
    recommended: true,
    lang,
    action: { kind: 'model', modelId: m.id } as ServiceAction
  }))
}

/** ¿La voz elegida está lista para leer? La nube se considera configurada desde Ajustes. */
export function ttsReady(settings: Pick<Settings, 'ttsProvider' | 'ttsVoice'>, lang: 'es' | 'en', catalog: VoiceStatus[]): boolean {
  if (settings.ttsProvider === 'openai') return true
  return !!catalog.find((v) => v.id === settings.ttsVoice[lang] && v.installed)
}

/** ¿Hay un modelo de texto en vivo listo para ese idioma? (el interruptor se consulta aparte). */
export function liveReady(lang: 'es' | 'en', files: LocalModelFile[]): boolean {
  const m = LOCAL_MODELS.find((x) => x.kind === 'live' && x.lang === lang)
  return !!m && modelReady(m, files)
}

/** La clave de `features` que controla el servicio; el dictado es siempre el corazón de la app. */
export function featureKey(service: ServiceId): keyof Settings['features'] | null {
  if (service === 'dictation') return null
  return service === 'live' ? 'liveText' : service
}

export function serviceEnabled(settings: Pick<Settings, 'features'>, service: ServiceId): boolean {
  const key = featureKey(service)
  return key === null || settings.features[key]
}
