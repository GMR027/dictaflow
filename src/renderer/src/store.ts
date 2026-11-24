import { create } from 'zustand'
import type { DictationMode, SavedPrompt, Settings, Tone } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyDictionary } from '@shared/dictionary'
import { needsRewrite } from '@shared/rewrite-policy'
import { createMic, type MicLike } from './audio'
import { record } from './metrics'
import { PartialTranscriber } from './partial'
import { LiveTranscriber } from './live'
import { ensureMicPermission, phoneSttBias, phoneSttDisponible } from './phone-mic'
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
  /** El usuario tocó el campo de redacción: no se le vuelve a mostrar la vista previa del dictado. */
  polishedTouched: boolean
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

let mic: MicLike | null = null
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
/** Motor de voz del teléfono (Android): baja de sus eventos y espera de la última frase. */
let phoneUnsub: (() => void) | null = null
/** El motor nativo falló: se usa Whisper hasta que el usuario cambie el ajuste. */
let phoneFallo = false

export const useApp = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  view: 'dictado',
  recording: false,
  level: 0,
  raw: '',
  polished: '',
  polishedTouched: false,
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

    /** Atajo de la app o texto recibido con «Compartir con DictaFlow». */
    const inicial = async (): Promise<void> => {
      const r = await window.api.initialView?.().catch(() => null) ?? null
      if (!r) return
      if (r.vista === 'dictado' || r.vista === 'traduccion') set({ view: r.vista })
      if (r.texto) {
        set({ raw: r.texto, polished: r.texto, polishedTouched: true })
        get().flash('Texto compartido: revísalo en Dictado')
      }
    }
    await inicial()
    window.addEventListener?.('focus', () => void inicial())
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void inicial()
      })
    }

    window.api.onSttProgress((p) => {
      if (p.status === 'progress' && p.file) set({ sttLoading: `${p.file.split('/').pop()} ${Math.round(p.progress ?? 0)}%` })
      if (p.status === 'ready' || p.status === 'done') set({ sttLoading: null })
    })
    window.api.onLlmNotice((m) => get().flash(m))
    window.api.onToggleDictation(() => void get().toggleAnywhere())
  },

  setView: (view) => set({ view }),
  patchSettings: async (p) => {
    if ('sttPhone' in p) phoneFallo = false
    set({ settings: await window.api.saveSettings(p) })
  },
  setRaw: (raw) => set({ raw }),
  setPolished: (polished) => set({ polished, polishedTouched: true }),

  start: async (anywhere = false) => {
    if (get().recording) return
    const { settings } = get()
    set({ error: null, polishedTouched: false })

    /** Procesa una frase ya transcrita (Whisper o motor del teléfono). */
    const applyText = (rawText: string): void => {
      const useCmds = get().settings.voiceCommands && !anywhereSession
      const cmd = useCmds ? matchCommand(rawText) : null
      const text = cmd ? cmd.rest : useCmds ? applyFormatting(rawText) : rawText
      if (text) {
        set((s) => ({ raw: append(s.raw, text) }))
        const cfg = get().settings
        // Política «inteligente» (Android): el dictado limpio no pasa por el LLM. Si ya había
        // texto redactado, la frase limpia se añade tal cual; si no, la vista previa del campo
        // de redacción ya la muestra.
        const skip = cfg.autoRewrite && !cmd && !anywhereSession &&
          cfg.rewritePolicy === 'smart' && !needsRewrite(text, cfg.tone)
        if (skip) {
          if (get().polished.trim()) {
            set({ polished: append(get().polished, text) })
            autoBase = get().raw
          }
        } else if (!cmd && cfg.autoRewrite && !anywhereSession) {
          clearTimeout(debounce)
          // En el teléfono se adelanta la redacción para que vaya por delante del dictado.
          const delay = window.api.platform === 'android' ? Math.min(cfg.rewriteDelayMs, 400) : cfg.rewriteDelayMs
          debounce = setTimeout(() => void get().rewrite('rewrite', false, true), delay)
        }
      }
      if (cmd) {
        get().flash(`🎙 Comando: ${cmd.spec.label}`)
        void RUN[cmd.spec.id](get, set)
      }
    }

    /**
     * Motor on-device del teléfono. Devuelve false si no está disponible: entonces se sigue con
     * el micrófono del WebView y Whisper.
     */
    const startPhone = async (): Promise<boolean> => {
      const mine = epoch
      let unsub: (() => void) | null = null
      let lastPartialAt = 0
      try {
        // El reconocedor nativo no pide el permiso por su cuenta.
        await ensureMicPermission()
        unsub = await window.api.phoneStt.on({
          onPartial: (t) => {
            if (mine !== epoch) return
            lastPartialAt = performance.now()
            set({ draft: t })
          },
          onLevel: (n) => {
            if (mine === epoch) set({ level: Math.max(0, Math.min(1, n)) })
          },
          onFinal: (t) => {
            if (mine !== epoch) return
            if (lastPartialAt) record('stt_total_ms', performance.now() - lastPartialAt)
            lastPartialAt = 0
            set({ draft: '' })
            const text = applyDictionary(t, get().settings.dictionary)
            if (!text.trim()) return
            lastPhraseAt = performance.now()
            applyText(text)
          },
          onError: (msg) => {
            if (mine !== epoch) return
            // Un fallo del motor nativo no debe dejar la app «grabando» sin recibir nada.
            phoneFallo = true
            phoneUnsub?.()
            phoneUnsub = null
            set({ recording: false, level: 0, draft: '' })
            get().flash(`Voz del teléfono: ${msg} Se usará Whisper.`)
          }
        })
        const r = await window.api.phoneStt.start({
          lang: settings.primaryLang,
          continuous: settings.mode === 'continuous',
          bias: phoneSttBias(settings)
        })
        if (!r.onDevice || phoneFallo) {
          unsub()
          unsub = null
          await window.api.phoneStt.cancel().catch(() => undefined)
          return false
        }
        phoneUnsub = unsub
        unsub = null
        if (settings.autoRewrite && !anywhere) void window.api.warmLLM()
        set({ recording: true })
        return true
      } catch (e) {
        unsub?.()
        await window.api.phoneStt.cancel().catch(() => undefined)
        const mensaje = (e as Error).message
        // Un permiso denegado también rompe Whisper: que lo explique el camino normal.
        if (!/permiso|permission|notallowed/i.test(mensaje)) phoneFallo = true
        console.debug(`[stt] motor del teléfono no disponible: ${mensaje}`)
        return false
      }
    }

    if (!phoneFallo && !anywhere && await phoneSttDisponible(settings)) {
      if (await startPhone()) return
    }

    try {
      mic = createMic({
        deviceId: settings.micDeviceId,
        mode: anywhere ? 'controlled' : settings.mode,
        pauseMs: settings.pauseMs,
        filters: settings.micFilters,
        onLevel: (level) => set({ level }),
        onAudio: (chunk) => live?.feed(chunk),
        // El silencio que cierra la frase: a partir de aquí el motor se deja libre.
        onSilence: () => { closing = true },
        // Acción «Detener» de la notificación: la interfaz deja de mostrar la grabación.
        onEnded: () => {
          if (!get().recording) return
          set({ recording: false, level: 0, draft: '' })
          get().flash('⏹ Grabación detenida desde la notificación')
        },
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
              applyText(r.text)
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
    if (phoneUnsub) {
      const unsub = phoneUnsub
      phoneUnsub = null
      try {
        // El plugin resuelve cuando llega el resultado final o tras un tiempo máximo.
        await window.api.phoneStt.stop()
      } catch {
        // El motor ya estaba detenido.
      }
      // El evento `final` viaja por otro canal: se le da un instante antes de dejar de escuchar.
      await new Promise<void>((resolve) => setTimeout(resolve, 120))
      unsub()
      set({ recording: false, level: 0, draft: '' })
      await queue
      return
    }
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
    if (phoneUnsub) {
      const unsub = phoneUnsub
      phoneUnsub = null
      await window.api.phoneStt.cancel().catch(() => undefined)
      unsub()
      set({ recording: false, level: 0, draft: '' })
      get().flash('⏹ Transcripción detenida')
      return
    }
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
    // En incremental se conserva lo ya redactado y solo se añade lo nuevo; si no, el texto se
    // reemplaza según llegan los tokens (streaming).
    const base = incremental ? `${polished.replace(/\s+$/, '')} ` : ''
    let streamed = ''
    let firstToken = 0
    // Algunos modelos escriben su razonamiento antes de la respuesta: no se muestra en el campo.
    const visible = (t: string): string => t
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    const onToken = (chunk: string): void => {
      if (!chunk) return
      if (!firstToken) {
        firstToken = performance.now()
        record('first_token_ms', firstToken - t0)
      }
      streamed += chunk
      if (!get().raw.startsWith(raw)) return
      const next = incremental ? `${base}${visible(streamed).trimStart()}` : visible(streamed)
      set({ polished: next })
    }
    try {
      const out = await window.api.rewriteStream({
        text, lang: settings.primaryLang, tone: settings.tone, mode,
        previous: redo ? polished : undefined,
        // En el camino automático del teléfono no se reintenta: conservar lo dictado es más rápido.
        fast: auto && window.api.platform === 'android'
      }, onToken)
      record('rewrite_ms', performance.now() - t0)
      // Si el usuario limpió o editó el texto mientras tanto, esta respuesta ya no le corresponde
      if (!get().raw.startsWith(raw) || !out.trim()) return
      const next = incremental ? `${base}${out.trimStart()}` : out
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
    set({ raw: '', polished: '', polishedTouched: false, versions: [] })
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
    set({ raw: '', polished: '', polishedTouched: false, versions: [] })
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
