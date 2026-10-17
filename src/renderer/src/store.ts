import { create } from 'zustand'
import type { DictationMode, SavedPrompt, Settings, Tone } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { Mic } from './audio'

export type View = 'dictado' | 'prompts' | 'audio' | 'lector' | 'reuniones' | 'traduccion' | 'ajustes' | 'privacidad' | 'manual'

interface State {
  ready: boolean
  settings: Settings
  view: View
  recording: boolean
  level: number
  raw: string
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
  toggleRecording: () => Promise<void>
  rewrite: (mode: 'rewrite' | 'prompt', redo?: boolean) => Promise<void>
  copyPolished: () => Promise<void>
  clearAll: () => void
  undoClear: () => void
  toggleAnywhere: () => Promise<void>
  savePrompt: (title?: string) => Promise<void>
  exportNote: () => Promise<void>
  flash: (msg: string) => void
}

const norm = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(flow|oye flow) /, '')

type Cmd = { re: RegExp; run: (get: () => State, set: (p: Partial<State>) => void) => void | Promise<void>; label: string }
const tone = (t: Tone) => async (get: () => State) => { await get().patchSettings({ tone: t }); await get().rewrite('rewrite') }

const COMMANDS: Cmd[] = [
  { re: /^(borra|borrar|elimina|eliminar) (eso|todo)$/, label: 'Borrado', run: (g) => g().clearAll() },
  { re: /^(nuevo parrafo|punto y aparte)$/, label: 'Nuevo párrafo', run: (g, s) => s({ raw: g().raw.replace(/\s+$/, '') + '\n\n' }) },
  { re: /^(nueva linea|salto de linea)$/, label: 'Nueva línea', run: (g, s) => s({ raw: g().raw.replace(/\s+$/, '') + '\n' }) },
  { re: /^(copia|copiar|copia eso|copialo)$/, label: 'Copiado', run: (g) => g().copyPolished() },
  { re: /^(rehaz|rehacer|rehazlo|otra version)$/, label: 'Rehaciendo', run: (g) => g().rewrite('rewrite', true) },
  { re: /^(redacta|redactar|redactalo)$/, label: 'Redactando', run: (g) => g().rewrite('rewrite') },
  { re: /^(hazlo mas formal|mas formal)$/, label: 'Tono formal', run: (g) => tone('formal')(g) },
  { re: /^(hazlo mas corto|mas corto|mas conciso|hazlo mas conciso)$/, label: 'Tono conciso', run: (g) => tone('concise')(g) },
  { re: /^(hazlo mas casual|mas casual|mas cercano|hazlo mas cercano)$/, label: 'Tono cercano', run: (g) => tone('casual')(g) },
  { re: /^(convierte(lo)? en prompt|hazlo prompt|a prompt)$/, label: 'Convirtiendo en prompt', run: (g) => g().rewrite('prompt') },
  { re: /^(guarda (este|el) prompt|guardar prompt)$/, label: 'Prompt guardado', run: (g) => g().savePrompt() },
  { re: /^(pausa|deja de escuchar|detener|para de escuchar)$/, label: 'Micrófono detenido', run: (g) => g().stop() }
]

let mic: Mic | null = null
let queue: Promise<void> = Promise.resolve()
let debounce: ReturnType<typeof setTimeout> | undefined
let anywhereSession = false
let trash: { raw: string; polished: string; versions: string[] } | null = null

export const useApp = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  view: 'dictado',
  recording: false,
  level: 0,
  raw: '',
  polished: '',
  versions: [],
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
        onLevel: (level) => set({ level }),
        onSegment: (pcm) => {
          set((s) => ({ transcribing: s.transcribing + 1 }))
          queue = queue.then(async () => {
            try {
              const text = await window.api.transcribe(pcm, get().settings.primaryLang)
              const cmd = get().settings.voiceCommands && !anywhereSession ? COMMANDS.find((c) => c.re.test(norm(text))) : undefined
              if (cmd) {
                get().flash(`🎙 Comando: ${cmd.label}`)
                await cmd.run(get, set)
              } else if (text) {
                set((s) => ({ raw: (s.raw ? s.raw + ' ' : '') + text }))
                if (get().settings.autoRewrite && !anywhereSession) {
                  clearTimeout(debounce)
                  debounce = setTimeout(() => void get().rewrite('rewrite'), 2500)
                }
              }
            } catch (e) {
              set({ error: `Transcripción: ${(e as Error).message}` })
            } finally {
              set((s) => ({ transcribing: s.transcribing - 1 }))
            }
          })
        }
      })
      await mic.start()
      set({ recording: true })
    } catch (e) {
      mic = null
      set({ error: `Micrófono: ${(e as Error).message}` })
    }
  },

  stop: async () => {
    await mic?.stop()
    mic = null
    set({ recording: false, level: 0 })
    await queue
  },

  toggleRecording: async () => (get().recording ? get().stop() : get().start()),

  rewrite: async (mode, redo = false) => {
    const { raw, settings, polished } = get()
    if (!raw.trim() || get().rewriting) return
    set({ rewriting: true, error: null })
    try {
      const out = await window.api.rewrite({
        text: raw, lang: settings.primaryLang, tone: settings.tone, mode,
        previous: redo ? polished : undefined
      })
      set((s) => ({ polished: out, versions: [...s.versions, out].slice(-10) }))
    } catch (e) {
      set({ error: `Redacción: ${(e as Error).message}` })
    } finally {
      set({ rewriting: false })
    }
  },

  copyPolished: async () => {
    const { polished, raw } = get()
    await window.api.copy(polished || raw)
  },

  clearAll: () => {
    const { raw, polished, versions } = get()
    trash = { raw, polished, versions }
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
