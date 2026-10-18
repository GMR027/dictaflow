import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateInfo } from '@shared/update'
import type { ChatMsg, HardwareInfo, Lang, TransLang, ModelRec, NetEvent, PillState, RewriteRequest, SecretName, Segment, Settings, TtsStatus, Voice } from '@shared/types'

const on = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const h = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (p: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:save', p),
  setSecret: (n: SecretName, v: string): Promise<void> => ipcRenderer.invoke('secret:set', n, v),
  hasSecret: (n: SecretName): Promise<boolean> => ipcRenderer.invoke('secret:has', n),

  detectHardware: (): Promise<{ hw: HardwareInfo; recs: ModelRec[] }> => ipcRenderer.invoke('hw:detect'),
  listOllama: (base?: string): Promise<{ running: boolean; models: string[] }> => ipcRenderer.invoke('ollama:list', base),
  installOllama: (): Promise<'installed' | 'cancelled'> => ipcRenderer.invoke('ollama:install'),
  startOllama: (): Promise<boolean> => ipcRenderer.invoke('ollama:start'),
  onInstallLog: (cb: (line: string) => void) => on('ollama:install-log', cb),
  pullOllama: (name: string): Promise<void> => ipcRenderer.invoke('ollama:pull', name),
  onPullProgress: (cb: (p: { name: string; pct: number; status: string }) => void) => on('ollama:pull-progress', cb),

  loadStt: (): Promise<void> => ipcRenderer.invoke('stt:load'),
  onSttProgress: (cb: (p: { file?: string; progress?: number; status: string }) => void) => on('stt:progress', cb),
  transcribe: (pcm: Float32Array, lang: TransLang | 'auto'): Promise<string> => ipcRenderer.invoke('stt:transcribe', pcm, lang),

  transcribeDetailed: (pcm: Float32Array, lang: TransLang | 'auto', timestamps = false): Promise<{ text: string; segments: Segment[] }> =>
    ipcRenderer.invoke('stt:detailed', pcm, lang, timestamps),
  applyDictionary: (text: string): Promise<string> => ipcRenderer.invoke('dict:apply', text),
  chat: (system: string, msgs: ChatMsg[]): Promise<string> => ipcRenderer.invoke('llm:chat', system, msgs),
  translate: (text: string, to: TransLang): Promise<string> => ipcRenderer.invoke('llm:translate', text, to),
  generate: (action: string, text: string, lang: Lang): Promise<string> => ipcRenderer.invoke('llm:generate', action, text, lang),

  getCollection: <T>(name: 'prompts' | 'meetings' | 'library'): Promise<T[]> => ipcRenderer.invoke('col:get', name),
  saveCollection: (name: 'prompts' | 'meetings' | 'library', items: unknown[]): Promise<void> => ipcRenderer.invoke('col:save', name, items),

  ttsStatus: (): Promise<TtsStatus & { catalog: Voice[] }> => ipcRenderer.invoke('tts:status'),
  installPiper: (): Promise<void> => ipcRenderer.invoke('tts:install-piper'),
  installVoice: (id: string): Promise<void> => ipcRenderer.invoke('tts:install-voice', id),
  onTtsProgress: (cb: (p: { what: string; pct: number }) => void) => on('tts:progress', cb),
  synthesize: (text: string, lang: Lang): Promise<Uint8Array> => ipcRenderer.invoke('tts:synth', text, lang),

  pickProject: (): Promise<string> => ipcRenderer.invoke('project:pick'),
  pickVault: (): Promise<string> => ipcRenderer.invoke('vault:pick'),
  projectContext: (): Promise<string> => ipcRenderer.invoke('project:context'),
  launchAgent: (agent: 'claude-code' | 'opencode', prompt: string): Promise<'launched' | 'cancelled'> => ipcRenderer.invoke('agent:launch', agent, prompt),
  exportNote: (title: string, body: string, tags: string[]): Promise<string> => ipcRenderer.invoke('note:export', title, body, tags),
  saveFile: (name: string, data: Uint8Array | string): Promise<string> => ipcRenderer.invoke('file:save', name, data),
  openFile: (title: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null> => ipcRenderer.invoke('file:open', title, exts),
  startSystemAudio: (): Promise<void> => ipcRenderer.invoke('sysaudio:start'),
  stopSystemAudio: (): Promise<void> => ipcRenderer.invoke('sysaudio:stop'),
  onSystemAudio: (cb: (pcm: Float32Array) => void) => on('sysaudio:chunk', cb),

  rewrite: (req: RewriteRequest): Promise<string> => ipcRenderer.invoke('llm:rewrite', req),
  testLLM: (): Promise<string> => ipcRenderer.invoke('llm:test'),

  getHistory: () => ipcRenderer.invoke('history:get'),
  saveHistory: (items: unknown[]): Promise<void> => ipcRenderer.invoke('history:save', items),

  getNetEvents: (): Promise<{ events: NetEvent[]; dataDir: string }> => ipcRenderer.invoke('net:events'),
  clearNetEvents: (): Promise<void> => ipcRenderer.invoke('net:clear'),
  launchCmd: (): Promise<string> => ipcRenderer.invoke('app:launch-cmd'),
  checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
  applyUpdate: (): Promise<'relaunching' | 'downloaded' | 'opened' | 'cancelled'> => ipcRenderer.invoke('update:apply'),
  onUpdateProgress: (cb: (pct: number) => void) => on('update:progress', cb),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  uninstallInfo: (): Promise<{ kind: string; command: string; runnable: boolean; dataPaths: string[]; dataSizeMB: number }> => ipcRenderer.invoke('uninstall:info'),
  uninstall: (removeData: boolean): Promise<'done' | 'cancelled'> => ipcRenderer.invoke('uninstall:run', removeData),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:open-data-dir'),

  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke('notify', title, body),
  setPill: (s: PillState): Promise<void> => ipcRenderer.invoke('pill:set', s),
  onPill: (cb: (s: PillState) => void) => on('pill:state', cb),
  onToggleDictation: (cb: () => void) => on<void>('dictation:toggle', cb)
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
