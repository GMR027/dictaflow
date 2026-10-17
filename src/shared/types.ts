export type Lang = 'es' | 'en'
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
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  primaryLang: 'es',
  secondaryLang: 'en',
  sttModel: 'Xenova/whisper-small',
  llm: { kind: 'ollama', model: 'qwen2.5-coder:3b', baseUrl: 'http://127.0.0.1:11434' },
  enabledProviders: ['ollama'],
  tone: 'neutral',
  autoRewrite: true,
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
  cloudAudio: { baseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1', ttsModel: 'tts-1', ttsVoice: 'alloy' }
}

export interface HardwareInfo {
  cpu: string
  cores: number
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
  mode: 'rewrite' | 'prompt'
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
  /** Quién habla cuando se graba mic + sistema ('Yo' / 'Sistema') */
  speaker?: string
}

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationSec: number
  source: 'mic' | 'system' | 'both' | 'file'
  segments: Segment[]
  summary: string
}

export interface TtsStatus {
  piperInstalled: boolean
  voices: string[]
}

export interface Voice {
  id: string
  lang: Lang
  label: string
  /** ruta dentro del repo rhasspy/piper-voices */
  path: string
  sizeMB: number
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
