import { create } from 'zustand'
import type { DictationMode, SavedPrompt, Settings, Tone } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { Mic } from './audio'
import { record } from './metrics'
import { PartialTranscriber } from './partial'
import { LiveTranscriber } from './live'
import { applyFormatting, matchCommand, type CommandId } from './commands'

export type View = 'dictado' | 'prompts' | 'audio' | 'lector' | 'reuniones' | 'traduccion' | 'agenda' | 'voces' | 'automatizaciones' | 'ajustes' | 'privacidad' | 'manual'

interface State {
  ready: boolean
  settings: Settings
  view: View
  recording: boolean
  level: number
  raw: string
  /** texto provisional de la frase en curso (aún no confirmado) */
  draft: string
  polished: string
  versions: string[]
  transcribing: number
  rewriting: boolean
  sttLoading: string | null
  error: string | null
  notice: string | null
  init: () => Promise<void>
  setView: (v: View) => void
  patchSettings: (p: Partial<Settings>) => Promise<void>
  setRaw: (t: string) => void
  setPolished: (t: string) => void
  start: (anywhere?: boolean) => Promise<void>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  toggleRecording: () => Promise<void>
  rewrite: (mode: 'rewrite' | 'prompt' | 'changes', redo?: boolean, auto?: boolean) => Promise<void>
  copyPolished: () => Promise<void>
  clearAll: () => void
  undoClear: () => void
  toggleAnywhere: () => Promise<void>
  savePrompt: (title?: string) => Promise<void>
  exportNote: () => Promise<void>
  flash: (msg: string) => void
}

type Run = (get: () => State, set: (p: Partial<State>) => void) => void | Promise<void>
const tone = (t: Tone) => async (get: () => State) => { await get().patchSettings({ tone: t }); await get().rewrite('rewrite') }
const endWith = (sep: string): Run => (g, s) => s({ raw: g().raw.replace(/\s+$/, '') + sep })

const RUN: Record<CommandId, Run> = {
  clear: (g) => g().clearAll(),
  paragraph: endWith('\n\n'),
  newline: endWith('\n'),
  copy: (g) => g().copyPolished(),
  redo: (g) => g().rewrite('rewrite', true),
  rewrite: (g) => g().rewrite('rewrite'),
  formal: (g) => tone('formal')(g),
  concise: (g) => tone('concise')(g),
  casual: (g) => tone('casual')(g),
  prompt: (g) => g().rewrite('prompt'),
  changes: (g) => g().rewrite('changes'),
  savePrompt: (g) => g().savePrompt(),
  pause: (g) => g().stop()
}

/** Añade texto dictado a `raw`: sin espacio tras un salto de línea. */
const append = (raw: string, text: string): string => (!raw ? text : /\n$/.test(raw) ? raw + text : `${raw} ${text}`)

let mic: Mic | null = null
let partial: PartialTranscriber | null = null
/** Texto en vivo con el modelo streaming (Android); si no hay, se usan los borradores de Whisper. */
let live: LiveTranscriber | null = null
let queue: Promise<void> = Promise.resolve()
let debounce: ReturnType<typeof setTimeout> | undefined
let anywhereSession = false
let epoch = 0
/** Texto de `raw` ya cubierto por la redacción automática: solo se redacta lo nuevo (el coste del LLM no crece con el dictado). */
let autoBase = ''
let rewriteAgain = false
let trash: { raw: string; polished: string; versions: string[] } | null = null
/** Momento en que se transcribió la última frase: mide cuánto se espera antes de redactar. */
let lastPhraseAt = 0
/** true mientras la frase está en el silencio que la va a cerrar. */
let closing = false

export const useApp = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  view: 'dictado',
  recording: false,
  level: 0,
  raw: '',
  polished: '',
  versions: [],
  draft: '',
  transcribing: 0,
  rewriting: false,
  sttLoading: null,
  error: null,
  notice: null,

  init: async () => {
    const settings = await window.api.getSettings()
    set({ settings, ready: true })
    window.api.onSttProgress((p) => {
      if (p.status === 'progress' && p.file) set({ sttLoading: `${p.file.split('/').pop()} ${Math.round(p.progress ?? 0)}%` })
      if (p.status === 'ready' || p.status === 'done') set({ sttLoading: null })
    })
    window.api.onLlmNotice((m) => get().flash(m))
    window.api.onToggleDictation(() => void get().toggleAnywhere())
  },

  setView: (view) => set({ view }),
  patchSettings: async (p) => set({ settings: await window.api.saveSettings(p) }),
  setRaw: (raw) => set({ raw }),
  setPolished: (polished) => set({ polished }),

  start: async (anywhere = false) => {
    if (get().recording) return
    const { settings } = get()
    set({ error: null })
    try {
      mic = new Mic({
        deviceId: settings.micDeviceId,
        mode: anywhere ? 'controlled' : settings.mode,
        pauseMs: settings.pauseMs,
        filters: settings.micFilters,
        onLevel: (level) => set({ level }),
        onAudio: (chunk) => live?.feed(chunk),
        // El silencio que cierra la frase: a partir de aquí el motor se deja libre.
        onSilence: () => { closing = true },
        onSegment: (pcm, startSec, meta) => {
          partial?.reset()
          live?.reset()
          closing = false
          set((s) => ({ transcribing: s.transcribing + 1 }))
          const mine = epoch
          // Momento en que se cierra la frase: sirve para medir cuánto tarda en aparecer el texto.
          const closedAt = performance.now()
          record('silence_ms', meta?.silenceMs ?? 0)
          lastPhraseAt = performance.now()
          queue = queue.then(async () => {
            try {
              if (mine !== epoch) return
              const r = await window.api.transcribe(pcm, get().settings.primaryLang)
              record('stt_ms', r.ms)
              record('stt_total_ms', performance.now() - closedAt)
              if (mine !== epoch) return
              const useCmds = get().settings.voiceCommands && !anywhereSession
              const cmd = useCmds ? matchCommand(r.text) : null
              const text = cmd ? cmd.rest : useCmds ? applyFormatting(r.text) : r.text
              if (text) {
                set((s) => ({ raw: append(s.raw, text) }))
                if (!cmd && get().settings.autoRewrite && !anywhereSession) {
                  clearTimeout(debounce)
                  debounce = setTimeout(() => void get().rewrite('rewrite', false, true), get().settings.rewriteDelayMs)
                }
              }
              if (cmd) {
                get().flash(`🎙 Comando: ${cmd.spec.label}`)
                await RUN[cmd.spec.id](get, set)
              }
            } catch (e) {
              set({ error: `Transcripción: ${(e as Error).message}` })
            } finally {
              set((s) => ({ transcribing: s.transcribing - 1 }))
            }
          })
        }
      })
      // Precarga en paralelo con el arranque del micrófono: la primera frase no paga la carga del modelo
      if (settings.sttProvider === 'local') void window.api.loadStt().catch(() => undefined)
      if (settings.autoRewrite && !anywhere) void window.api.warmLLM()
      await mic.start()
      if (!anywhere) {
        const m = mic
        const l = await LiveTranscriber.create(settings.primaryLang, (draft) => set({ draft }))
        // Si se detuvo mientras cargaba el modelo, la sesión no se queda abierta.
        if (mic === m) live = l
        else l?.stop()
      }
      if (!live && settings.sttProvider === 'local' && settings.draftsEnabled && !anywhere) {
        const m = mic
        partial = new PartialTranscriber({
          snapshot: () => m.snapshot(),
          // El borrador va con prioridad baja: la transcripción definitiva nunca espera a un borrador.
          transcribe: async (pcm) => (await window.api.transcribe(pcm, get().settings.primaryLang, 'draft')).text,
          onDraft: (draft) => set({ draft }),
          busy: () => get().transcribing > 0,
          // Mientras la frase está en el silencio que la cierra no se lanza ningún borrador.
          closing: () => closing
        })
        partial.start()
      }
      set({ recording: true })
    } catch (e) {
      mic = null
      set({ error: `Micrófono: ${(e as Error).message}` })
    }
  },

  stop: async () => {
    await mic?.stop()
    mic = null
    partial?.stop(); partial = null
    live?.stop(); live = null
    set({ recording: false, level: 0, draft: '' })
    await queue
  },

  /** Interrumpe la grabación y descarta el audio pendiente y las transcripciones en curso. */
  cancel: async () => {
    if (!get().recording && get().transcribing === 0) return
    epoch++
    await mic?.stop(true)
    mic = null
    partial?.stop(); partial = null
    live?.stop(); live = null
    set({ recording: false, level: 0, draft: '' })
    await queue
    get().flash('⏹ Transcripción detenida')
  },

  toggleRecording: async () => (get().recording ? get().stop() : get().start()),

  rewrite: async (mode, redo = false, auto = false) => {
    const { raw, settings, polished } = get()
    if (!raw.trim()) return
    if (get().rewriting) {
      // Antes se descartaba: las frases dictadas durante una redacción se quedaban sin redactar
      if (auto) rewriteAgain = true
      return
    }
    // Automático: si lo anterior no cambió, solo se redacta el texto nuevo y se añade
    const incremental = settings.rewriteIncremental && auto && mode === 'rewrite' && !redo && autoBase !== '' && raw.startsWith(autoBase) && polished.trim() !== ''
    const text = incremental ? raw.slice(autoBase.length).trim() : raw
    if (!text) return
    set({ rewriting: true, error: null })
    const t0 = performance.now()
    if (auto && lastPhraseAt) record('rewrite_wait_ms', t0 - lastPhraseAt)
    try {
      const out = await window.api.rewrite({
        text, lang: settings.primaryLang, tone: settings.tone, mode,
        previous: redo ? polished : undefined
      })
      record('rewrite_ms', performance.now() - t0)
      // Si el usuario limpió o editó el texto mientras tanto, esta respuesta ya no le corresponde
      if (!get().raw.startsWith(raw)) return
      const next = incremental ? `${get().polished.replace(/\s+$/, '')} ${out}` : out
      autoBase = mode === 'rewrite' ? raw : ''
      set((s) => ({ polished: next, versions: [...s.versions, next].slice(-10) }))
    } catch (e) {
      set({ error: `Redacción: ${(e as Error).message}` })
    } finally {
      set({ rewriting: false })
      if (rewriteAgain) {
        rewriteAgain = false
        if (get().raw.trim() && get().raw !== raw) void get().rewrite('rewrite', false, true)
      }
    }
  },

  copyPolished: async () => {
    const { polished, raw } = get()
    await window.api.copy(polished || raw)
  },

  clearAll: () => {
    const { raw, polished, versions } = get()
    trash = { raw, polished, versions }
    autoBase = ''
    set({ raw: '', polished: '', versions: [] })
  },
  undoClear: () => {
    if (trash) set(trash)
    trash = null
  },

  flash: (notice) => {
    set({ notice })
    setTimeout(() => get().notice === notice && set({ notice: null }), 2500)
  },

  savePrompt: async (title) => {
    const text = get().polished || get().raw
    if (!text.trim()) return
    const list = await window.api.getCollection<SavedPrompt>('prompts')
    const first = text.replace(/[#*\n]+/g, ' ').trim()
    list.unshift({ id: crypto.randomUUID(), title: title ?? first.slice(0, 60), text, tags: [], rating: 0, createdAt: Date.now() })
    await window.api.saveCollection('prompts', list)
    get().flash('💾 Guardado en la biblioteca de prompts')
  },

  exportNote: async () => {
    const { raw, polished } = get()
    if (!raw.trim() && !polished.trim()) return
    const body = `${polished || raw}${polished && raw ? `\n\n---\n_Transcripción original:_ ${raw}` : ''}`
    const file = await window.api.exportNote((polished || raw).slice(0, 50), body, ['dictado'])
    get().flash(`📝 Nota guardada: ${file}`)
  },

  /** Atajo de GNOME → `dictaflow --toggle`. Graba, redacta y deja el resultado en el portapapeles. */
  toggleAnywhere: async () => {
    const api = window.api
    if (get().recording && anywhereSession) {
      await api.setPill({ state: 'working', message: 'Transcribiendo…' })
      await get().stop()
      try {
        if (get().raw.trim()) await get().rewrite('rewrite')
        const text = get().polished || get().raw
        if (!text) return void api.setPill({ state: 'error', message: 'No se escuchó nada' })
        await api.copy(text)
        void api.notify('DictaFlow', 'Texto copiado: pégalo con Ctrl+V')
        await api.setPill({ state: 'done', message: 'Copiado · pega con Ctrl+V' })
      } finally {
        anywhereSession = false
      }
      return
    }
    if (get().recording) return
    anywhereSession = true
    autoBase = ''
    set({ raw: '', polished: '', versions: [] })
    await get().start(true)
    if (get().recording) await api.setPill({ state: 'listening', message: 'Escuchando… pulsa el atajo de nuevo' })
    else {
      anywhereSession = false
      await api.setPill({ state: 'error', message: get().error ?? 'Error de micrófono' })
    }
  }
}))

export const modeLabel: Record<DictationMode, string> = {
  continuous: 'Parlante activo',
  controlled: 'Parlante controlado'
}
