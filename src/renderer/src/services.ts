// Estado de los servicios que usan IA o voz, y acciones para prepararlos sin pasar por
// los ajustes técnicos. La interfaz simple y el modal de complementos leen de aquí.
import { create } from 'zustand'
import type { HardwareInfo, Lang, LLMKind, Settings, SttStatus, TtsStatus } from '@shared/types'
import type { DeviceInfo, LocalModel, LocalModelFile } from '@shared/local-models'
import { companions, LOCAL_MODELS, modelReady } from '@shared/local-models'
import { PROVIDERS } from '@shared/providers'
import type { PhoneSttInfo } from '@shared/phone-stt'
import type { VoiceStatus } from '@shared/voice'
import {
  dictationOptions, liveOptions, liveReady, llmOptions, selectedModelReady,
  serviceEnabled, ttsReady, voiceOptions,
  type ServiceId, type ServiceOption
} from '@shared/features'
import { useApp } from './store'
import { useSetup } from './setup'

const ANDROID = window.api.platform === 'android'

export interface AiProviderState {
  kind: LLMKind
  label: string
  ready: boolean
  detail: string
  models?: string[]
}

interface AiActive {
  ready: boolean
  detail: string
}

interface ServicesState {
  models: LocalModelFile[]
  tts: (TtsStatus & { catalog: VoiceStatus[] }) | null
  stt: SttStatus | null
  phone: PhoneSttInfo | null
  device: DeviceInfo | null
  hw: HardwareInfo | null
  keys: { anthropic: boolean; compat: boolean }
  aiActive: AiActive
  aiProviders: AiProviderState[]
  loading: boolean
  loaded: boolean
  refresh: () => Promise<void>
  loadAiProviders: () => Promise<void>
  isReady: (service: ServiceId, lang?: Lang) => boolean
  options: (service: ServiceId, lang?: Lang) => ServiceOption[]
}

const NONE_AI: AiActive = { ready: false, detail: 'Falta configurar la redacción con IA.' }

/** Una sola consulta a la vez: si dos pantallas piden el estado, comparten la misma promesa. */
let refreshing: Promise<void> | null = null

/** Estado del proveedor de IA activo, con lo que ya sabemos sin lanzar pruebas de red. */
function aiActive(settings: Settings, models: LocalModelFile[], hw: HardwareInfo | null, keys: { anthropic: boolean; compat: boolean }): AiActive {
  if (ANDROID) {
    const m = LOCAL_MODELS.find((x) => x.id === settings.localLlm)
    if (m && m.kind === 'llm' && modelReady(m, models)) return { ready: true, detail: `Listo · ${m.label}` }
    return { ready: false, detail: settings.localLlm ? 'El modelo de redacción ya no está descargado.' : 'Falta elegir un modelo de redacción.' }
  }
  switch (settings.llm.kind) {
    case 'ollama':
      if (!hw) return { ready: false, detail: 'No se pudo comprobar Ollama.' }
      if (!hw.ollama.installed) return { ready: false, detail: 'Ollama no está instalado.' }
      if (!hw.ollama.running) return { ready: false, detail: 'Ollama está instalado pero no está en marcha.' }
      if (!hw.ollama.models.length) return { ready: false, detail: 'Ollama no tiene modelos descargados.' }
      if (settings.llm.model && !hw.ollama.models.some((m) => m === settings.llm.model || m.startsWith(settings.llm.model + ':') || settings.llm.model.startsWith(m))) {
        return { ready: false, detail: `El modelo «${settings.llm.model}» no está en Ollama.` }
      }
      return { ready: true, detail: `Listo · Ollama · ${settings.llm.model || hw.ollama.models[0]}` }
    case 'anthropic':
      return keys.anthropic
        ? { ready: true, detail: `Listo · Claude · ${settings.llm.model || 'modelo predeterminado'}` }
        : { ready: false, detail: 'Falta la clave de Anthropic.' }
    case 'openai-compat':
      return keys.compat && !!settings.llm.baseUrl
        ? { ready: true, detail: `Listo · ${settings.llm.baseUrl}` }
        : { ready: false, detail: 'Faltan la URL o la clave del servicio compatible.' }
    case 'claude-cli':
      return hw?.clis.claude
        ? { ready: true, detail: 'Listo · Claude con tu suscripción' }
        : { ready: false, detail: 'No se encontró el comando `claude`.' }
    case 'opencode':
      return hw?.clis.opencode
        ? { ready: true, detail: 'Listo · opencode' }
        : { ready: false, detail: 'No se encontró el comando `opencode`.' }
  }
}

/** Proveedores del escritorio con su estado, para el modal de IA. */
export async function loadAiProviders(): Promise<AiProviderState[]> {
  if (ANDROID) return []
  const [hw, anthropic, compat] = await Promise.all([
    window.api.detectHardware().then((r) => r.hw).catch(() => null),
    window.api.hasSecret('anthropic').catch(() => false),
    window.api.hasSecret('openai-compat').catch(() => false)
  ])
  const out: AiProviderState[] = []
  out.push({
    kind: 'ollama',
    label: PROVIDERS.ollama.label,
    ready: !!hw?.ollama.running && hw.ollama.models.length > 0,
    detail: !hw
      ? 'No se pudo comprobar Ollama.'
      : !hw.ollama.installed
        ? 'Ollama no está instalado en este equipo.'
        : !hw.ollama.running
          ? 'Ollama está instalado pero no está en marcha.'
          : hw.ollama.models.length
            ? `En marcha · ${hw.ollama.models.length} modelo${hw.ollama.models.length === 1 ? '' : 's'}`
            : 'En marcha, pero sin modelos descargados.',
    models: hw?.ollama.models ?? []
  })
  out.push({
    kind: 'anthropic', label: PROVIDERS.anthropic.label,
    ready: anthropic, detail: anthropic ? 'Clave guardada.' : 'Falta la clave de Anthropic.'
  })
  out.push({
    kind: 'claude-cli', label: PROVIDERS['claude-cli'].label,
    ready: !!hw?.clis.claude, detail: hw?.clis.claude ? 'Comando disponible en tu equipo.' : 'No se encontró el comando `claude`.'
  })
  out.push({
    kind: 'opencode', label: PROVIDERS.opencode.label,
    ready: !!hw?.clis.opencode, detail: hw?.clis.opencode ? 'Comando disponible en tu equipo.' : 'No se encontró el comando `opencode`.'
  })
  out.push({
    kind: 'openai-compat', label: PROVIDERS['openai-compat'].label,
    ready: compat, detail: compat ? 'Clave guardada.' : 'Faltan la URL y la clave del servicio.'
  })
  return out
}

export const useServices = create<ServicesState>((set, get) => ({
  models: [],
  tts: null,
  stt: null,
  phone: null,
  device: null,
  hw: null,
  keys: { anthropic: false, compat: false },
  aiActive: NONE_AI,
  aiProviders: [],
  loading: false,
  loaded: false,

  refresh: () => {
    if (refreshing) return refreshing
    refreshing = (async () => {
      set({ loading: true })
      const [models, tts, stt, phone, device, hw, anthropic, compat] = await Promise.all([
        window.api.listLocalModels().catch(() => [] as LocalModelFile[]),
        window.api.ttsStatus().catch(() => null),
        window.api.sttStatus().catch(() => null),
        ANDROID ? window.api.phoneStt.available().catch(() => null) : Promise.resolve(null),
        window.api.deviceInfo().catch(() => null),
        ANDROID ? Promise.resolve(null) : window.api.detectHardware().then((r) => r.hw).catch(() => null),
        window.api.hasSecret('anthropic').catch(() => false),
        window.api.hasSecret('openai-compat').catch(() => false)
      ])
      const keys = { anthropic, compat }
      set({
        models, tts, stt, phone, device, hw, keys,
        // Se leen los ajustes al terminar: si cambiaron durante la consulta, manda el valor nuevo.
        aiActive: aiActive(useApp.getState().settings, models, hw, keys),
        loading: false,
        loaded: true
      })
    })().finally(() => { refreshing = null })
    return refreshing
  },

  loadAiProviders: async () => {
    const aiProviders = await loadAiProviders()
    set({ aiProviders })
  },

  isReady: (service, lang) => {
    const s = useApp.getState().settings
    const st = get()
    switch (service) {
      case 'dictation':
        if (ANDROID) {
          if (s.sttPhone === 'auto' && st.phone?.onDevice) return true
          return selectedModelReady(s, st.models)
        }
        if (s.sttProvider === 'openai') return true
        if (s.sttEngine === 'whispercpp') {
          const hasCpp = st.stt?.cpp.ggml.some((g) => g.installed) ?? false
          return hasCpp || !!st.stt?.modelInstalled
        }
        return !!st.stt?.modelInstalled
      case 'ai':
        return st.aiActive.ready
      case 'tts': {
        const l = lang ?? s.primaryLang
        if (!ttsReady(s, l, st.tts?.catalog ?? [])) return false
        // Una voz Piper no suena sin su motor; las de Kokoro/Supertonic/sistema no lo usan.
        const voice = st.tts?.catalog.find((v) => v.id === s.ttsVoice[l] && v.installed)
        const needsPiper = !!voice && !/^kokoro:|^supertonic:|^sistema:/.test(voice.id)
        return !needsPiper || !!st.tts?.piperInstalled
      }
      case 'live':
        return liveReady(lang ?? s.primaryLang, st.models)
    }
  },

  options: (service, lang) => {
    const s = useApp.getState().settings
    const st = get()
    const l: Lang = lang ?? s.primaryLang
    switch (service) {
      case 'dictation': {
        const desktopReady = !ANDROID && (
          s.sttProvider === 'openai' ||
          (s.sttEngine === 'whispercpp' ? !!st.stt?.cpp.ggml.some((g) => g.installed) : !!st.stt?.modelInstalled)
        )
        return dictationOptions(window.api.platform, st.device?.ramGB ?? 0, st.models, st.phone?.onDevice ?? null, desktopReady)
      }
      case 'ai':
        return ANDROID ? llmOptions(st.device?.ramGB ?? 0, st.models) : []
      case 'tts':
        return voiceOptions(l, st.tts?.catalog ?? [], s.ttsVoice[l])
      case 'live':
        return liveOptions(l, st.models)
    }
  }
}))

/** Descarga un modelo del catálogo y espera al evento `done` (Android lo hace en segundo plano). */
async function downloadModel(m: LocalModel, onProgress?: (what: string, pct: number) => void): Promise<void> {
  const ids = new Set([m.id, ...companions(m).map((x) => x.id)])
  let off: (() => void) | null = null
  let finish: (() => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  off = window.api.onModelProgress((p) => {
    if (!ids.has(p.id)) return
    if (p.state === 'downloading') {
      onProgress?.(m.label, p.total ? Math.round((p.received / p.total) * 100) : 0)
    } else if (p.state === 'done' && p.id === m.id) {
      finish?.()
    } else if (p.state === 'error') {
      fail?.(new Error(p.error ?? 'La descarga falló.'))
    } else if (p.state === 'cancelled') {
      fail?.(new Error('Descarga cancelada.'))
    }
  })
  try {
    // En Android la orden vuelve en cuanto arranca; en escritorio resuelve al terminar.
    await window.api.downloadModel(m)
    await done
  } finally {
    off?.()
  }
}

/** Descarga una voz (Piper, Kokoro o Supertonic) y espera a que esté lista. */
async function installVoice(id: string, onProgress?: (what: string, pct: number) => void): Promise<void> {
  const off = window.api.onTtsProgress((p) => onProgress?.(p.what, p.pct))
  try {
    await window.api.installVoice(id)
  } finally {
    off()
  }
}

/**
 * Aplica una opción: la descarga si hace falta y la deja elegida en los ajustes.
 * Si ya estaba instalada, solo la selecciona.
 */
export async function installOption(
  option: ServiceOption,
  onProgress?: (what: string, pct: number) => void,
  opts: { keepPhone?: boolean } = {}
): Promise<void> {
  const current = useApp.getState().settings
  const patch = useApp.getState().patchSettings
  const action = option.action

  if (action.kind === 'system-stt') {
    await patch({ sttPhone: 'auto' })
    await useServices.getState().refresh()
    return
  }
  if (action.kind === 'system-voice') {
    const lang = option.lang ?? current.primaryLang
    await patch({ ttsVoice: { ...current.ttsVoice, [lang]: action.voiceId }, features: { ...current.features, tts: true } })
    await useServices.getState().refresh()
    return
  }
  if (action.kind === 'stt-prepare') {
    const off = window.api.onSttProgress((p) => {
      if (p.status === 'progress') onProgress?.('Whisper', Math.round(p.progress ?? 0))
    })
    try {
      await window.api.loadStt()
    } finally {
      off()
    }
    await useServices.getState().refresh()
    return
  }
  if (action.kind === 'provider') {
    // Los proveedores del escritorio se configuran en el panel de IA, con su clave o su CLI.
    throw new Error('Ese proveedor se configura desde el panel de IA.')
  }

  if (action.kind === 'model') {
    const m = LOCAL_MODELS.find((x) => x.id === action.modelId)
    if (!m) throw new Error(`Modelo desconocido: ${action.modelId}`)
    if (!option.installed) await downloadModel(m, onProgress)
    const now = useApp.getState().settings
    if (m.kind === 'stt') await patch({ ...(opts.keepPhone ? {} : { sttPhone: 'off' as const }), sttModel: m.id })
    else if (m.kind === 'llm') await patch({ localLlm: m.id, features: { ...now.features, ai: true } })
    else if (m.kind === 'live') await patch({ features: { ...now.features, liveText: true } })
    await useServices.getState().refresh()
    return
  }

  if (action.kind === 'voice') {
    // En escritorio, una voz Piper necesita además el motor; en Android va dentro de la app.
    // Se comprueba aunque la voz ya esté descargada: puede faltar el motor tras restaurar una copia.
    const needsPiper = !ANDROID && !/^kokoro:|^supertonic:|^sistema:/.test(action.voiceId) &&
      !useServices.getState().tts?.piperInstalled
    if (needsPiper) {
      const offPiper = window.api.onTtsProgress((p) => onProgress?.(p.what, p.pct))
      try {
        await window.api.installPiper()
      } finally {
        offPiper()
      }
    }
    if (!option.installed) await installVoice(action.voiceId, onProgress)
    const now = useApp.getState().settings
    const lang = option.lang ?? now.primaryLang
    await patch({ ttsVoice: { ...now.ttsVoice, [lang]: action.voiceId }, features: { ...now.features, tts: true } })
    await useServices.getState().refresh()
  }
}

/** Cancela una descarga de modelo en curso (las voces no tienen cancelación propia). */
export function cancelInstall(option: ServiceOption): void {
  if (option.action.kind === 'model') void window.api.cancelModel(option.action.modelId)
}

/**
 * Punto de entrada para las herramientas: si el servicio está listo, devuelve true;
 * si falta el complemento o está desactivado, abre el modal y espera la decisión.
 */
export async function ensureService(service: ServiceId, opts: { lang?: Lang } = {}): Promise<boolean> {
  const store = useServices.getState()
  if (!store.loaded) await store.refresh()
  const settings = useApp.getState().settings
  const enabled = serviceEnabled(settings, service)
  if (enabled && useServices.getState().isReady(service, opts.lang)) return true
  const request = useSetup.getState().ask({ service, lang: opts.lang, disabled: !enabled })
  return request
}

/** true si hay un modelo de Whisper (o la nube en escritorio) listo para transcribir. */
export function whisperReady(): boolean {
  const st = useServices.getState()
  const settings = useApp.getState().settings
  return ANDROID ? selectedModelReady(settings, st.models) : st.isReady('dictation')
}

/**
 * Transcripción de archivos, reuniones o traducción sin motor del teléfono: necesita
 * Whisper. A diferencia del dictado normal, el motor on-device no sirve aquí.
 */
export async function ensureWhisper(): Promise<boolean> {
  const store = useServices.getState()
  if (!store.loaded) await store.refresh()
  if (whisperReady()) return true
  return useSetup.getState().ask({ service: 'dictation', requireModel: true })
}
