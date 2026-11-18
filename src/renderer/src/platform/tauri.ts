// `window.api` en Android (Tauri 2).
//
// La interfaz es la misma que en escritorio (`src/preload/api.ts`); aquí solo cambia cómo se
// atiende cada canal del contrato (`@shared/ipc`):
//   • lo que es puro dato (ajustes, colecciones, historial…) se resuelve en TypeScript sobre un
//     almacén de documentos versionados que guarda Rust (`doc_get` / `doc_set`);
//   • lo que necesita el sistema o la IA local (Whisper, LLM, voces, archivos) llama a comandos
//     de Rust, que se van añadiendo por fases;
//   • lo que no existe en Android (Ollama, agentes CLI, audio del sistema, píldora, desinstalar)
//     falla con un mensaje claro; la interfaz oculta esas opciones con `api.platform`.
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import type { IpcChannel, IpcContract, IpcEvent, IpcEvents, IpcReq, IpcRes, SttPriority, TranscribeResult } from '@shared/ipc'
import { DEFAULT_SETTINGS, type ChatMsg, type HistoryItem, type Lang, type Settings, type SttStatus } from '@shared/types'
import { normalizeModel } from '@shared/providers'
import { applyDictionary } from '@shared/dictionary'
import { createLlmTasks, type ContentAction, type LlmLimits } from '@shared/llm-tasks'
import { LOCAL_MODELS, localVoice, localVoiceSample, modelReady, type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelProgress } from '@shared/local-models'
import { VOICE_META } from '@shared/voice-catalog'
import type { VoiceStatus } from '@shared/voice'
import { createApi, type Invoke, type On } from '../../../preload/api'
import { createDataHandlers, netGuard } from './android-datos'

/** Error para lo que aún no existe en Android (o no existirá). */
class NoDisponible extends Error {
  constructor(what: string) {
    super(`${what} no está disponible en Android.`)
  }
}

/** Documento guardado por Rust: los datos y la versión de su formato. */
interface Doc<T> { version: number; data: T }

const docGet = async <T>(name: string, fallback: T): Promise<T> => {
  const doc = await tauriInvoke<Doc<T> | null>('doc_get', { name })
  return doc ? doc.data : fallback
}
const docSet = (name: string, data: unknown): Promise<void> => tauriInvoke('doc_set', { name, data })

// ── Ajustes ─────────────────────────────────────────────────────────────────────────────────
// Mismas reglas que `src/main/store.ts`: valores por defecto + lo guardado, con el ID del modelo
// normalizado. Se escriben de inmediato (no hay cierre de proceso que esperar en Android).
let settings: Settings | null = null

/** En Android no hay modelo de voz hasta que el usuario descarga uno (los de escritorio no sirven). */
const ANDROID_DEFAULTS: Partial<Settings> = { sttModel: '', localLlm: '' }

async function getSettings(): Promise<Settings> {
  if (settings) return settings
  const stored = await docGet<Partial<Settings>>('settings', {})
  const merged = { ...DEFAULT_SETTINGS, ...ANDROID_DEFAULTS, ...stored }
  settings = { ...merged, llm: { ...merged.llm, model: normalizeModel(merged.llm.kind, merged.llm.model) } }
  return settings
}

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...patch }
  settings = { ...merged, llm: { ...merged.llm, model: normalizeModel(merged.llm.kind, merged.llm.model) } }
  await docSet('settings', settings)
  return settings
}

// ── Voz → texto ─────────────────────────────────────────────────────────────────────────────
/**
 * Whisper corre en Rust. El audio va como bytes crudos (un JSON de cientos de miles de números
 * sería lento) y los parámetros en cabeceras. Después se aplica el diccionario personal, igual
 * que en escritorio.
 */
async function transcribe(pcm: Float32Array, lang: string, timestamps: boolean, priority: SttPriority = 'final'): Promise<TranscribeResult> {
  const s = await getSettings()
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const r = await tauriInvoke<TranscribeResult>('stt_transcribe', bytes, {
    headers: { 'x-model': s.sttModel, 'x-lang': lang, 'x-priority': priority, 'x-timestamps': timestamps ? '1' : '0' }
  })
  return {
    text: applyDictionary(r.text, s.dictionary),
    segments: r.segments.map((x) => ({ ...x, text: applyDictionary(x.text, s.dictionary) })),
    ms: r.ms
  }
}

// ── Redacción con IA ───────────────────────────────────────────────────────────────────────
/**
 * El modelo GGUF corre en Rust (llama.cpp); los prompts son los de escritorio (@shared/llm-tasks).
 * Límites más cortos que en escritorio: el contexto del teléfono es de 8 K tokens (≈ 4 caracteres
 * por token, dejando sitio a la respuesta) y leer un texto largo tarda.
 */
const ANDROID_LIMITS: LlmLimits = { chunkChars: 8_000, maxChars: 8_000, minutesChars: 14_000 }

interface LlmRespuesta { text: string; prompt_tokens: number; reused_tokens: number; tokens: number; prompt_ms: number; ms: number }

async function localComplete(system: string, msgs: ChatMsg[], temperature = 0.4): Promise<string> {
  const model = (await getSettings()).localLlm
  if (!model) throw new Error('Descarga un modelo de redacción en Ajustes → Servicios de IA.')
  const r = await tauriInvoke<LlmRespuesta>('llm_complete', { model, system, msgs, temperature })
  console.debug(`[llm] ${r.prompt_tokens} tokens (${r.reused_tokens} ya leídos) en ${r.prompt_ms} ms · ${r.tokens} generados · ${r.ms} ms en total`)
  return r.text
}

const llm = createLlmTasks({ complete: localComplete, settings: getSettings, limits: ANDROID_LIMITS })

// ── Descargas de modelos ────────────────────────────────────────────────────────────────────
const listModels = (): Promise<LocalModelFile[]> => tauriInvoke<LocalModelFile[]>('models_list')

/** Empieza (o reanuda) la descarga de un modelo del catálogo y de su archivo acompañante. */
async function startDownload(m: LocalModel): Promise<void> {
  await netGuard(await getSettings(), `Descargar ${m.label}`, m.url)
  // Rust vuelve a validar dirección, nombre y huella.
  if (m.extra) await tauriInvoke('models_download', { url: m.extra.url, id: m.extra.id, bytes: m.extra.bytes, sha256: m.extra.sha256 })
  await tauriInvoke('models_download', { url: m.url, id: m.id, bytes: m.bytes, sha256: m.sha256 })
}

/** Descarga un modelo y espera a que esté completo (para «Descargar voz» fuera de Ajustes). */
async function downloadAndWait(m: LocalModel): Promise<void> {
  const pending = new Set([m.id, ...(m.extra ? [m.extra.id] : [])])
  for (const f of await listModels()) if (!f.partial) pending.delete(f.id)
  if (!pending.size) return
  let un: (() => void) | null = null
  const done = new Promise<void>((resolve, reject) => {
    void listen<LocalModelProgress>('models:progress', ({ payload: p }) => {
      if (!pending.has(p.id)) return
      if (p.state === 'downloading') emitLocal('tts:progress', { what: m.label, pct: p.total ? Math.floor((p.received / p.total) * 100) : 0 })
      else if (p.state === 'done') { pending.delete(p.id); if (!pending.size) resolve() }
      else if (p.state === 'error') reject(new Error(p.error ?? 'La descarga falló.'))
      else if (p.state === 'cancelled') reject(new Error('Descarga cancelada.'))
    }).then((u) => { un = u })
  })
  try {
    await startDownload(m)
    await done
  } finally {
    ;(un as (() => void) | null)?.()
  }
}

// ── Texto a voz ────────────────────────────────────────────────────────────────────────────
/** Voz Piper (sherpa-onnx en Rust). Devuelve un WAV. */
async function synthesize(text: string, lang: Lang, voiceId?: string): Promise<Uint8Array> {
  const s = await getSettings()
  const files = await listModels()
  let m = localVoice(voiceId ?? s.ttsVoice[lang])
  // Sin voz pedida y la de Ajustes no está descargada: cualquier otra descargada del mismo idioma.
  if (!voiceId && (!m || !modelReady(m, files))) {
    m = LOCAL_MODELS.find((x) => x.kind === 'tts' && x.lang === lang && modelReady(x, files)) ?? m
  }
  if (!m) throw new Error(`La voz ${voiceId ?? s.ttsVoice[lang]} no está disponible en Android: elige otra en Ajustes → Servicios de IA.`)
  if (!modelReady(m, files)) throw new Error(`Falta descargar la voz ${m.label} (Ajustes → Servicios de IA).`)
  const wav = await tauriInvoke<ArrayBuffer>('tts_synth', { voice: m.voice, text, speed: s.ttsSpeed })
  return new Uint8Array(wav)
}

// ── Eventos que nacen en la propia interfaz (en escritorio los manda el proceso principal) ────
const localListeners = new Map<string, Set<(payload: never) => void>>()
function emitLocal<K extends IpcEvent>(channel: K, payload: IpcEvents[K]): void {
  localListeners.get(channel)?.forEach((cb) => (cb as (p: IpcEvents[K]) => void)(payload))
}

// ── Tabla de canales ───────────────────────────────────────────────────────────────────────
type Handler<K extends IpcChannel> = (req: IpcReq<K>) => Promise<IpcRes<K>> | IpcRes<K>
type Handlers = { [K in IpcChannel]?: Handler<K> }

const handlers: Handlers = {
  'settings:get': () => getSettings(),
  'settings:save': (p) => saveSettings(p),
  'secret:set': ({ name, value }) => tauriInvoke('secret_set', { name, value }),
  'secret:has': ({ name }) => tauriInvoke<boolean>('secret_has', { name }),

  'models:device': async () => {
    const d = await tauriInvoke<{ ramBytes: number; freeBytes: number; cores: number }>('device_info')
    return { ramGB: Math.ceil(d.ramBytes / 2 ** 30), freeGB: Math.round((d.freeBytes / 1e9) * 10) / 10, cores: d.cores } satisfies DeviceInfo
  },
  'models:list': () => listModels(),
  'models:download': ({ model }) => {
    // Solo modelos del catálogo.
    const m = LOCAL_MODELS.find((x) => x.id === model.id)
    if (!m) throw new Error(`Modelo desconocido: ${model.id}`)
    return startDownload(m)
  },
  'models:cancel': async ({ id }) => {
    const extra = LOCAL_MODELS.find((x) => x.id === id)?.extra
    if (extra) await tauriInvoke('models_cancel', { id: extra.id })
    await tauriInvoke('models_cancel', { id })
  },
  'models:remove': async ({ id }) => {
    const extra = LOCAL_MODELS.find((x) => x.id === id)?.extra
    if (extra) await tauriInvoke('models_remove', { id: extra.id })
    await tauriInvoke('models_remove', { id })
  },

  'tts:status': async () => {
    const files = await listModels()
    const catalog = LOCAL_MODELS.filter((m) => m.kind === 'tts').map((m): VoiceStatus => ({
      ...VOICE_META[m.voice!], id: m.voice!, engine: 'sherpa-onnx', sizeBytes: m.bytes, sampleUrl: localVoiceSample(m.voice!), installed: modelReady(m, files)
    }))
    // El motor va dentro de la app: no hay nada que instalar aparte.
    return { piperInstalled: true, voices: catalog.filter((v) => v.installed).map((v) => v.id), catalog }
  },
  'tts:install-piper': () => undefined,
  'tts:install-voice': ({ id }) => {
    const m = localVoice(id)
    if (!m) throw new Error(`La voz ${id} no está disponible en Android.`)
    return downloadAndWait(m)
  },
  'tts:remove-voice': async ({ id }) => {
    const m = localVoice(id)
    if (m) for (const f of [m.id, m.extra!.id]) await tauriInvoke('models_remove', { id: f })
  },
  'tts:sample': async ({ id }) => {
    if (!localVoice(id)) throw new Error(`La voz ${id} no está disponible en Android.`)
    await netGuard(await getSettings(), 'Muestra de voz', localVoiceSample(id))
    return new Uint8Array(await tauriInvoke<ArrayBuffer>('tts_sample', { url: localVoiceSample(id) }))
  },
  'tts:synth': ({ text, lang, voice }) => synthesize(text, lang, voice),

  'hw:detect': () => ({
    hw: {
      cpu: navigator.userAgent.match(/Android [^;)]+/)?.[0] ?? 'Android',
      cores: navigator.hardwareConcurrency ?? 0,
      cpuFlags: { avx: false, avx2: false, avx512: false },
      arch: 'arm64',
      ramGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
      gpu: '—',
      gpuVendor: 'none',
      diskFreeGB: 0,
      ollama: { installed: false, running: false, models: [] },
      clis: { claude: false, opencode: false }
    },
    recs: []
  }),
  'ollama:list': () => ({ running: false, models: [] }),

  'stt:load': async () => {
    await tauriInvoke('stt_load', { model: (await getSettings()).sttModel })
  },
  'stt:transcribe': ({ pcm, lang, priority }) => transcribe(pcm, lang, false, priority),
  'stt:detailed': ({ pcm, lang, timestamps, priority }) => transcribe(pcm, lang, timestamps, priority),
  'stt:status': async () => {
    const s = await getSettings()
    const loaded = await tauriInvoke<string | null>('stt_loaded')
    const files = await tauriInvoke<LocalModelFile[]>('models_list')
    return {
      engine: 'whispercpp',
      active: 'whispercpp',
      fallbackReason: null,
      modelInstalled: files.some((f) => f.id === s.sttModel && !f.partial),
      cpp: {
        bin: 'whisper.cpp (integrado)',
        model: loaded ?? s.sttModel,
        ggml: LOCAL_MODELS.filter((m) => m.kind === 'stt').map((m) => ({
          id: m.id, label: m.label, sizeMB: Math.round(m.bytes / 1e6), installed: files.some((f) => f.id === m.id && !f.partial)
        }))
      }
    } as SttStatus
  },
  'dict:apply': async ({ text }) => applyDictionary(text, (await getSettings()).dictionary),

  'col:get': ({ name }) => docGet<unknown[]>(name, []),
  'col:save': ({ name, items }) => docSet(name, items),
  'history:get': () => docGet<HistoryItem[]>('history', []),
  'history:save': ({ items }) => docSet('history', items),

  'llm:warm': async () => {
    const model = (await getSettings()).localLlm
    if (model) await tauriInvoke('llm_load', { model }).catch(() => undefined)
  },
  'llm:rewrite': async (req) => {
    // Modo programador: el destino sale de los ajustes; en el teléfono no hay carpeta de proyecto.
    if (req.mode !== 'rewrite') req = { ...req, target: (await getSettings()).promptTarget }
    const r = await llm.rewriteGuarded(req)
    if (r.reverted) emitLocal('llm:notice', 'La redacción cambiaba cifras u horas: se conservó el texto dictado.')
    return r.text
  },
  'llm:chat': ({ system, msgs }) => localComplete(system, msgs, 0.6),
  'llm:translate': ({ text, to }) => llm.translate(text, to),
  'llm:generate': ({ action, text, lang }) => llm.generate(action as ContentAction, text, lang),
  'llm:minutes': ({ text, lang }) => llm.generateMinutes(text, lang),
  'llm:test': () => llm.testLLM(),

  ...createDataHandlers({
    docGet,
    docSet,
    getSettings,
    forgetSettings: () => { settings = null },
    synthesize,
    generate: (action, text, lang) => llm.generate(action, text, lang),
    listModels,
    notice: (msg) => emitLocal('llm:notice', msg),
    onJobs: (list) => emitLocal('jobs:changed', list)
  }),

  'app:version': () => getVersion(),
  'clipboard:write': ({ text }) => navigator.clipboard.writeText(text),
  'notify': () => undefined,
  'pill:set': () => undefined
}

/** Nombre legible de un canal para el mensaje de «no disponible». */
const DESKTOP_ONLY: Partial<Record<IpcChannel, string>> = {
  'ollama:install': 'Instalar Ollama',
  'ollama:start': 'Iniciar Ollama',
  'ollama:pull': 'Descargar modelos de Ollama',
  'agent:launch': 'Enviar a Claude Code u opencode',
  'project:pick': 'Elegir carpeta de proyecto',
  'project:context': 'El contexto del proyecto',
  'sysaudio:start': 'Capturar el audio del sistema',
  'uninstall:info': 'Desinstalar desde la app',
  'uninstall:run': 'Desinstalar desde la app',
  'app:launch-cmd': 'El atajo de teclado global',
  'app:open-data-dir': 'Abrir la carpeta de datos',
  'vault:pick': 'Elegir la carpeta de notas (al guardar una nota eliges dónde)',
  'stt:bench': 'La prueba de rendimiento de Whisper',
  'stt:download-ggml': 'Descargar modelos de Whisper de escritorio',
  'pv:engine-url': 'La clonación de voz',
  'diagnostics:report': 'El informe de diagnóstico'
}

const invoke: Invoke = async <K extends IpcChannel>(channel: K, req?: IpcReq<K>): Promise<IpcRes<K>> => {
  const h = handlers[channel] as Handler<K> | undefined
  if (h) return h(req as IpcReq<K>)
  if (DESKTOP_ONLY[channel]) throw new NoDisponible(DESKTOP_ONLY[channel])
  throw new Error(`Esta función todavía no está lista en Android (${channel}).`)
}

/** Eventos emitidos desde Rust con el mismo nombre de canal que en escritorio. */
const on: On = <K extends IpcEvent>(channel: K, cb: (payload: IpcEvents[K]) => void): (() => void) => {
  const locals = localListeners.get(channel) ?? new Set()
  localListeners.set(channel, locals)
  locals.add(cb as (payload: never) => void)
  let off: (() => void) | null = null
  let cancelled = false
  void listen<IpcEvents[K]>(channel, (e) => cb(e.payload)).then((un) => {
    if (cancelled) un()
    else off = un
  })
  return () => {
    locals.delete(cb as (payload: never) => void)
    cancelled = true
    off?.()
  }
}

// El contrato completo debe seguir siendo el de escritorio: si cambia, el compilador avisa aquí.
export type _Contract = IpcContract

window.api = createApi(invoke, on, 'android')
