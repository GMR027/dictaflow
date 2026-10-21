// Contrato entre el proceso principal y la interfaz.
//
// Antes los nombres de canal y la forma de los argumentos vivían duplicados en
// `src/main/index.ts` y `src/preload/index.ts`: un error de tecleo se descubría
// en runtime. Aquí se declara una sola vez y los dos extremos la usan, de modo
// que el compilador avisa si un canal cambia de firma o desaparece.
import type { ChatMsg, HardwareInfo, HistoryItem, Lang, LibraryDoc, LibraryMeta, ModelRec, NetEvent, PillState, RewriteRequest, SecretName, Segment, Settings, SttStatus, TtsStatus, TransLang } from './types'
import type { UpdateInfo } from './update'
import type { Voice, VoiceStatus } from './voice'
import type { Job } from './job'
import type { BackupInfo, Diagnostics } from './diagnostics'
import type { CalendarEvent, Reminder } from './calendar'

/** Colecciones guardadas como documentos en la carpeta de datos. */
export type Collection = 'prompts' | 'meetings' | 'library'

/** Prioridad de una transcripción: la definitiva nunca espera a un borrador. */
export type SttPriority = 'final' | 'draft'

/** Resultado de una transcripción: el texto, los segmentos y lo que tardó. */
export interface TranscribeResult {
  text: string
  segments: Segment[]
  /** Milisegundos que tardó la inferencia (sin contar la espera en cola). */
  ms: number
}

export interface IpcContract {
  'settings:get': { req: void; res: Settings }
  'settings:save': { req: Partial<Settings>; res: Settings }
  'secret:set': { req: { name: SecretName; value: string }; res: void }
  'secret:has': { req: { name: SecretName }; res: boolean }

  'hw:detect': { req: void; res: { hw: HardwareInfo; recs: ModelRec[] } }
  'ollama:list': { req: { base?: string } | void; res: { running: boolean; models: string[] } }
  'ollama:install': { req: void; res: 'installed' | 'cancelled' }
  'ollama:start': { req: void; res: boolean }
  'ollama:pull': { req: { name: string }; res: void }

  'stt:load': { req: void; res: void }
  'stt:status': { req: void; res: SttStatus }
  'stt:bench': { req: void; res: { engine: string; model: string; loadMs: number; ms: number } }
  'stt:download-ggml': { req: { id: string }; res: void }
  'stt:transcribe': { req: { pcm: Float32Array; lang: TransLang | 'auto'; priority?: SttPriority }; res: TranscribeResult }
  'stt:detailed': { req: { pcm: Float32Array; lang: TransLang | 'auto'; timestamps: boolean; priority?: SttPriority }; res: TranscribeResult }
  'dict:apply': { req: { text: string }; res: string }

  'llm:rewrite': { req: RewriteRequest; res: string }
  'llm:warm': { req: void; res: void }
  'llm:chat': { req: { system: string; msgs: ChatMsg[] }; res: string }
  'llm:translate': { req: { text: string; to: TransLang }; res: string }
  'llm:generate': { req: { action: string; text: string; lang: Lang }; res: string }
  'llm:test': { req: void; res: string }

  'col:get': { req: { name: Collection }; res: unknown[] }
  'col:save': { req: { name: Collection; items: unknown[] }; res: void }

  'library:list': { req: void; res: LibraryMeta[] }
  'library:get': { req: { id: string }; res: LibraryDoc | null }
  'library:save': { req: { doc: LibraryDoc }; res: void }
  'library:progress': { req: { id: string; progress: LibraryDoc['progress'] }; res: void }
  'library:remove': { req: { id: string }; res: void }

  'jobs:list': { req: void; res: Job[] }
  'jobs:cancel': { req: { id: string }; res: boolean }
  'jobs:clear': { req: void; res: void }
  'audio:export': { req: { text: string; lang: Lang; voice?: string; name: string }; res: string }
  'audio:audiobook': { req: { docId: string; lang: Lang; voice?: string }; res: Job }
  'audio:audiobooks': { req: void; res: { title: string; dir: string; files: number; sizeMB: number }[] }

  'diagnostics:report': { req: void; res: Diagnostics }
  'backup:create': { req: { dest?: string }; res: BackupInfo }
  'backup:restore': { req: { data: Uint8Array }; res: { restored: string[]; skipped: string[] } }

  'pdf:generate': { req: { title: string; body: string; name?: string }; res: string }

  'cal:list': { req: void; res: CalendarEvent[] }
  'cal:save': { req: { event: CalendarEvent }; res: void }
  'cal:remove': { req: { id: string }; res: void }
  'cal:export': { req: void; res: string }
  'cal:import': { req: { data: string }; res: number }
  'rem:list': { req: void; res: Reminder[] }
  'rem:save': { req: { reminder: Reminder }; res: void }
  'rem:remove': { req: { id: string }; res: void }

  'tts:status': { req: void; res: TtsStatus & { catalog: VoiceStatus[] } }
  'tts:install-piper': { req: void; res: void }
  'tts:install-voice': { req: { id: string }; res: void }
  'tts:remove-voice': { req: { id: string }; res: void }
  'tts:sample': { req: { id: string }; res: Uint8Array }
  'tts:synth': { req: { text: string; lang: Lang; voice?: string }; res: Uint8Array }

  'project:pick': { req: void; res: string }
  'vault:pick': { req: void; res: string }
  'project:context': { req: void; res: string }
  'agent:launch': { req: { agent: 'claude-code' | 'opencode'; prompt: string }; res: 'launched' | 'cancelled' }
  'note:export': { req: { title: string; body: string; tags: string[] }; res: string }
  'file:save': { req: { name: string; data: Uint8Array | string }; res: string }
  'file:open': { req: { title: string; exts: string[] }; res: { name: string; data: Uint8Array } | null }

  'sysaudio:start': { req: void; res: void }
  'sysaudio:stop': { req: void; res: void }

  'history:get': { req: void; res: HistoryItem[] }
  'history:save': { req: { items: HistoryItem[] }; res: void }

  'net:events': { req: void; res: { events: NetEvent[]; dataDir: string } }
  'net:clear': { req: void; res: void }
  'app:launch-cmd': { req: void; res: string }
  'app:version': { req: void; res: string }
  'app:open-data-dir': { req: void; res: string }
  'update:check': { req: void; res: UpdateInfo }
  'update:apply': { req: void; res: 'relaunching' | 'downloaded' | 'opened' | 'cancelled' }
  'uninstall:info': { req: void; res: { kind: string; command: string; runnable: boolean; dataPaths: string[]; dataSizeMB: number } }
  'uninstall:run': { req: { removeData: boolean }; res: 'done' | 'cancelled' }

  'clipboard:write': { req: { text: string }; res: void }
  'notify': { req: { title: string; body: string }; res: void }
  'pill:set': { req: { state: PillState }; res: void }
}

/** Eventos que el proceso principal envía a la interfaz. */
export interface IpcEvents {
  'ollama:install-log': string
  'ollama:pull-progress': { name: string; pct: number; status: string }
  'stt:progress': { file?: string; progress?: number; status: string }
  'llm:notice': string
  'tts:progress': { what: string; pct: number }
  'sysaudio:chunk': Float32Array
  'sysaudio:error': string
  'update:progress': number
  'pill:state': PillState
  'dictation:toggle': void
  'jobs:changed': Job[]
}

export type IpcChannel = keyof IpcContract
export type IpcReq<K extends IpcChannel> = IpcContract[K]['req']
export type IpcRes<K extends IpcChannel> = IpcContract[K]['res']
export type IpcEvent = keyof IpcEvents
