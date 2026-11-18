import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { DEFAULT_SETTINGS, type LibraryDoc, type Settings } from '@shared/types'
import type { CalendarEvent } from '@shared/calendar'

// Rust simulado: documentos y archivos en memoria, el selector de archivos «guarda» y los avisos se anotan.
const docs = new Map<string, { version: number; data: unknown }>()
const files = new Map<string, Uint8Array>()
const saved: { name: string; data?: Uint8Array; path?: string }[] = []
const scheduled = new Map<number, { title: string; at: number }>()
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, a: Record<string, unknown> = {}) => {
    switch (cmd) {
      case 'doc_get': return docs.get(a.name as string) ?? null
      case 'doc_list': return [...docs.keys()].sort()
      case 'doc_remove': docs.delete(a.name as string); return
      case 'file_write': {
        const prev = a.append ? files.get(a.path as string) ?? new Uint8Array() : new Uint8Array()
        const add = fromB64(a.data as string)
        const out = new Uint8Array(prev.length + add.length)
        out.set(prev); out.set(add, prev.length)
        files.set(a.path as string, out); return
      }
      case 'file_read': return files.get(a.path as string)!.slice().buffer
      case 'file_remove': for (const k of [...files.keys()]) if (k === a.path || k.startsWith(`${a.path}/`)) files.delete(k); return
      case 'file_list': {
        const dir = `${a.dir}/`
        return [...files.keys()].filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes('/')).sort()
          .map((k) => ({ nombre: k.slice(dir.length), bytes: files.get(k)!.length, carpeta: false }))
      }
      case 'save_as': {
        saved.push({ name: `${a.name}.${a.ext}`, data: a.data ? fromB64(a.data as string) : undefined, path: a.path as string | undefined })
        return `${a.name}.${a.ext}`
      }
      case 'notice_schedule': scheduled.set(a.id as number, { title: a.title as string, at: a.at as number }); return true
      case 'notice_cancel': for (const id of a.ids as number[]) scheduled.delete(id); return
      default: throw new Error(`comando inesperado: ${cmd}`)
    }
  })
}))

const { createDataHandlers, noticeId } = await import('./android-datos')

let settings: Settings
const make = (): ReturnType<typeof createDataHandlers> => createDataHandlers({
  docGet: async <T,>(name: string, fallback: T) => (docs.get(name)?.data as T) ?? fallback,
  docSet: async (name, data) => { docs.set(name, { version: 2, data }) },
  getSettings: async () => settings,
  forgetSettings: () => undefined,
  synthesize: async () => { throw new Error('sin voz') },
  generate: async (_a, text) => text.toUpperCase(),
  listModels: async () => [],
  notice: () => undefined,
  onJobs: () => undefined
})
type H = ReturnType<typeof make>
const call = <K extends keyof H>(h: H, k: K, req: Parameters<NonNullable<H[K]>>[0]): Promise<Awaited<ReturnType<NonNullable<H[K]>>>> =>
  Promise.resolve().then(() => (h[k] as (r: typeof req) => unknown)(req)) as never

const libro: LibraryDoc = {
  id: '0f8e2b1c-1111-4222-8333-444455556666', title: 'Mi libro', kind: 'txt',
  chapters: [{ title: 'Uno', text: 'Hola mundo.' }], addedAt: 1, progress: { chapter: 0, paragraph: 0 }
}
const evento = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'ev1', title: 'Dentista', notes: '', start: Date.now() + 3600_000, durationMin: 30, location: '', reminder: true, remindBeforeMin: 10, ...over
})

beforeEach(() => {
  docs.clear(); files.clear(); saved.length = 0; scheduled.clear()
  settings = { ...DEFAULT_SETTINGS, sttModel: 'ggml-small-q5_1.bin', localLlm: 'qwen.gguf' }
})

describe('datos de Android', () => {
  it('biblioteca: índice sin texto y un documento por libro', async () => {
    const h = make()
    await call(h, 'library:save', { doc: libro })
    expect(await call(h, 'library:list', undefined)).toEqual([expect.objectContaining({ id: libro.id, chapters: [{ title: 'Uno', chars: 11 }] })])
    expect(await call(h, 'library:get', { id: libro.id })).toEqual(libro)
    await call(h, 'library:progress', { id: libro.id, progress: { chapter: 0, paragraph: 3 } })
    expect((await call(h, 'library:list', undefined))[0].progress.paragraph).toBe(3)
    await call(h, 'library:remove', { id: libro.id })
    expect(docs.has(`library-${libro.id}`)).toBe(false)
    expect(await call(h, 'library:list', undefined)).toEqual([])
    await expect(call(h, 'library:get', { id: '../settings' })).rejects.toThrow('no válido')
  })

  it('agenda: programa el aviso antes del evento y lo cancela al borrarlo', async () => {
    const h = make()
    const e = evento()
    await call(h, 'cal:save', { event: e })
    expect(scheduled.get(noticeId('e', 'ev1'))).toEqual({ title: 'DictaFlow · Dentista', at: e.start - 600_000 })
    await call(h, 'rem:save', { reminder: { id: 'r1', text: 'Llamar', at: Date.now() - 1000, done: false } })
    expect(scheduled.has(noticeId('r', 'r1'))).toBe(false) // ya pasó: no se programa
    await call(h, 'cal:remove', { id: 'ev1' })
    expect(scheduled.size).toBe(0)
  })

  it('al abrir, lo pasado queda como avisado y lo que viene se programa', async () => {
    docs.set('reminders', { version: 2, data: [{ id: 'viejo', text: 'a', at: 1, done: false }, { id: 'nuevo', text: 'b', at: Date.now() + 60_000, done: false }] })
    make()
    await vi.waitFor(() => expect(scheduled.has(noticeId('r', 'nuevo'))).toBe(true))
    expect((docs.get('reminders')!.data as { id: string; done: boolean }[]).find((r) => r.id === 'viejo')!.done).toBe(true)
  })

  it('importa un ICS y lo exporta con el selector de archivos', async () => {
    const h = make()
    const n = await call(h, 'cal:import', { data: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20300101T100000Z\nSUMMARY:Año nuevo\nEND:VEVENT\nEND:VCALENDAR' })
    expect(n).toBe(1)
    expect(await call(h, 'cal:export', undefined)).toBe('dictaflow-calendario.ics')
    expect(new TextDecoder().decode(saved[0].data)).toContain('SUMMARY:Año nuevo')
  })

  it('copia de seguridad con las rutas del escritorio, y se restaura conservando los modelos del teléfono', async () => {
    const h = make()
    await call(h, 'library:save', { doc: libro })
    await call(h, 'cal:save', { event: evento() })
    docs.set('settings', { version: 2, data: { ...settings, theme: 'dark' } })
    docs.set('jobs', { version: 2, data: [] })
    files.set('voces/muestras/0f8e2b1c-1111-4222-8333-444455556666.wav', new Uint8Array([1, 2, 3]))
    const info = await call(h, 'backup:create', {})
    expect(info.file).toMatch(/^dictaflow-copia-\d{4}-\d\d-\d\d\.zip$/)
    expect(info.contents.sort()).toEqual(['calendar.json', 'library.json', `library/${libro.id}.json`, 'settings.json', 'voces/muestras/0f8e2b1c-1111-4222-8333-444455556666.wav'])
    const zip = await JSZip.loadAsync(saved[0].data!)
    // El escritorio guarda la agenda sin sobre y los ajustes con él.
    expect(Array.isArray(JSON.parse(await zip.file('calendar.json')!.async('string')))).toBe(true)
    expect(JSON.parse(await zip.file('settings.json')!.async('string')).version).toBe(2)

    // Copia del escritorio: con su modelo de Whisper, una clave (no se restaura) y basura.
    zip.file('settings.json', JSON.stringify({ version: 2, data: { theme: 'light', sttModel: 'small' } }))
    zip.file('secrets.json', '{}')
    zip.file('../fuera.json', '{}') // JSZip la deja como «fuera.json»: no es de DictaFlow
    docs.clear(); files.clear()
    const r = await call(h, 'backup:restore', { data: await zip.generateAsync({ type: 'uint8array' }) })
    expect(r.skipped.sort()).toEqual(['fuera.json', 'secrets.json'])
    expect(docs.get('settings')!.data).toMatchObject({ theme: 'light', sttModel: 'ggml-small-q5_1.bin', localLlm: 'qwen.gguf' })
    expect(docs.get(`library-${libro.id}`)!.data).toEqual(libro)
    expect(files.get('voces/muestras/0f8e2b1c-1111-4222-8333-444455556666.wav')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reuniones: el audio se escribe por partes y queda un WAV válido', async () => {
    const h = make()
    const id = '0f8e2b1c-1111-4222-8333-444455556666'
    const { path } = await call(h, 'meeting:audio-start', { sessionId: id })
    expect(path).toBe(`reuniones/${id}.wav`)
    await call(h, 'meeting:audio-chunk', { sessionId: id, pcm: new Float32Array(16000).fill(0.5) })
    await call(h, 'meeting:audio-chunk', { sessionId: id, pcm: new Float32Array(16000).fill(-0.5) })
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockImplementationOnce(async () => 2)
    expect(await call(h, 'meeting:audio-stop', { sessionId: id })).toEqual({ path, durationSec: 2 })
    expect(files.get(path)!.length).toBe(44 + 64000)
    await expect(call(h, 'meeting:audio-start', { sessionId: '../x' })).rejects.toThrow()
  })

  it('automatización: los pasos de IA se encadenan y el PDF queda para guardarlo', async () => {
    const h = make()
    await call(h, 'au:save', { automation: { id: 'a1', name: 'Resumir y PDF', createdAt: 1, steps: [{ type: 'summary' }, { type: 'pdf' }] } })
    const job = await call(h, 'au:run', { id: 'a1', title: 'Informe', text: 'texto', lang: 'es' })
    await vi.waitFor(async () => expect((await call(h, 'jobs:list', undefined)).find((j) => j.id === job.id)?.state).toBe('done'))
    const done = (await call(h, 'jobs:list', undefined)).find((j) => j.id === job.id)!
    expect(done.result).toMatch(/^exportaciones\/informe-[a-z0-9]+\.pdf$/)
    expect(new TextDecoder().decode(files.get(done.result!)!.slice(0, 5))).toBe('%PDF-')
  })
})
