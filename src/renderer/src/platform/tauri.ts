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
import { addPluginListener, Channel, invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import type { IpcChannel, IpcContract, IpcEvent, IpcEvents, IpcReq, IpcRes, SttPriority, TranscribeResult } from '@shared/ipc'
import { DEFAULT_SETTINGS, type ChatMsg, type HistoryItem, type Lang, type Settings, type SttStatus } from '@shared/types'
import { normalizeModel } from '@shared/providers'
import { applyDictionary } from '@shared/dictionary'
import { pcmToB64, whisperPrompt } from './pcm'
import { KOKORO_MODEL, KOKORO_VOICES, kokoroId, kokoroLabel, kokoroVoice } from '@shared/kokoro'
import { createLlmTasks, systemPrompt, type CompleteOpts, type ContentAction, type LlmLimits } from '@shared/llm-tasks'
import { companions, liveModelFor, LOCAL_MODELS, localVoice, totalBytes, localVoiceSample, modelReady, type DeviceInfo, type LocalModel, type LocalModelFile, type LocalModelProgress } from '@shared/local-models'
import { VOICE_META } from '@shared/voice-catalog'
import type { VoiceStatus } from '@shared/voice'
import type { UpdateInfo } from '@shared/update'
import type { PhoneSttApi, PhoneSttInfo, PhoneSttStartResult } from '@shared/phone-stt'
import type { NativeMicApi, NativeMicResult } from '@shared/native-mic'
import { createApi, type Invoke, type On } from '../../../preload/api'
import { createDataHandlers, netGuard } from './android-datos'
import { auraBusy, watchPlayback } from '../aura'
import { record } from '../metrics'

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

/**
 * En Android no hay modelo de voz hasta que el usuario descarga uno (los de escritorio no sirven).
 * La redacción es «inteligente» por defecto: el dictado limpio se queda en 0 s y el LLM solo se
 * usa cuando la frase lo necesita.
 */
const ANDROID_DEFAULTS: Partial<Settings> = { sttModel: '', localLlm: '', sttPhone: 'auto', rewritePolicy: 'smart' }

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
 * Whisper corre en Rust. El audio va en base64 a 16 bits (platform/pcm.ts) y con él un texto de
 * arranque con la puntuación del idioma y los términos del diccionario. Después se aplica el
 * diccionario personal, igual que en escritorio.
 */
async function transcribe(pcm: Float32Array, lang: string, timestamps: boolean, priority: SttPriority = 'final'): Promise<TranscribeResult> {
  const s = await getSettings()
  const prompt = whisperPrompt(lang === 'auto' ? s.primaryLang : lang, s.dictionary.map((d) => d.to || d.from))
  const r = await tauriInvoke<TranscribeResult>('stt_transcribe', {
    audio: pcmToB64(pcm), model: s.sttModel, lang, priority, timestamps, prompt
  })
  return {
    text: applyDictionary(r.text, s.dictionary),
    segments: r.segments.map((x) => ({ ...x, text: applyDictionary(x.text, s.dictionary) })),
    ms: r.ms
  }
}

/** Texto en vivo: abre una sesión con el modelo streaming del idioma, si está descargado. */
async function liveStart(lang: string): Promise<number | null> {
  const m = liveModelFor(lang)
  if (!m || !modelReady(m, await listModels())) return null
  return tauriInvoke<number>('vivo_iniciar', { model: m.id })
}

// ── Redacción con IA ───────────────────────────────────────────────────────────────────────
/**
 * El modelo GGUF corre en Rust (llama.cpp); los prompts son los de escritorio (@shared/llm-tasks).
 * Límites más cortos que en escritorio: el contexto del teléfono es de 8 K tokens (≈ 4 caracteres
 * por token, dejando sitio a la respuesta) y leer un texto largo tarda.
 */
const ANDROID_LIMITS: LlmLimits = { chunkChars: 8_000, maxChars: 8_000, minutesChars: 14_000 }

interface LlmRespuesta { text: string; prompt_tokens: number; reused_tokens: number; tokens: number; prompt_ms: number; ms: number }

async function localComplete(system: string, msgs: ChatMsg[], temperature = 0.4, opts: CompleteOpts = {}): Promise<string> {
  const model = (await getSettings()).localLlm
  if (!model) throw new Error('Descarga un modelo de redacción en Ajustes → Servicios de IA.')
  const peticion = { model, system, msgs, temperature, maxTokens: opts.maxTokens }
  let r: LlmRespuesta
  if (opts.onToken) {
    // Channel de Tauri: cada token llega a la interfaz según se genera, sin esperar al final.
    const stream = new Channel<string>()
    stream.onmessage = (t) => opts.onToken?.(t)
    r = await tauriInvoke<LlmRespuesta>('llm_complete_stream', { peticion, stream })
  } else {
    r = await tauriInvoke<LlmRespuesta>('llm_complete', { peticion })
  }
  record('llm_prompt_ms', r.prompt_ms)
  console.debug(`[llm] ${r.prompt_tokens} tokens (${r.reused_tokens} ya leídos) en ${r.prompt_ms} ms · ${r.tokens} generados · ${r.ms} ms en total`)
  return r.text
}

const llm = createLlmTasks({ complete: localComplete, settings: getSettings, limits: ANDROID_LIMITS })

// ── Micrófono nativo ─────────────────────────────────────────────────────────────────────
const NATIVE_MIC_PLUGIN = 'captura'

const nativeMic: NativeMicApi = {
  start: async (opts) => {
    await tauriInvoke('captura_iniciar', { wav: opts.wav, session: opts.session })
  },
  stop: (discard) => tauriInvoke<NativeMicResult>('captura_detener', { descartar: discard }),
  cancel: async () => {
    await tauriInvoke('captura_cancelar')
  },
  onAudio: async (cb) => {
    const listener = await addPluginListener<{ data: string }>(NATIVE_MIC_PLUGIN, 'audio', (p) => {
      const raw = p.data ?? ''
      if (!raw) return
      const bin = atob(raw)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      cb(bytes)
    })
    return () => void listener.unregister()
  },
  onStop: async (cb) => {
    const listener = await addPluginListener<{ wavPath: string | null; durationSec: number }>(
      NATIVE_MIC_PLUGIN, 'detenido',
      (p) => cb({ wavPath: p.wavPath ?? null, durationSec: p.durationSec ?? 0 })
    )
    return () => void listener.unregister()
  }
}

// ── Motor de voz del teléfono ─────────────────────────────────────────────────────────────
/**
 * Solo on-device: si el teléfono no lo trae, `iniciar` falla y el dictado cae a Whisper. Los
 * eventos llegan por el plugin nativo (`ReconocimientoPlugin.kt`) con `addPluginListener`.
 */
const PHONE_STT_PLUGIN = 'reconocimiento'

const phoneStt: PhoneSttApi = {
  available: () => tauriInvoke<PhoneSttInfo>('reconocimiento_disponibilidad'),
  start: (opts) => tauriInvoke<PhoneSttStartResult>('reconocimiento_iniciar', {
    lang: opts.lang,
    continuo: opts.continuous,
    offline: true,
    bias: opts.bias
  }),
  stop: async () => {
    await tauriInvoke('reconocimiento_detener')
  },
  cancel: async () => {
    await tauriInvoke('reconocimiento_cancelar')
  },
  on: async (handlers) => {
    const unsubs: (() => void)[] = []
    const listen = async <T>(event: string, cb: (p: T) => void): Promise<void> => {
      const l = await addPluginListener<T>(PHONE_STT_PLUGIN, event, cb)
      unsubs.push(() => void l.unregister())
    }
    try {
      await listen<{ texto: string }>('parcial', (p) => handlers.onPartial(p.texto ?? ''))
      await listen<{ texto: string }>('final', (p) => handlers.onFinal(p.texto ?? ''))
      await listen<{ nivel: number }>('nivel', (p) => handlers.onLevel(p.nivel ?? 0))
      await listen<{ mensaje: string }>('error', (p) => handlers.onError(p.mensaje ?? 'Error del motor de voz.'))
      await listen<{ estado: string }>('estado', (p) => handlers.onState?.(p.estado ?? ''))
    } catch (e) {
      for (const u of unsubs) u()
      throw e
    }
    return () => {
      for (const u of unsubs) u()
    }
  }
}

// ── Descargas de modelos ────────────────────────────────────────────────────────────────────
const listModels = (): Promise<LocalModelFile[]> => tauriInvoke<LocalModelFile[]>('models_list')

/** Empieza (o reanuda) la descarga de un modelo del catálogo y de su archivo acompañante. */
async function startDownload(m: LocalModel): Promise<void> {
  await netGuard(await getSettings(), `Descargar ${m.label}`, m.url)
  // Rust vuelve a validar dirección, nombre y huella.
  for (const x of companions(m)) await tauriInvoke('models_download', { url: x.url, id: x.id, bytes: x.bytes, sha256: x.sha256 })
  await tauriInvoke('models_download', { url: m.url, id: m.id, bytes: m.bytes, sha256: m.sha256 })
}

/** Descarga un modelo y espera a que esté completo (para «Descargar voz» fuera de Ajustes). */
async function downloadAndWait(m: LocalModel): Promise<void> {
  const pending = new Set([m.id, ...companions(m).map((x) => x.id)])
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
// Tres tipos de voz, por el prefijo de su identificador en Ajustes:
//   • «es_MX-claude-high»: Piper (sherpa-onnx en Rust), una descarga por voz;
//   • «kokoro:ef_dora»: Kokoro (sherpa-onnx en Rust), un modelo con 31 voces;
//   • «sistema:<nombre>»: el motor de voz del teléfono (VozSistemaPlugin.kt), sin descargas.

interface VozSistemaInfo { nombre: string; idioma: string; region: string; etiqueta: string; calidad: number }
let systemVoices: Promise<VozSistemaInfo[]> | null = null
/** Voces del teléfono (se piden una vez; el motor tarda en arrancar). */
function listSystemVoices(): Promise<VozSistemaInfo[]> {
  // «es-US-language» es un alias de la voz predeterminada de ese idioma: se quita para no repetirla.
  systemVoices ??= tauriInvoke<{ voces: VozSistemaInfo[] }>('voz_sistema_voces').then((r) => r.voces.filter((v) => !v.nombre.endsWith('-language'))).catch(() => {
    systemVoices = null
    return []
  })
  return systemVoices
}

/** Nombre legible de una voz del teléfono: «Español (México) · voz 2 (alta)». */
export function systemVoiceLabel(v: VozSistemaInfo, n: number): string {
  const calidad = v.calidad >= 400 ? ' (alta)' : ''
  return `${v.etiqueta.replace(/^./, (c) => c.toUpperCase())} · voz ${n}${calidad} (teléfono)`
}

async function systemCatalog(): Promise<VoiceStatus[]> {
  const voces = await listSystemVoices()
  const cuenta = new Map<string, number>()
  return voces.map((v): VoiceStatus => {
    const n = (cuenta.get(v.etiqueta) ?? 0) + 1
    cuenta.set(v.etiqueta, n)
    return {
      id: `sistema:${v.nombre}`, engine: 'sistema', langs: [v.idioma as Lang], variant: `${v.idioma}_${v.region}`, speaker: v.nombre,
      label: systemVoiceLabel(v, n), quality: v.calidad >= 400 ? 'high' : 'medium', sizeBytes: 0,
      license: 'La del motor de voz del teléfono', usage: 'terminos-propios', source: 'Motor de texto a voz de Android',
      sampleUrl: 'local', installed: true
    }
  })
}

function kokoroCatalog(installed: boolean): VoiceStatus[] {
  return KOKORO_VOICES.map((v): VoiceStatus => ({
    id: kokoroId(v), engine: 'kokoro', langs: [v.lang], variant: v.accent, speaker: v.name, label: kokoroLabel(v),
    quality: 'high', sizeBytes: totalBytes(KOKORO_MODEL), license: 'Apache-2.0', usage: 'libre',
    source: 'hexgrad/Kokoro-82M · csukuangfj/kokoro-int8-multi-lang-v1_0', sampleUrl: 'local', installed
  }))
}

/** Lee `text` y devuelve un WAV, con la voz pedida o la de Ajustes para ese idioma. */
async function synthesize(text: string, lang: Lang, voiceId?: string): Promise<Uint8Array> {
  const s = await getSettings()
  const id = voiceId ?? s.ttsVoice[lang]
  const k = kokoroVoice(id)
  if (k) {
    if (!modelReady(KOKORO_MODEL, await listModels())) throw new Error('Falta descargar Kokoro (Ajustes → Servicios de IA → Lectura en voz alta).')
    return new Uint8Array(await tauriInvoke<ArrayBuffer>('tts_synth', { voice: 'kokoro', text, speed: s.ttsSpeed, sid: k.sid, lang: k.accent }))
  }
  if (id.startsWith('sistema:')) {
    return new Uint8Array(await tauriInvoke<ArrayBuffer>('voz_sistema_sintetizar', { voice: id.slice(8), text, speed: s.ttsSpeed }))
  }
  const files = await listModels()
  let m = localVoice(id)
  // Sin voz pedida y la de Ajustes no está descargada: cualquier otra descargada del mismo idioma.
  if (!voiceId && (!m || !modelReady(m, files))) {
    m = LOCAL_MODELS.find((x) => x.kind === 'tts' && x.voice && x.lang === lang && modelReady(x, files)) ?? m
  }
  if (!m) throw new Error(`La voz ${id} no está disponible en Android: elige otra en Ajustes → Servicios de IA.`)
  if (!modelReady(m, files)) throw new Error(`Falta descargar la voz ${m.label} (Ajustes → Servicios de IA).`)
  const wav = await tauriInvoke<ArrayBuffer>('tts_synth', { voice: m.voice, text, speed: s.ttsSpeed })
  return new Uint8Array(wav)
}

const SAMPLE_TEXT: Record<Lang, string> = {
  es: 'Hola. Así suena esta voz en tu teléfono, sin conexión a internet.',
  en: 'Hello. This is how this voice sounds on your phone, offline.'
}

// ── Actualizaciones (la web de DictaFlow publica /app/android/version.json) ─────────────────
interface Actualizacion { actual: string; version: string; disponible: boolean; notas: string; bytes: number; sha256: string; fecha: string; url: string }
let lastUpdate: UpdateInfo | null = null

async function checkUpdate(): Promise<UpdateInfo> {
  const server = await tauriInvoke<string>('servidor')
  await netGuard(await getSettings(), 'Buscar actualizaciones', server)
  const a = await tauriInvoke<Actualizacion>('buscar_actualizacion')
  lastUpdate = {
    current: a.actual, latest: a.version, available: a.disponible, notes: a.notas, pageUrl: server, kind: 'android',
    asset: { name: `dictaflow-android_${a.version}.apk`, url: a.url }, sha256: a.sha256 || null
  }
  return lastUpdate
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
    const m = LOCAL_MODELS.find((x) => x.id === id)
    for (const x of m ? companions(m) : []) await tauriInvoke('models_cancel', { id: x.id })
    await tauriInvoke('models_cancel', { id })
  },
  'models:remove': async ({ id }) => {
    const m = LOCAL_MODELS.find((x) => x.id === id)
    for (const x of m ? companions(m) : []) await tauriInvoke('models_remove', { id: x.id })
    await tauriInvoke('models_remove', { id })
  },

  'tts:status': async () => {
    const files = await listModels()
    const piper = LOCAL_MODELS.filter((m) => m.kind === 'tts' && m.voice).map((m): VoiceStatus => ({
      ...VOICE_META[m.voice!], id: m.voice!, engine: 'sherpa-onnx', sizeBytes: m.bytes, sampleUrl: localVoiceSample(m.voice!), installed: modelReady(m, files)
    }))
    const catalog = [...piper, ...kokoroCatalog(modelReady(KOKORO_MODEL, files)), ...(await systemCatalog())]
    // El motor va dentro de la app: no hay nada que instalar aparte.
    return { piperInstalled: true, voices: catalog.filter((v) => v.installed).map((v) => v.id), catalog }
  },
  'tts:install-piper': () => undefined,
  'tts:install-voice': ({ id }) => {
    if (kokoroVoice(id)) return downloadAndWait(KOKORO_MODEL)
    if (id.startsWith('sistema:')) return undefined
    const m = localVoice(id)
    if (!m) throw new Error(`La voz ${id} no está disponible en Android.`)
    return downloadAndWait(m)
  },
  'tts:remove-voice': async ({ id }) => {
    const m = localVoice(id)
    if (m) for (const f of [m.id, m.extra!.id]) await tauriInvoke('models_remove', { id: f })
  },
  'tts:sample': async ({ id }) => {
    // Kokoro y las voces del teléfono no tienen muestra publicada: la dice el propio teléfono.
    const k = kokoroVoice(id)
    if (k || id.startsWith('sistema:')) {
      const lang: Lang = k ? k.lang : (await listSystemVoices()).find((v) => `sistema:${v.nombre}` === id)?.idioma === 'en' ? 'en' : 'es'
      return synthesize(SAMPLE_TEXT[lang], lang, id)
    }
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
  'stt:live-start': ({ lang }) => liveStart(lang),
  'stt:live-feed': ({ session, pcm }) => tauriInvoke<{ texto: string }>('vivo_alimentar', { session, audio: pcmToB64(pcm) }).then((r) => ({ text: r.texto })),
  'stt:live-reset': ({ session }) => tauriInvoke('vivo_reiniciar', { session }),
  'stt:live-stop': ({ session }) => tauriInvoke('vivo_terminar', { session }),
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
    const s = await getSettings()
    if (!s.localLlm) return
    await tauriInvoke('llm_load', { model: s.localLlm }).catch(() => undefined)
    // Deja leído el prompt de sistema: la primera frase no paga su lectura.
    const system = systemPrompt({ text: '', lang: s.primaryLang, tone: s.tone, mode: 'rewrite' }, '')
    await tauriInvoke('llm_prepare', { peticion: { model: s.localLlm, system } }).catch(() => undefined)
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
  'update:check': () => checkUpdate(),
  'update:apply': async () => {
    // Rust descarga el APK del servidor de confianza, verifica tamaño y SHA-256 y abre el instalador.
    const r = await tauriInvoke<'instalador' | 'permiso'>('instalar_actualizacion')
    if (r === 'permiso') {
      throw new Error('Android pide permitir que DictaFlow instale actualizaciones: activa «Permitir de esta fuente» en la pantalla que se abrió, vuelve y toca «Reintentar».')
    }
    return 'downloaded' as const
  },
  'update:server': async ({ url }) => {
    if (url !== undefined) { lastUpdate = null; return tauriInvoke<string>('fijar_servidor', { url }) }
    return tauriInvoke<string>('servidor')
  },
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

/**
 * Aura amarilla mientras se transcribe o se redacta (y verde al terminar). Los borradores del
 * dictado en vivo no cuentan: ocurren mientras el micrófono sigue escuchando.
 */
const AURA_CHANNELS: IpcChannel[] = ['stt:transcribe', 'stt:detailed', 'llm:rewrite', 'llm:translate', 'llm:generate', 'llm:minutes', 'llm:chat', 'tts:synth', 'audio:export', 'pv:synthesize']
function auraFor(channel: IpcChannel, req: unknown): ((ok: boolean) => void) | null {
  if (!AURA_CHANNELS.includes(channel)) return null
  if (channel.startsWith('stt:') && (req as { priority?: SttPriority } | undefined)?.priority === 'draft') return null
  return auraBusy()
}
watchPlayback()

const invoke: Invoke = async <K extends IpcChannel>(channel: K, req?: IpcReq<K>): Promise<IpcRes<K>> => {
  const h = handlers[channel] as Handler<K> | undefined
  if (h) {
    const aura = auraFor(channel, req)
    try {
      const res = await h(req as IpcReq<K>)
      aura?.(channel.startsWith('stt:') ? !!(res as TranscribeResult).text?.trim() : true)
      return res
    } catch (e) {
      aura?.(false)
      // Rust rechaza con el texto del error, no con un Error: la interfaz lee `e.message`.
      throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e))
    }
  }
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

const api = createApi(invoke, on, 'android')
api.phoneStt = phoneStt
api.nativeMic = nativeMic
api.initialView = () => tauriInvoke<{ vista: string | null; texto: string | null }>('vista_inicial').catch(() => null)

/** En Android la redacción se transmite token a token desde llama.cpp. */
api.rewriteStream = async (req, onToken) => {
  if (req.mode !== 'rewrite') req = { ...req, target: (await getSettings()).promptTarget }
  const r = await llm.rewriteGuarded(req, { onToken })
  if (r.reverted) emitLocal('llm:notice', 'La redacción cambiaba cifras u horas: se conservó el texto dictado.')
  return r.text
}

window.api = api
