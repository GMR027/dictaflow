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
import { DEFAULT_SETTINGS, type HistoryItem, type Settings, type SttStatus } from '@shared/types'
import { normalizeModel } from '@shared/providers'
import { applyDictionary } from '@shared/dictionary'
import { LOCAL_MODELS, type DeviceInfo, type LocalModelFile } from '@shared/local-models'
import { createApi, type Invoke, type On } from '../../../preload/api'

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
  'models:list': () => tauriInvoke<LocalModelFile[]>('models_list'),
  'models:download': ({ model }) => {
    // Solo modelos del catálogo; Rust vuelve a validar dirección, nombre y huella.
    const m = LOCAL_MODELS.find((x) => x.id === model.id)
    if (!m) throw new Error(`Modelo desconocido: ${model.id}`)
    return tauriInvoke('models_download', { url: m.url, id: m.id, bytes: m.bytes, sha256: m.sha256 })
  },
  'models:cancel': ({ id }) => tauriInvoke('models_cancel', { id }),
  'models:remove': ({ id }) => tauriInvoke('models_remove', { id }),

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

  // La redacción con IA local (llama.cpp) llega en la siguiente fase.
  'llm:warm': () => undefined,
  'llm:rewrite': () => { throw new Error('La redacción con IA en el teléfono llega en la próxima versión. Mientras, desactiva «Redactar automáticamente».') },

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
  'app:open-data-dir': 'Abrir la carpeta de datos'
}

const invoke: Invoke = async <K extends IpcChannel>(channel: K, req?: IpcReq<K>): Promise<IpcRes<K>> => {
  const h = handlers[channel] as Handler<K> | undefined
  if (h) return h(req as IpcReq<K>)
  if (DESKTOP_ONLY[channel]) throw new NoDisponible(DESKTOP_ONLY[channel])
  throw new Error(`Esta función todavía no está lista en Android (${channel}).`)
}

/** Eventos emitidos desde Rust con el mismo nombre de canal que en escritorio. */
const on: On = <K extends IpcEvent>(channel: K, cb: (payload: IpcEvents[K]) => void): (() => void) => {
  let off: (() => void) | null = null
  let cancelled = false
  void listen<IpcEvents[K]>(channel, (e) => cb(e.payload)).then((un) => {
    if (cancelled) un()
    else off = un
  })
  return () => {
    cancelled = true
    off?.()
  }
}

// El contrato completo debe seguir siendo el de escritorio: si cambia, el compilador avisa aquí.
export type _Contract = IpcContract

window.api = createApi(invoke, on, 'android')
