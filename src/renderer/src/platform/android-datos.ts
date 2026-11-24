// Android: biblioteca, agenda y recordatorios, automatizaciones, «Mis voces», reuniones,
// exportaciones, audiolibros, copias de seguridad y registro de red.
//
// Los datos son documentos JSON que guarda Rust (`doc_*`, mismo formato `{version, data}` que el
// escritorio) y los archivos (audio, exportaciones a medias) viven en la carpeta propia de la app
// (`./archivos`). Lo que sale del teléfono pasa por el selector de archivos de Android.
import { invoke } from '@tauri-apps/api/core'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'
import type { Lang, LibraryDoc, LibraryMeta, NetEvent, PersonalVoice, Settings, VoiceRecording } from '@shared/types'
import type { CalendarEvent, Reminder } from '@shared/calendar'
import type { GeneratedClip } from '@shared/voice'
import type { Job } from '@shared/job'
import { STEP_INFO, type Automation, type StepType } from '@shared/automation'
import type { ContentAction } from '@shared/llm-tasks'
import { splitText } from '@shared/text'
import { localVoice, modelReady } from '@shared/local-models'
import { migrateSettings } from '../../../main/migrate'
import { extOf, fileJoin, fileList, fileRead, fileRemove, fileWrite, Mp3File, saveAs, slug, wavRate } from './archivos'
import { JobQueue } from './trabajos'

type Handler<K extends IpcChannel> = (req: IpcReq<K>) => Promise<IpcRes<K>> | IpcRes<K>
export type Handlers = { [K in IpcChannel]?: Handler<K> }

/** Lo que este módulo necesita del resto de `window.api` en Android. */
export interface DataDeps {
  docGet: <T>(name: string, fallback: T) => Promise<T>
  docSet: (name: string, data: unknown) => Promise<void>
  getSettings: () => Promise<Settings>
  /** Olvida los ajustes en memoria (tras restaurar una copia). */
  forgetSettings: () => void
  synthesize: (text: string, lang: Lang, voice?: string) => Promise<Uint8Array>
  generate: (action: ContentAction, text: string, lang: Lang) => Promise<string>
  listModels: () => Promise<{ id: string; bytes: number; partial: boolean }[]>
  notice: (msg: string) => void
  /** Avisa a la interfaz de que cambió la lista de trabajos. */
  onJobs: (jobs: Job[]) => void
}

const docRemove = (name: string): Promise<void> => invoke('doc_remove', { name })
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

/** Un identificador que va a formar parte de un nombre de documento o de archivo. */
function safeId(id: string): string {
  if (!/^[a-z0-9-]{1,50}$/.test(id)) throw new Error(`Identificador no válido: «${id}».`)
  return id
}

// ── Registro de red (pestaña Privacidad) ────────────────────────────────────────────────────
const netEvents: NetEvent[] = []

/**
 * Antes de cada conexión del teléfono (descargar un modelo, una muestra de voz): la bloquea en modo
 * offline estricto y, si sale, la anota.
 */
export async function netGuard(settings: Settings, purpose: string, url: string): Promise<void> {
  const host = new URL(url).hostname
  if (settings.strictOffline) throw new Error(`Modo offline estricto: bloqueada la conexión a ${host}.`)
  netEvents.unshift({ ts: Date.now(), host, purpose, bytes: 0 })
  netEvents.length = Math.min(netEvents.length, 200)
}

/** Duración de un WAV PCM16 (cabecera de 44 bytes). */
const wavSeconds = (wav: Uint8Array): number => {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  return Math.round(((wav.length - 44) / Math.max(1, v.getUint32(28, true))) * 10) / 10
}

/** Cabecera WAV PCM16 mono sin datos (se completa al cerrar la grabación). */
function wavHeader(rate: number): Uint8Array {
  const b = new Uint8Array(44)
  const v = new DataView(b.buffer)
  const str = (o: number, s: string): void => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); v.setUint32(4, 36, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, 0, true)
  return b
}

const pcm16 = (pcm: Float32Array): Uint8Array => {
  const out = new Uint8Array(pcm.length * 2)
  const v = new DataView(out.buffer)
  for (let i = 0; i < pcm.length; i++) v.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true)
  return out
}

/** Identificador numérico (32 bits) de una notificación de Android a partir del de DictaFlow. */
export function noticeId(kind: 'e' | 'r', id: string): number {
  let h = 0x811c9dc5
  for (const c of `${kind}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return h & 0x7fffffff
}

export function createDataHandlers(d: DataDeps): Handlers {
  // ── Biblioteca: índice en `library`, cada libro en `library-<id>` (como library/<id>.json) ──
  const library = (): Promise<LibraryMeta[]> => d.docGet<LibraryMeta[]>('library', [])
  const libraryDoc = (id: string): Promise<LibraryDoc | null> => d.docGet<LibraryDoc | null>(`library-${safeId(id)}`, null)

  // ── Agenda: los avisos se programan como notificaciones de Android (suenan con la app cerrada) ──
  const events = (): Promise<CalendarEvent[]> => d.docGet<CalendarEvent[]>('calendar', [])
  const reminders = (): Promise<Reminder[]> => d.docGet<Reminder[]>('reminders', [])
  let deniedNotice = false

  async function schedule(id: number, title: string, body: string, at: number): Promise<void> {
    if (at <= Date.now()) return
    const ok = await invoke<boolean>('notice_schedule', { id, title, body, at })
    if (!ok && !deniedNotice) {
      deniedNotice = true
      d.notice('Sin permiso de notificaciones: los avisos de la agenda no sonarán. Actívalo en Ajustes de Android → Apps → DictaFlow.')
    }
  }
  const cancelNotice = (ids: number[]): Promise<void> => invoke('notice_cancel', { ids })
  const eventNotice = (e: CalendarEvent): Promise<void> =>
    e.reminder
      ? schedule(noticeId('e', e.id), `DictaFlow · ${e.title}`, e.remindBeforeMin > 0 ? `Empieza en ${e.remindBeforeMin} minutos` : 'Empieza ahora', e.start - e.remindBeforeMin * 60000)
      : cancelNotice([noticeId('e', e.id)])
  const reminderNotice = (r: Reminder): Promise<void> =>
    r.done ? cancelNotice([noticeId('r', r.id)]) : schedule(noticeId('r', r.id), 'DictaFlow · Recordatorio', r.text, r.at)

  /**
   * Al abrir la app (y tras restaurar una copia): lo que ya pasó queda como avisado y lo que viene
   * se vuelve a programar (programar el mismo aviso otra vez lo reemplaza).
   */
  async function syncNotices(): Promise<void> {
    const now = Date.now()
    const rs = await reminders()
    if (rs.some((r) => !r.done && r.at <= now)) await d.docSet('reminders', rs.map((r) => (!r.done && r.at <= now ? { ...r, done: true } : r)))
    const es = await events()
    if (es.some((e) => e.reminder && !e.notified && e.start - e.remindBeforeMin * 60000 <= now)) {
      await d.docSet('calendar', es.map((e) => (e.reminder && !e.notified && e.start - e.remindBeforeMin * 60000 <= now ? { ...e, notified: true } : e)))
    }
    for (const r of rs) if (!r.done && r.at > now) await reminderNotice(r)
    for (const e of es) if (e.reminder && e.start - e.remindBeforeMin * 60000 > now) await eventNotice(e)
  }
  void syncNotices().catch((e) => console.warn('avisos de la agenda:', e))

  async function saveEvent(e: CalendarEvent): Promise<void> {
    const all = (await events()).filter((x) => x.id !== e.id)
    all.push({ ...e, notified: false })
    all.sort((a, b) => a.start - b.start)
    await d.docSet('calendar', all)
    await eventNotice(e)
  }

  // ── «Mis voces»: solo voces del teléfono (la clonación necesita un servicio en la red) ──
  const voices = (): Promise<PersonalVoice[]> => d.docGet<PersonalVoice[]>('pv-voices', [])
  const recordings = (): Promise<VoiceRecording[]> => d.docGet<VoiceRecording[]>('pv-recordings', [])
  const generated = (): Promise<GeneratedClip[]> => d.docGet<GeneratedClip[]>('pv-generated', [])
  const CLONE_OFF = 'La clonación de voz necesita un servicio en tu red y en Android la IA solo corre dentro del teléfono. Usa una voz del teléfono.'

  async function voiceAvailability(v: PersonalVoice): Promise<Pick<PersonalVoice, 'available' | 'unavailableReason'>> {
    if (v.engine !== 'piper') return { available: false, unavailableReason: CLONE_OFF }
    const m = v.piperVoice ? localVoice(v.piperVoice) : undefined
    return m && modelReady(m, await d.listModels())
      ? { available: true }
      : { available: false, unavailableReason: 'Falta descargar esa voz en Ajustes → Servicios.' }
  }

  // ── Reuniones: el audio se escribe a disco mientras se graba ──
  const meetings = new Map<string, { path: string; pending: Uint8Array[]; bytes: number; writing: Promise<void> }>()
  const meetingFlush = (s: { path: string; pending: Uint8Array[]; bytes: number; writing: Promise<void> }): Promise<void> => {
    if (!s.pending.length) return s.writing
    const out = new Uint8Array(s.bytes)
    let o = 0
    for (const b of s.pending) { out.set(b, o); o += b.length }
    s.pending = []
    s.bytes = 0
    s.writing = s.writing.then(() => fileWrite(s.path, out, true))
    return s.writing
  }

  // ── Voz a MP3 ──
  /**
   * Lee un texto en voz alta y lo escribe como MP3 en un archivo propio. `step` se llama antes de
   * cada trozo (para avisar del progreso y parar si se canceló).
   */
  async function textToMp3(text: string, lang: Lang, voice: string | undefined, path: string, max = 400, step?: (i: number, n: number) => void): Promise<boolean> {
    const units = splitText(text, max)
    if (!units.length) return false
    let mp3: Mp3File | null = null
    for (let i = 0; i < units.length; i++) {
      step?.(i, units.length)
      const wav = await d.synthesize(units[i], lang, voice)
      mp3 ??= new Mp3File(path, wavRate(wav))
      await mp3.pushWav(wav)
    }
    await mp3!.finish()
    return true
  }

  const exportName = (title: string, ext: string): string => `exportaciones/${slug(title)}-${Date.now().toString(36)}.${ext}`

  // ── Trabajos en segundo plano ──
  const jobs = new JobQueue(() => d.docGet<Job[]>('jobs', []), (list) => d.docSet('jobs', list))

  jobs.register('audiobook', async (ctx) => {
    const p = ctx.job.payload ?? {}
    const doc = await libraryDoc(String(p.docId))
    if (!doc) throw new Error('El documento ya no está en la biblioteca.')
    const lang = (p.lang as Lang) ?? 'es'
    const dir = `audiolibros/${slug(doc.title)}`
    const done = new Map((await fileList(dir)).map((f) => [f.nombre, f.bytes]))
    const files: string[] = []
    const total = doc.chapters.length || 1
    for (let i = 0; i < doc.chapters.length; i++) {
      ctx.check()
      const ch = doc.chapters[i]
      const name = `${String(i + 1).padStart(3, '0')}-${slug(ch.title)}.mp3`
      const label = `Capítulo ${i + 1} de ${total}: `
      // Los capítulos ya hechos (de una vez anterior que se interrumpió) se saltan.
      if (done.get(name)) { files.push(`${dir}/${name}`); continue }
      ctx.report((i / total) * 100, `${label}${ch.title}`)
      const tmp = `${dir}/${name}.parcial`
      try {
        const step = (u: number, n: number): void => {
          ctx.check()
          ctx.report(((i + u / n) / total) * 100, `${label}párrafo ${u + 1} de ${n}`)
        }
        if (!(await textToMp3(ch.text, lang, p.voice as string | undefined, tmp, 350, step))) continue
      } catch (e) {
        await fileRemove(tmp).catch(() => undefined)
        throw e
      }
      await fileJoin([tmp], `${dir}/${name}`)
      await fileRemove(tmp)
      files.push(`${dir}/${name}`)
    }
    if (!files.length) throw new Error('El documento no tiene texto que leer.')
    const final = `${dir}/${slug(doc.title)}.mp3`
    ctx.report(99, 'Uniendo capítulos')
    await fileJoin(files, final)
    return final
  })

  jobs.register('automation', async (ctx) => {
    const p = ctx.job.payload ?? {}
    const a = (await d.docGet<Automation[]>('automations', [])).find((x) => x.id === String(p.automationId))
    if (!a) throw new Error('Esa automatización ya no existe.')
    const title = String(p.title ?? 'Automatización')
    const lang = (p.lang as Lang) ?? 'es'
    let text = String(p.text ?? '')
    const files: string[] = []
    const details: string[] = []
    for (const [i, step] of a.steps.entries()) {
      ctx.check()
      ctx.report(((i + 0.5) / a.steps.length) * 100, `${STEP_INFO[step.type].label}…`)
      switch (step.type) {
        case 'summary': text = await d.generate('summary', text, lang); details.push('Resumen generado'); break
        case 'notes': text = await d.generate('notes', text, lang); details.push('Notas generadas'); break
        case 'minutes': text = await d.generate('meeting', text, lang); details.push('Acta generada'); break
        case 'pdf': {
          const f = exportName(title, 'pdf')
          const { buildPdf } = await import('@shared/pdf')
          await fileWrite(f, await buildPdf(title, text))
          files.push(f); details.push('PDF listo'); break
        }
        case 'note': {
          const f = exportName(step.text || title, 'md')
          await fileWrite(f, noteMarkdown(step.text || title, text, ['automatización']))
          files.push(f); details.push('Nota lista'); break
        }
        case 'event': {
          await saveEvent({
            id: crypto.randomUUID(), title: step.text || title, notes: text.slice(0, 2000),
            start: Date.now() + (step.inMinutes ?? 60) * 60000, durationMin: step.minutes ?? 30, location: '', reminder: true, remindBeforeMin: 10
          })
          details.push('Evento creado en la agenda'); break
        }
        case 'tts': {
          const f = exportName(title, 'mp3')
          const at = ((i + 0.5) / a.steps.length) * 100
          const step = (u: number, n: number): void => { ctx.check(); ctx.report(at, `Audio: párrafo ${u + 1} de ${n}`) }
          if (await textToMp3(text, lang, undefined, f, 400, step)) { files.push(f); details.push('Audio listo') }
          break
        }
      }
    }
    ctx.report(100, details.join(' · '))
    return files.join('\n') || text.slice(0, 200)
  })
  jobs.onChange(d.onJobs)
  jobs.start()

  // ── Copia de seguridad: mismo ZIP que el escritorio (rutas de su carpeta de datos) ──
  /** Documento de Android → ruta en el ZIP, y si va con sobre `{version,data}` (el escritorio guarda
   *  agenda, automatizaciones y voces sin él). */
  const RAW: Record<string, string> = {
    calendar: 'calendar.json', reminders: 'reminders.json', automations: 'automations.json',
    'pv-voices': 'voces/voces.json', 'pv-recordings': 'voces/grabaciones.json', 'pv-generated': 'voces/generados.json'
  }
  const ENVELOPED = ['settings', 'library', 'meetings', 'prompts', 'history']
  const NOT_COPIED = ['jobs', 'servidor']

  const zipPath = (doc: string): [string, boolean] | null =>
    RAW[doc] ? [RAW[doc], false]
      : ENVELOPED.includes(doc) ? [`${doc}.json`, true]
        : doc.startsWith('library-') ? [`library/${doc.slice(8)}.json`, true]
          : null

  const docFromZip = (path: string): string | null => {
    const raw = Object.entries(RAW).find(([, p]) => p === path)?.[0]
    if (raw) return raw
    const m = /^([a-z]+)\.json$/.exec(path)
    if (m && ENVELOPED.includes(m[1])) return m[1]
    const lib = /^library\/([a-z0-9-]{1,50})\.json$/.exec(path)
    return lib ? `library-${lib[1]}` : null
  }

  return {
    'library:list': () => library(),
    'library:get': ({ id }) => libraryDoc(id),
    'library:save': async ({ doc }) => {
      await d.docSet(`library-${safeId(doc.id)}`, doc)
      const meta: LibraryMeta = {
        id: doc.id, title: doc.title, kind: doc.kind, chapters: doc.chapters.map((c) => ({ title: c.title, chars: c.text.length })),
        addedAt: doc.addedAt, progress: doc.progress
      }
      const index = await library()
      const i = index.findIndex((m) => m.id === doc.id)
      if (i >= 0) index[i] = meta
      else index.unshift(meta)
      await d.docSet('library', index)
    },
    'library:progress': async ({ id, progress }) => {
      const index = await library()
      const i = index.findIndex((m) => m.id === id)
      if (i < 0) return
      index[i] = { ...index[i], progress }
      await d.docSet('library', index)
    },
    'library:remove': async ({ id }) => {
      await docRemove(`library-${safeId(id)}`)
      await d.docSet('library', (await library()).filter((m) => m.id !== id))
    },

    'cal:list': () => events(),
    'cal:save': ({ event }) => saveEvent(event),
    'cal:remove': async ({ id }) => {
      await d.docSet('calendar', (await events()).filter((e) => e.id !== id))
      await cancelNotice([noticeId('e', id)])
    },
    'cal:export': async () => {
      const { toIcs } = await import('@shared/ics')
      return saveAs('dictaflow-calendario', 'ics', { data: toIcs(await events()) })
    },
    'cal:import': async ({ data }) => {
      const { parseIcs } = await import('@shared/ics')
      const evs = parseIcs(data)
      for (const e of evs) await saveEvent({ id: crypto.randomUUID(), ...e, reminder: false, remindBeforeMin: 0 })
      return evs.length
    },
    'rem:list': () => reminders(),
    'rem:save': async ({ reminder }) => {
      const all = (await reminders()).filter((x) => x.id !== reminder.id)
      all.push(reminder)
      all.sort((a, b) => a.at - b.at)
      await d.docSet('reminders', all)
      await reminderNotice(reminder)
    },
    'rem:remove': async ({ id }) => {
      await d.docSet('reminders', (await reminders()).filter((r) => r.id !== id))
      await cancelNotice([noticeId('r', id)])
    },

    'au:list': () => d.docGet<Automation[]>('automations', []),
    'au:save': async ({ automation }) => {
      const all = (await d.docGet<Automation[]>('automations', [])).filter((x) => x.id !== automation.id)
      await d.docSet('automations', [automation, ...all])
    },
    'au:remove': async ({ id }) => d.docSet('automations', (await d.docGet<Automation[]>('automations', [])).filter((a) => a.id !== id)),
    'au:steps': () => Object.entries(STEP_INFO).map(([type, v]) => ({ type: type as StepType, label: v.label, detail: v.detail })),
    'au:run': async ({ id, title, text, lang }) => {
      const a = (await d.docGet<Automation[]>('automations', [])).find((x) => x.id === id)
      if (!a) throw new Error('Esa automatización ya no existe.')
      return jobs.enqueue('automation', a.name, { automationId: a.id, title, text, lang })
    },

    'jobs:list': () => jobs.list(),
    'jobs:cancel': ({ id }) => jobs.cancel(id),
    'jobs:clear': () => jobs.clearFinished(),
    'audio:audiobook': async ({ docId, lang, voice }) => {
      const doc = await libraryDoc(docId)
      if (!doc) throw new Error('El documento ya no está en la biblioteca.')
      return jobs.enqueue('audiobook', `Audiolibro: ${doc.title}`, { docId, lang, voice })
    },
    'audio:audiobooks': async () =>
      (await fileList('audiolibros')).filter((f) => f.carpeta).map((f) => ({
        title: f.nombre, dir: `audiolibros/${f.nombre}`, files: 0, sizeMB: Math.round((f.bytes / 1048576) * 10) / 10
      })),
    'audio:export': async ({ text, lang, voice, name }) => {
      const tmp = exportName(name, 'mp3')
      try {
        if (!(await textToMp3(text, lang, voice, tmp))) throw new Error('No hay texto que convertir en audio.')
        return await saveAs(name, 'mp3', { path: tmp })
      } finally {
        await fileRemove(tmp).catch(() => undefined)
      }
    },

    'note:export': ({ title, body, tags }) => saveAs(`${today()}-${slug(title)}`, 'md', { data: noteMarkdown(title, body, tags) }),
    'pdf:generate': async ({ title, body, name }) => {
      const { buildPdf } = await import('@shared/pdf')
      return saveAs(name ?? 'documento', 'pdf', { data: await buildPdf(title, body) })
    },
    'file:save': ({ name, data }) => saveAs(name, extOf(name) || 'txt', { data }),
    'file:open': ({ exts }) => pickFile(exts),
    'file:export': ({ path }) => saveAs(path.split('/').pop()!.replace(/\.[^.]+$/, ''), extOf(path) || 'bin', { path }),

    'meeting:audio-start': async ({ sessionId }) => {
      if (!UUID.test(sessionId)) throw new Error('Sesión no válida.')
      const path = `reuniones/${sessionId}.wav`
      await fileWrite(path, wavHeader(16000))
      meetings.set(sessionId, { path, pending: [], bytes: 0, writing: Promise.resolve() })
      return { sessionId, path }
    },
    'meeting:audio-chunk': ({ sessionId, pcm }) => {
      const s = meetings.get(sessionId)
      if (!s) return
      const b = pcm16(pcm)
      s.pending.push(b)
      s.bytes += b.length
      // Se escribe cada ~2 s de audio.
      if (s.bytes >= 64000) void meetingFlush(s).catch((e) => d.notice(`No se pudo guardar el audio de la reunión: ${(e as Error).message}`))
    },
    'meeting:audio-stop': async ({ sessionId }) => {
      const s = meetings.get(sessionId)
      if (!s) return null
      meetings.delete(sessionId)
      await meetingFlush(s)
      const durationSec = await invoke<number>('wav_close', { path: s.path })
      return { path: s.path, durationSec }
    },
    'meeting:audio-read': async ({ path }) => {
      // La reunión guarda la ruta absoluta; `file_read` trabaja dentro de `archivos`.
      const rel = path.split('/archivos/')[1] ?? path
      return fileRead(rel)
    },
    'meeting:audio-discard': async ({ sessionId }) => {
      const s = meetings.get(sessionId)
      meetings.delete(sessionId)
      await s?.writing.catch(() => undefined)
      if (UUID.test(sessionId)) await fileRemove(`reuniones/${sessionId}.wav`)
    },

    'pv:list': () => voices(),
    'pv:save': async ({ voice }) => {
      if (!voice.consent?.authorizedBy?.trim()) throw new Error('Falta el consentimiento: dice quién autoriza el uso de esta voz.')
      if (!voice.consent.date) throw new Error('Falta la fecha del consentimiento.')
      const saved: PersonalVoice = { ...voice, ...(await voiceAvailability(voice)) }
      const all = await voices()
      const i = all.findIndex((x) => x.id === voice.id)
      if (i >= 0) all[i] = saved
      else all.unshift(saved)
      await d.docSet('pv-voices', all)
      return saved
    },
    'pv:remove': async ({ id }) => d.docSet('pv-voices', (await voices()).filter((v) => v.id !== id)),
    'pv:recordings': () => recordings(),
    'pv:add-recording': async ({ name, data, speaker, durationSec }) => {
      const id = crypto.randomUUID()
      const path = `voces/muestras/${id}.wav`
      await fileWrite(path, data)
      const r: VoiceRecording = { id, name, path, durationSec, createdAt: Date.now(), speaker }
      await d.docSet('pv-recordings', [r, ...(await recordings())])
      return r
    },
    'pv:remove-recording': async ({ id }) => {
      const all = await recordings()
      const r = all.find((x) => x.id === id)
      if (r?.path.startsWith('voces/')) await fileRemove(r.path)
      await d.docSet('pv-recordings', all.filter((x) => x.id !== id))
    },
    'pv:generated': () => generated(),
    'pv:remove-generated': async ({ id }) => {
      const all = await generated()
      const c = all.find((x) => x.id === id)
      if (c?.path.startsWith('voces/')) await fileRemove(c.path)
      await d.docSet('pv-generated', all.filter((x) => x.id !== id))
    },
    'pv:audio': ({ path }) => {
      if (!path.startsWith('voces/')) throw new Error('Ese audio no pertenece a DictaFlow.')
      return fileRead(path)
    },
    'pv:engine': () => ({ ok: false, message: CLONE_OFF, url: '' }),
    'pv:synthesize': async ({ voiceId, text }) => {
      const voice = (await voices()).find((v) => v.id === voiceId)
      if (!voice) throw new Error('Esa voz no existe.')
      if (voice.engine !== 'piper' || !voice.piperVoice) throw new Error(CLONE_OFF)
      const audio = await d.synthesize(text, voice.lang, voice.piperVoice)
      const id = crypto.randomUUID()
      const path = `voces/generados/${id}.wav`
      await fileWrite(path, audio)
      const durationSec = wavSeconds(audio)
      await d.docSet('pv-generated', [{ id, voiceId: voice.id, voiceName: voice.name, text, path, createdAt: Date.now(), durationSec }, ...(await generated())].slice(0, 100))
      return { path, durationSec }
    },

    'backup:create': async () => {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const contents: string[] = []
      for (const doc of await invoke<string[]>('doc_list')) {
        const target = zipPath(doc)
        if (!target || NOT_COPIED.includes(doc)) continue
        const raw = await invoke<{ version: number; data: unknown } | null>('doc_get', { name: doc })
        if (!raw) continue
        zip.file(target[0], JSON.stringify(target[1] ? raw : raw.data, null, 2))
        contents.push(target[0])
      }
      // Las grabaciones y audios de «Mis voces» (los modelos no: se vuelven a descargar).
      for (const dir of ['voces/muestras', 'voces/generados']) {
        for (const f of await fileList(dir)) {
          if (f.carpeta) continue
          zip.file(`${dir}/${f.nombre}`, await fileRead(`${dir}/${f.nombre}`))
          contents.push(`${dir}/${f.nombre}`)
        }
      }
      const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const file = await saveAs(`dictaflow-copia-${today()}`, 'zip', { data })
      if (!file) throw new Error('No se guardó la copia (cancelado).')
      return { file, createdAt: Date.now(), sizeMB: Math.round((data.length / 1048576) * 10) / 10, contents }
    },
    'backup:restore': async ({ data }) => {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(data)
      const restored: string[] = []
      const skipped: string[] = []
      const current = await d.getSettings()
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue
        const audio = /^voces\/(muestras|generados)\/[0-9a-f-]{36}\.wav$/.test(name)
        const doc = docFromZip(name)
        if (audio) {
          await fileWrite(name, await entry.async('uint8array'))
        } else if (doc) {
          let value: unknown = JSON.parse(await entry.async('string'))
          const env = value && typeof value === 'object' && 'version' in value && 'data' in value ? (value as { version: number; data: unknown }) : null
          value = env ? env.data : value
          if (doc === 'settings') {
            // Los modelos de Whisper y de redacción son los de este teléfono, no los de la copia.
            const s = migrateSettings(value, env?.version ?? 1)
            value = { ...s, sttModel: current.sttModel, localLlm: current.localLlm }
          }
          await d.docSet(doc, value)
        } else {
          skipped.push(name)
          continue
        }
        restored.push(name)
      }
      d.forgetSettings()
      await syncNotices()
      return { restored, skipped }
    },

    'net:events': () => ({ events: [...netEvents], dataDir: 'almacenamiento privado de DictaFlow en este teléfono' }),
    'net:clear': () => { netEvents.length = 0 },
    'llm:models': () => ({ bin: null, models: [], providers: [] })
  }
}

/** Fecha local AAAA-MM-DD (toISOString da la de UTC: de noche en México ya sería «mañana»). */
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Markdown con metadatos, como las notas del escritorio (Obsidian, Logseq…). */
function noteMarkdown(title: string, body: string, tags: string[]): string {
  const yaml = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`
  const clean = tags.map((t) => t.replace(/[",\n]/g, ' ').trim()).filter(Boolean)
  return `---\ntitle: ${yaml(title)}\ndate: ${new Date().toISOString()}\ntags: [${clean.join(', ')}]\nsource: dictaflow\n---\n\n${body}\n`
}

/** Selector de archivos del sistema (el WebView de Android lo abre con un <input type="file">). */
function pickFile(exts: string[]): Promise<{ name: string; data: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = exts.map((e) => `.${e.replace(/^\./, '')}`).join(',')
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      f.arrayBuffer().then((b) => resolve({ name: f.name, data: new Uint8Array(b) }), reject)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}
