export type Lang = 'es' | 'en'

/** Idiomas de traducción (Whisper los transcribe todos; la voz Piper solo existe para Lang). */
export const TRANS_LANGS = {
  es: { name: 'Español', whisper: 'spanish', llm: 'español' },
  en: { name: 'English', whisper: 'english', llm: 'inglés' },
  zh: { name: '中文 (Chino)', whisper: 'chinese', llm: 'chino' },
  hi: { name: 'हिन्दी (Hindi)', whisper: 'hindi', llm: 'hindi' },
  ar: { name: 'العربية (Árabe)', whisper: 'arabic', llm: 'árabe' },
  pt: { name: 'Português', whisper: 'portuguese', llm: 'portugués' },
  fr: { name: 'Français', whisper: 'french', llm: 'francés' },
  de: { name: 'Deutsch', whisper: 'german', llm: 'alemán' },
  ru: { name: 'Русский', whisper: 'russian', llm: 'ruso' },
  ja: { name: '日本語 (Japonés)', whisper: 'japanese', llm: 'japonés' },
  ko: { name: '한국어 (Coreano)', whisper: 'korean', llm: 'coreano' },
  it: { name: 'Italiano', whisper: 'italian', llm: 'italiano' }
} as const
export type TransLang = keyof typeof TRANS_LANGS
export type DictationMode = 'continuous' | 'controlled'
export type LLMKind = 'ollama' | 'anthropic' | 'claude-cli' | 'opencode' | 'openai-compat'
export type Theme = 'system' | 'dark' | 'light'
export type Tone = 'neutral' | 'formal' | 'casual' | 'concise'
export type PromptTarget = 'generic' | 'claude-code' | 'opencode' | 'cursor' | 'chatgpt'
export type SttProvider = 'local' | 'openai'
export type TtsProvider = 'piper' | 'openai'

export interface DictEntry {
  /** como lo transcribe Whisper (o como lo dices) */
  from: string
  /** como debe escribirse; si está vacío, solo se usa como término a respetar */
  to: string
}

export interface LLMConfig {
  kind: LLMKind
  model: string
  baseUrl?: string
}

export interface Settings {
  onboarded: boolean
  primaryLang: Lang
  secondaryLang: Lang | null
  sttModel: string
  llm: LLMConfig
  enabledProviders: LLMKind[]
  tone: Tone
  autoRewrite: boolean
  stopEnabled: boolean
  micDeviceId: string
  mode: DictationMode
  strictOffline: boolean
  theme: Theme
  dictionary: DictEntry[]
  voiceCommands: boolean
  projectDir: string
  promptTarget: PromptTarget
  vaultDir: string
  sttProvider: SttProvider
  ttsProvider: TtsProvider
  ttsVoice: Record<Lang, string>
  ttsSpeed: number
  cloudAudio: { baseUrl: string; sttModel: string; ttsModel: string; ttsVoice: string }
  /** Motor de voz local: Whisper en Transformers.js (incluido) o whisper.cpp (binario externo `whisper-server`) */
  sttEngine: SttEngine
  whisperCpp: { bin: string; model: string }
  /** Perfil de rendimiento: 'auto' lo decide DictaFlow según el equipo */
  hwProfile: HwProfileSetting
  /** Silencio (ms) que cierra una frase en el modo «Parlante activo» */
  pauseMs: number
  /** Texto provisional mientras hablas */
  draftsEnabled: boolean
  /** Espera (ms) tras la última frase antes de redactar automáticamente */
  rewriteDelayMs: number
  /** Redacción automática: solo se redacta lo nuevo y se añade, en vez de rehacer todo el texto */
  rewriteIncremental: boolean
  /** Descarta la redacción si cambia cifras, horas o cantidades */
  guardNumbers: boolean
  /** Filtros del micrófono. Apagarlos suele mejorar la precisión de Whisper. */
  micFilters: MicFilters
}

/** Procesado que aplica el navegador al audio del micrófono antes de enviarlo. */
export interface MicFilters {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export type SttEngine = 'transformers' | 'whispercpp'
export type HwProfile = 'light' | 'balanced' | 'accelerated'
export type HwProfileSetting = 'auto' | HwProfile

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  primaryLang: 'es',
  secondaryLang: 'en',
  sttModel: 'Xenova/whisper-small',
  llm: { kind: 'ollama', model: 'qwen2.5-coder:3b', baseUrl: 'http://127.0.0.1:11434' },
  enabledProviders: ['ollama'],
  tone: 'neutral',
  autoRewrite: true,
  stopEnabled: true,
  micDeviceId: 'default',
  mode: 'controlled',
  strictOffline: false,
  theme: 'system',
  dictionary: [],
  voiceCommands: true,
  projectDir: '',
  promptTarget: 'generic',
  vaultDir: '',
  sttProvider: 'local',
  ttsProvider: 'piper',
  ttsVoice: { es: 'es_ES-davefx-medium', en: 'en_US-lessac-medium' },
  ttsSpeed: 1,
  cloudAudio: { baseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1', ttsModel: 'tts-1', ttsVoice: 'alloy' },
  sttEngine: 'transformers',
  whisperCpp: { bin: '', model: '' },
  hwProfile: 'auto',
  pauseMs: 900,
  draftsEnabled: true,
  rewriteDelayMs: 2500,
  rewriteIncremental: true,
  guardNumbers: true,
  micFilters: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
}

export interface HardwareInfo {
  cpu: string
  cores: number
  cpuFlags: { avx: boolean; avx2: boolean; avx512: boolean }
  arch: string
  ramGB: number
  gpu: string
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'none'
  diskFreeGB: number
  ollama: { installed: boolean; running: boolean; models: string[] }
  clis: { claude: boolean; opencode: boolean }
}

export interface ModelRec {
  id: string
  kind: 'stt' | 'llm'
  label: string
  sizeMB: number
  status: 'recommended' | 'ok' | 'slow'
  note: string
}

export interface RewriteRequest {
  text: string
  lang: Lang
  tone: Tone
  mode: 'rewrite' | 'prompt' | 'changes'
  /** versión previa, para pedir una alternativa distinta */
  previous?: string
  /** modo programador: destino y contexto del repositorio */
  target?: PromptTarget
  projectContext?: string
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface SavedPrompt {
  id: string
  title: string
  text: string
  tags: string[]
  rating: 0 | 1 | -1
  createdAt: number
}

export interface Segment {
  start: number
  end: number
  text: string
  /**
   * Quién habla. Hay tres niveles y no se mezclan:
   *  - «Hablante 1», «Yo», «Sistema»: atribución técnica, sin identidad.
   *  - Un nombre puesto por el usuario: atribución manual.
   *  - `speakerId`: identidad técnica estable dentro de la reunión.
   */
  speaker?: string
  /** Identidad técnica del hablante dentro de esta reunión. */
  speakerId?: number
  /** true si el usuario confirmó que ese hablante es quien dice ese nombre. */
  speakerConfirmed?: boolean
}

/** Una tarea con su responsable y su fecha límite, tal como se extrae del acta. */
export interface MeetingTask {
  text: string
  /** Responsable, si la transcripción lo menciona. */
  owner: string
  /** Fecha límite, si la transcripción la menciona. */
  due: string
  done: boolean
}

/** El acta de una reunión, con las partes separadas. */
export interface MeetingMinutes {
  summary: string
  topics: string[]
  decisions: string[]
  agreements: string[]
  tasks: MeetingTask[]
}

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationSec: number
  source: 'mic' | 'system' | 'both' | 'file'
  segments: Segment[]
  summary: string
  /** Acta estructurada, si se generó. */
  minutes?: MeetingMinutes
  /** Ruta del audio grabado, para volver a transcribirlo. */
  audioPath?: string
}

export interface TtsStatus {
  piperInstalled: boolean
  voices: string[]
}

/** Una voz personal: la que ha creado el usuario a partir de una muestra. */
export interface PersonalVoice {
  id: string
  /** Nombre que le da el usuario. */
  name: string
  /** Motor con el que se sintetiza. */
  engine: string
  /** Idioma principal de la voz. */
  lang: Lang
  /** Grabación original de la que sale. */
  sampleId?: string
  /** Voz local de Piper que lee esta voz (motor «piper»). */
  piperVoice?: string
  /**
   * Consentimiento de la persona cuya voz es. Sin esto no se puede guardar la
   * voz: no se clonan voces de terceros sin autorización.
   */
  consent: {
    /** Nombre de quien autoriza. */
    authorizedBy: string
    /** Fecha del consentimiento. */
    date: number
    /** Notas: por ejemplo, con fines de uso personal. */
    notes: string
  }
  createdAt: number
  /** Frase de prueba, para oír cómo suena. */
  testPhrase: string
  /** Si el motor puede sintetizarla ahora mismo. */
  available: boolean
  /** Motivo por el que no está disponible. */
  unavailableReason?: string
}

/** Una grabación original que el usuario ha importado o grabado. */
export interface VoiceRecording {
  id: string
  name: string
  /** Ruta del fichero de audio. */
  path: string
  /** Duración en segundos. */
  durationSec: number
  createdAt: number
  /** Quién es la persona de la grabación (lo dice el usuario). */
  speaker: string
}

/** Estado de los motores de reconocimiento de voz. */
export interface SttStatus {
  /** Motor elegido en los ajustes. */
  engine: SttEngine
  /** Motor que está sirviendo peticiones ahora mismo. */
  active: 'transformers' | 'whispercpp'
  /** Por qué se usa el motor de reserva, si se usa. */
  fallbackReason: string | null
  /** El modelo de Transformers.js elegido ya está descargado. */
  modelInstalled: boolean
  cpp: {
    bin: string
    model: string
    ggml: { id: string; label: string; sizeMB: number; installed: boolean }[]
  }
}

export interface LibraryDoc {
  id: string
  title: string
  kind: 'pdf' | 'epub' | 'txt' | 'md'
  /** capítulos con texto ya extraído */
  chapters: { title: string; text: string }[]
  addedAt: number
  progress: { chapter: number; paragraph: number }
}

/**
 * La biblioteca se guarda partida: el índice (sin texto) y el contenido.
 * Guardarlo todo junto obligaba a reescribir el libro entero cada vez que
 * cambiaba el punto de lectura.
 */
export interface LibraryMeta {
  id: string
  title: string
  kind: LibraryDoc['kind']
  /** títulos y tamaño de cada capítulo, sin el texto */
  chapters: { title: string; chars: number }[]
  addedAt: number
  progress: { chapter: number; paragraph: number }
}

/** Una transcripción guardada en el historial. */
export interface HistoryItem {
  id: string
  createdAt: number
  raw: string
  polished: string
  kind: 'rewrite' | 'prompt'
}

export interface NetEvent {
  ts: number
  host: string
  purpose: string
  bytes: number
}

export type SecretName = 'anthropic' | 'openai-compat' | 'openai-audio'

export interface PillState {
  state: 'idle' | 'listening' | 'working' | 'done' | 'error'
  message: string
}
