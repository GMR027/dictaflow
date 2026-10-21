import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcEvent, IpcEvents, IpcReq, IpcRes, SttPriority, TranscribeResult } from '@shared/ipc'
import type { ChatMsg, HardwareInfo, HistoryItem, Lang, LibraryDoc, LibraryMeta, MeetingMinutes, ModelRec, NetEvent, PillState, RewriteRequest, SecretName, Segment, Settings, SttStatus, TtsStatus, TransLang } from '@shared/types'
import type { Job } from '@shared/job'
import type { BackupInfo, Diagnostics } from '@shared/diagnostics'
import type { CalendarEvent, Reminder } from '@shared/calendar'
import type { UpdateInfo } from '@shared/update'
import type { VoiceStatus } from '@shared/voice'

/** Invoca un canal del contrato: el nombre y los argumentos están verificados por el compilador. */
const invoke = <K extends IpcChannel>(channel: K, req?: IpcReq<K>): Promise<IpcRes<K>> =>
  ipcRenderer.invoke(channel, req) as Promise<IpcRes<K>>

/** Se suscribe a un evento del proceso principal. */
const on = <K extends IpcEvent>(channel: K, cb: (payload: IpcEvents[K]) => void): (() => void) => {
  const h = (_e: unknown, payload: IpcEvents[K]): void => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api = {
  getSettings: (): Promise<Settings> => invoke('settings:get'),
  saveSettings: (p: Partial<Settings>): Promise<Settings> => invoke('settings:save', p),
  setSecret: (n: SecretName, v: string): Promise<void> => invoke('secret:set', { name: n, value: v }),
  hasSecret: (n: SecretName): Promise<boolean> => invoke('secret:has', { name: n }),

  detectHardware: (): Promise<{ hw: HardwareInfo; recs: ModelRec[] }> => invoke('hw:detect'),
  listOllama: (base?: string): Promise<{ running: boolean; models: string[] }> => invoke('ollama:list', { base }),
  installOllama: (): Promise<'installed' | 'cancelled'> => invoke('ollama:install'),
  startOllama: (): Promise<boolean> => invoke('ollama:start'),
  onInstallLog: (cb: (line: string) => void) => on('ollama:install-log', cb),
  pullOllama: (name: string): Promise<void> => invoke('ollama:pull', { name }),
  onPullProgress: (cb: (p: { name: string; pct: number; status: string }) => void) => on('ollama:pull-progress', cb),

  loadStt: (): Promise<void> => invoke('stt:load'),
  sttStatus: (): Promise<SttStatus> => invoke('stt:status'),
  benchStt: (): Promise<{ engine: string; model: string; loadMs: number; ms: number }> => invoke('stt:bench'),
  downloadGgml: (id: string): Promise<void> => invoke('stt:download-ggml', { id }),
  onLlmNotice: (cb: (msg: string) => void) => on('llm:notice', cb),
  onSttProgress: (cb: (p: { file?: string; progress?: number; status: string }) => void) => on('stt:progress', cb),
  transcribe: (pcm: Float32Array, lang: TransLang | 'auto', priority: SttPriority = 'final'): Promise<TranscribeResult> =>
    invoke('stt:transcribe', { pcm, lang, priority }),

  transcribeDetailed: (pcm: Float32Array, lang: TransLang | 'auto', timestamps = false, priority: SttPriority = 'final'): Promise<TranscribeResult> =>
    invoke('stt:detailed', { pcm, lang, timestamps, priority }),
  applyDictionary: (text: string): Promise<string> => invoke('dict:apply', { text }),
  chat: (system: string, msgs: ChatMsg[]): Promise<string> => invoke('llm:chat', { system, msgs }),
  translate: (text: string, to: TransLang): Promise<string> => invoke('llm:translate', { text, to }),
  generate: (action: string, text: string, lang: Lang): Promise<string> => invoke('llm:generate', { action, text, lang }),
  minutes: (text: string, lang: Lang): Promise<MeetingMinutes | null> => invoke('llm:minutes', { text, lang }),

  getCollection: <T>(name: 'prompts' | 'meetings' | 'library'): Promise<T[]> => invoke('col:get', { name }) as Promise<T[]>,
  saveCollection: (name: 'prompts' | 'meetings' | 'library', items: unknown[]): Promise<void> => invoke('col:save', { name, items }),

  listLibrary: (): Promise<LibraryMeta[]> => invoke('library:list'),
  getLibraryDoc: (id: string): Promise<LibraryDoc | null> => invoke('library:get', { id }),
  saveLibraryDoc: (doc: LibraryDoc): Promise<void> => invoke('library:save', { doc }),
  setLibraryProgress: (id: string, progress: LibraryDoc['progress']): Promise<void> => invoke('library:progress', { id, progress }),
  removeLibraryDoc: (id: string): Promise<void> => invoke('library:remove', { id }),

  listJobs: (): Promise<Job[]> => invoke('jobs:list'),
  cancelJob: (id: string): Promise<boolean> => invoke('jobs:cancel', { id }),
  clearJobs: (): Promise<void> => invoke('jobs:clear'),
  onJobsChanged: (cb: (jobs: Job[]) => void) => on('jobs:changed', cb),
  exportAudio: (text: string, lang: Lang, voice: string | undefined, name: string): Promise<string> => invoke('audio:export', { text, lang, voice, name }),
  startAudiobook: (docId: string, lang: Lang, voice?: string): Promise<Job> => invoke('audio:audiobook', { docId, lang, voice }),
  listAudiobooks: (): Promise<{ title: string; dir: string; files: number; sizeMB: number }[]> => invoke('audio:audiobooks'),

  diagnostics: (): Promise<Diagnostics> => invoke('diagnostics:report'),
  createBackup: (dest?: string): Promise<BackupInfo> => invoke('backup:create', { dest }),
  restoreBackup: (data: Uint8Array): Promise<{ restored: string[]; skipped: string[] }> => invoke('backup:restore', { data }),

  generatePdf: (title: string, body: string, name?: string): Promise<string> => invoke('pdf:generate', { title, body, name }),

  listEvents: (): Promise<CalendarEvent[]> => invoke('cal:list'),
  saveEvent: (event: CalendarEvent): Promise<void> => invoke('cal:save', { event }),
  removeEvent: (id: string): Promise<void> => invoke('cal:remove', { id }),
  exportCalendar: (): Promise<string> => invoke('cal:export'),
  importCalendar: (data: string): Promise<number> => invoke('cal:import', { data }),
  listReminders: (): Promise<Reminder[]> => invoke('rem:list'),
  saveReminder: (reminder: Reminder): Promise<void> => invoke('rem:save', { reminder }),
  removeReminder: (id: string): Promise<void> => invoke('rem:remove', { id }),

  startMeetingAudio: (sessionId: string): Promise<{ sessionId: string; path: string }> => invoke('meeting:audio-start', { sessionId }),
  pushMeetingAudio: (sessionId: string, pcm: Float32Array): Promise<void> => invoke('meeting:audio-chunk', { sessionId, pcm }),
  stopMeetingAudio: (sessionId: string): Promise<{ path: string; durationSec: number } | null> => invoke('meeting:audio-stop', { sessionId }),
  discardMeetingAudio: (sessionId: string): Promise<void> => invoke('meeting:audio-discard', { sessionId }),

  ttsStatus: (): Promise<TtsStatus & { catalog: VoiceStatus[] }> => invoke('tts:status'),
  installPiper: (): Promise<void> => invoke('tts:install-piper'),
  installVoice: (id: string): Promise<void> => invoke('tts:install-voice', { id }),
  removeVoice: (id: string): Promise<void> => invoke('tts:remove-voice', { id }),
  voiceSample: (id: string): Promise<Uint8Array> => invoke('tts:sample', { id }),
  onTtsProgress: (cb: (p: { what: string; pct: number }) => void) => on('tts:progress', cb),
  synthesize: (text: string, lang: Lang, voice?: string): Promise<Uint8Array> => invoke('tts:synth', { text, lang, voice }),

  pickProject: (): Promise<string> => invoke('project:pick'),
  pickVault: (): Promise<string> => invoke('vault:pick'),
  projectContext: (): Promise<string> => invoke('project:context'),
  launchAgent: (agent: 'claude-code' | 'opencode', prompt: string): Promise<'launched' | 'cancelled'> => invoke('agent:launch', { agent, prompt }),
  exportNote: (title: string, body: string, tags: string[]): Promise<string> => invoke('note:export', { title, body, tags }),
  saveFile: (name: string, data: Uint8Array | string): Promise<string> => invoke('file:save', { name, data }),
  openFile: (title: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null> => invoke('file:open', { title, exts }),
  startSystemAudio: (): Promise<void> => invoke('sysaudio:start'),
  stopSystemAudio: (): Promise<void> => invoke('sysaudio:stop'),
  onSystemAudio: (cb: (pcm: Float32Array) => void) => on('sysaudio:chunk', cb),

  rewrite: (req: RewriteRequest): Promise<string> => invoke('llm:rewrite', req),
  warmLLM: (): Promise<void> => invoke('llm:warm'),
  testLLM: (): Promise<string> => invoke('llm:test'),

  getHistory: (): Promise<HistoryItem[]> => invoke('history:get'),
  saveHistory: (items: HistoryItem[]): Promise<void> => invoke('history:save', { items }),

  getNetEvents: (): Promise<{ events: NetEvent[]; dataDir: string }> => invoke('net:events'),
  clearNetEvents: (): Promise<void> => invoke('net:clear'),
  launchCmd: (): Promise<string> => invoke('app:launch-cmd'),
  checkUpdate: (): Promise<UpdateInfo> => invoke('update:check'),
  applyUpdate: (): Promise<'relaunching' | 'downloaded' | 'opened' | 'cancelled'> => invoke('update:apply'),
  onUpdateProgress: (cb: (pct: number) => void) => on('update:progress', cb),
  appVersion: (): Promise<string> => invoke('app:version'),
  uninstallInfo: (): Promise<{ kind: string; command: string; runnable: boolean; dataPaths: string[]; dataSizeMB: number }> => invoke('uninstall:info'),
  uninstall: (removeData: boolean): Promise<'done' | 'cancelled'> => invoke('uninstall:run', { removeData }),
  openDataDir: (): Promise<string> => invoke('app:open-data-dir'),

  copy: (text: string): Promise<void> => invoke('clipboard:write', { text }),
  notify: (title: string, body: string): Promise<void> => invoke('notify', { title, body }),
  setPill: (s: PillState): Promise<void> => invoke('pill:set', { state: s }),
  onPill: (cb: (s: PillState) => void) => on('pill:state', cb),
  onToggleDictation: (cb: () => void) => on('dictation:toggle', () => cb())
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
