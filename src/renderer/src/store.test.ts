import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

// Mic y PartialTranscriber falsos: el store se prueba sin navegador ni audio
interface FakeMic { opts: { pauseMs?: number; mode: string; onSegment: (p: Float32Array, start?: number, meta?: { silenceMs: number; speechMs: number }) => void }; started: boolean; stopped: boolean | 'discard' }
const mics: FakeMic[] = []
const partials: { started: boolean; stopped: boolean }[] = []

vi.mock('./audio', () => {
  class MicFalso {
    started = false
    stopped: boolean | 'discard' = false
    constructor(public opts: FakeMic['opts']) { mics.push(this as unknown as FakeMic) }
    async start(): Promise<void> { if (failMic) throw new Error('sin permiso'); this.started = true }
    snapshot(): null { return null }
    async stop(discard = false): Promise<void> { this.stopped = discard ? 'discard' : true }
  }
  return {
    Mic: MicFalso,
    createMic: (opts: FakeMic['opts']) => new MicFalso(opts),
    listMics: async () => []
  }
})
vi.mock('./partial', () => ({
  PartialTranscriber: class {
    s = { started: false, stopped: false }
    constructor() { partials.push(this.s) }
    start(): void { this.s.started = true }
    stop(): void { this.s.stopped = true }
    reset(): void {}
  }
}))

let failMic = false
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void }
const defer = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

let api: Record<string, any>
let settings: Settings
let phoneHandlers: {
  onPartial: (t: string) => void
  onFinal: (t: string) => void
  onLevel: (n: number) => void
  onError: (m: string) => void
} | null = null
const seg = (): Float32Array => new Float32Array(16000)
const tick = async (ms = 0): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

async function load(over: Partial<Settings> = {}) {
  vi.resetModules()
  mics.length = 0; partials.length = 0; failMic = false; phoneHandlers = null
  settings = { ...DEFAULT_SETTINGS, mode: 'continuous', ...over }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } }
  })
  api = {
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (p: Partial<Settings>) => (settings = { ...settings, ...p })),
    onSttProgress: vi.fn(), onToggleDictation: vi.fn(), onLlmNotice: vi.fn(),
    initialView: vi.fn(async () => null),
    loadStt: vi.fn(async () => undefined), warmLLM: vi.fn(async () => undefined),
    transcribe: vi.fn(async () => ({ text: 'hola', segments: [], ms: 1 })),
    rewrite: vi.fn(async (r: { text: string }) => `R(${r.text})`),
    copy: vi.fn(), setPill: vi.fn(), notify: vi.fn()
  }
  api.platform = 'linux'
  api.phoneStt = {
    available: vi.fn(async () => ({ onDevice: false, sistema: false, motor: 'ninguno' })),
    start: vi.fn(async () => ({ onDevice: false })),
    stop: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    on: vi.fn(async (h: typeof phoneHandlers) => { phoneHandlers = h; return () => { phoneHandlers = null } })
  }
  // La interfaz usa `rewriteStream`; en la prueba se resuelve con el mismo simulador de `rewrite`.
  api.rewriteStream = vi.fn(async (r: { text: string }, onToken: (t: string) => void) => {
    const rewrite = api.rewrite as unknown as (req: { text: string }) => Promise<unknown>
    const out = (await rewrite(r)) as string
    onToken(out)
    return out
  })
  ;(globalThis as Record<string, unknown>).window = { api }
  const { useApp } = await import('./store')
  await useApp.getState().init()
  return useApp
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('inicio y parada del micrófono', () => {
  it('arranca con la pausa configurada y precarga motor y modelo de redacción', async () => {
    const app = await load({ pauseMs: 700 })
    await app.getState().start()
    expect(app.getState().recording).toBe(true)
    expect(mics[0].started).toBe(true)
    expect(mics[0].opts.pauseMs).toBe(700)
    expect(api.loadStt).toHaveBeenCalledOnce()
    expect(api.warmLLM).toHaveBeenCalledOnce()
    await app.getState().stop()
    expect(app.getState().recording).toBe(false)
    expect(mics[0].stopped).toBe(true)
  })
  it('no precarga la redacción si es manual ni el motor si es en la nube', async () => {
    const app = await load({ autoRewrite: false, sttProvider: 'openai' })
    await app.getState().start()
    expect(api.warmLLM).not.toHaveBeenCalled()
    expect(api.loadStt).not.toHaveBeenCalled()
  })
  it('un error de micrófono se informa y deja la app lista para reintentar', async () => {
    const app = await load()
    failMic = true
    await app.getState().start()
    expect(app.getState().recording).toBe(false)
    expect(app.getState().error).toMatch(/Micrófono: sin permiso/)
    failMic = false
    await app.getState().start()
    expect(app.getState().recording).toBe(true)
  })
  it('un segundo start mientras graba no crea otro micrófono', async () => {
    const app = await load()
    await app.getState().start(); await app.getState().start()
    expect(mics).toHaveLength(1)
  })
})

describe('borradores', () => {
  it('se crean por defecto y no con draftsEnabled=false', async () => {
    let app = await load()
    await app.getState().start()
    expect(partials).toHaveLength(1)
    expect(partials[0].started).toBe(true)
    await app.getState().stop()
    expect(partials[0].stopped).toBe(true)
    app = await load({ draftsEnabled: false })
    await app.getState().start()
    expect(partials).toHaveLength(0)
  })
})

describe('dictado continuo', () => {
  it('muestra la transcripción en cuanto llega, sin esperar a la redacción', async () => {
    const rw = defer<string>()
    const app = await load()
    api.rewrite.mockReturnValue(rw.promise)
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 })
    await tick()
    expect(app.getState().raw).toBe('hola')
    expect(api.rewrite).not.toHaveBeenCalled() // aún dentro de la espera
    await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    expect(api.rewrite).toHaveBeenCalledOnce()
    expect(app.getState().polished).toBe('') // la IA sigue trabajando y el original ya está visible
    expect(app.getState().raw).toBe('hola')
    rw.resolve('Hola.')
    await tick()
    expect(app.getState().polished).toBe('Hola.')
  })
  it('mantiene el orden aunque una transcripción tarde más que la siguiente', async () => {
    const app = await load({ autoRewrite: false })
    const a = defer<{ text: string; segments: never[]; ms: number }>(), b = defer<{ text: string; segments: never[]; ms: number }>()
    api.transcribe.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 })
    b.resolve({ text: 'dos', segments: [], ms: 1 }); await tick()
    expect(app.getState().raw).toBe('')
    a.resolve({ text: 'uno', segments: [], ms: 1 }); await tick()
    expect(app.getState().raw).toBe('uno dos')
    expect(app.getState().transcribing).toBe(0)
  })
  it('no pierde frases dictadas mientras otra se transcribe', async () => {
    const app = await load({ autoRewrite: false })
    const words = ['a', 'b', 'c', 'd', 'e']
    api.transcribe.mockImplementation(async () => ({ text: words.shift() ?? '', segments: [], ms: 1 }))
    await app.getState().start()
    for (let i = 0; i < 5; i++) mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 })
    await tick()
    expect(app.getState().raw).toBe('a b c d e')
  })
  it('un fallo de transcripción no bloquea las siguientes ni pierde lo anterior', async () => {
    const app = await load({ autoRewrite: false })
    api.transcribe.mockResolvedValueOnce({ text: 'uno', segments: [], ms: 1 }).mockRejectedValueOnce(new Error('El motor de voz se detuvo (código 137). Reintenta.')).mockResolvedValueOnce({ text: 'tres', segments: [], ms: 1 })
    await app.getState().start()
    for (let i = 0; i < 3; i++) mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 })
    await tick()
    expect(app.getState().raw).toBe('uno tres')
    expect(app.getState().error).toMatch(/Transcripción: El motor de voz se detuvo/)
    expect(app.getState().transcribing).toBe(0)
  })
  it('se pueden registrar métricas de latencia', async () => {
    const app = await load({ autoRewrite: false })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    const m = (globalThis as unknown as { __dictaflowMetrics: () => Record<string, { n: number }> }).__dictaflowMetrics()
    expect(m.stt_ms.n).toBe(1)
  })
})

describe('cancelación', () => {
  it('descarta lo que estaba en curso y no deja el micrófono abierto', async () => {
    const app = await load({ autoRewrite: false })
    const a = defer<string>()
    api.transcribe.mockReturnValueOnce(a.promise)
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 })
    const c = app.getState().cancel()
    a.resolve('texto que no debe aparecer')
    await c; await tick()
    expect(app.getState().raw).toBe('')
    expect(app.getState().recording).toBe(false)
    expect(mics[0].stopped).toBe('discard')
    expect(partials[0].stopped).toBe(true)
  })
  it('tras cancelar se puede dictar de nuevo', async () => {
    const app = await load({ autoRewrite: false })
    await app.getState().start(); await app.getState().cancel()
    await app.getState().start()
    mics[1].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    expect(app.getState().raw).toBe('hola')
  })
})

describe('comandos de voz', () => {
  it('«borra todo» limpia y no se escribe como texto', async () => {
    const app = await load({ autoRewrite: false })
    api.transcribe.mockResolvedValueOnce({ text: 'hola mundo', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'borra todo', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    expect(app.getState().raw).toBe('')
  })
  it('en modo controlado ejecuta el comando final tras «Flow» y escribe lo anterior', async () => {
    const app = await load({ autoRewrite: false })
    api.transcribe.mockResolvedValueOnce({ text: 'Hola equipo. Flow, nuevo párrafo.', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'Adiós', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    expect(app.getState().raw).toBe('Hola equipo.\n\nAdiós')
  })
  it('«punto y aparte» dentro del texto se vuelve un párrafo', async () => {
    const app = await load({ autoRewrite: false })
    api.transcribe.mockResolvedValueOnce({ text: 'hola qué tal punto y aparte adiós', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    expect(app.getState().raw).toBe('hola qué tal\n\nAdiós')
  })
})

describe('redacción automática', () => {
  it('en modo incremental solo redacta lo nuevo y lo añade', async () => {
    const app = await load()
    api.transcribe.mockResolvedValueOnce({ text: 'uno', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'dos', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    expect(app.getState().polished).toBe('R(uno)')
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    expect(api.rewrite.mock.calls[1][0].text).toBe('dos')
    expect(app.getState().polished).toBe('R(uno) R(dos)')
  })
  it('sin modo incremental rehace todo el texto', async () => {
    const app = await load({ rewriteIncremental: false })
    api.transcribe.mockResolvedValueOnce({ text: 'uno', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'dos', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    expect(api.rewrite.mock.calls[1][0].text).toBe('uno dos')
    expect(app.getState().polished).toBe('R(uno dos)')
  })
  it('usa la espera configurada', async () => {
    const app = await load({ rewriteDelayMs: 600 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick()
    await tick(500); expect(api.rewrite).not.toHaveBeenCalled()
    await tick(150); expect(api.rewrite).toHaveBeenCalledOnce()
  })
  it('si el usuario edita el texto ya redactado, vuelve a redactar todo', async () => {
    const app = await load()
    api.transcribe.mockResolvedValueOnce({ text: 'uno', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'dos', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    app.getState().setRaw('UNO corregido')
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(DEFAULT_SETTINGS.rewriteDelayMs)
    expect(api.rewrite.mock.calls[1][0].text).toBe('UNO corregido dos')
  })
  it('lo dictado durante una redacción se redacta después, sin perderse', async () => {
    const app = await load({ rewriteDelayMs: 100 })
    const first = defer<string>()
    api.rewrite.mockReturnValueOnce(first.promise)
    api.transcribe.mockResolvedValueOnce({ text: 'uno', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'dos', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(100)
    expect(app.getState().rewriting).toBe(true)
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(100) // se pide otra redacción mientras la primera sigue
    expect(api.rewrite).toHaveBeenCalledOnce()
    first.resolve('R1'); await tick()
    expect(api.rewrite).toHaveBeenCalledTimes(2)
    expect(api.rewrite.mock.calls[1][0].text).toBe('dos')
    await tick()
    expect(app.getState().polished).toBe('R1 R(dos)')
  })
  it('una redacción vieja no pisa un texto que ya se borró', async () => {
    const app = await load({ rewriteDelayMs: 100 })
    const slow = defer<string>()
    api.rewrite.mockReturnValueOnce(slow.promise)
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(100)
    app.getState().clearAll()
    slow.resolve('antigua'); await tick()
    expect(app.getState().polished).toBe('')
    expect(app.getState().rewriting).toBe(false)
  })
  it('si Ollama falla se informa, se conserva lo dictado y se puede reintentar', async () => {
    const app = await load({ rewriteDelayMs: 100 })
    api.rewrite.mockRejectedValueOnce(new Error('Ollama respondió 500: modelo no cargado'))
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(); await tick(100)
    expect(app.getState().error).toMatch(/Redacción: Ollama respondió 500/)
    expect(app.getState().raw).toBe('hola')
    expect(app.getState().rewriting).toBe(false)
    await app.getState().rewrite('rewrite')
    expect(app.getState().polished).toBe('R(hola)')
  })
  it('sin redacción automática solo se redacta al pedirlo', async () => {
    const app = await load({ autoRewrite: false })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(10_000)
    expect(api.rewrite).not.toHaveBeenCalled()
    await app.getState().rewrite('rewrite')
    expect(api.rewrite).toHaveBeenCalledOnce()
  })

  it('con política inteligente no llama al LLM para una frase limpia y corta', async () => {
    const app = await load({ rewritePolicy: 'smart', rewriteDelayMs: 100 })
    api.transcribe.mockResolvedValueOnce({ text: 'Hola, ¿qué tal?', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(1000)
    expect(api.rewrite).not.toHaveBeenCalled()
    expect(app.getState().raw).toBe('Hola, ¿qué tal?')
  })

  it('con el motor del teléfono no abre el micrófono del WebView y usa el texto final', async () => {
    const app = await load({ sttPhone: 'auto' })
    api.platform = 'android'
    api.phoneStt.available.mockResolvedValue({ onDevice: true, sistema: true, motor: 'on-device' })
    api.phoneStt.start.mockResolvedValue({ onDevice: true, lang: 'es-ES' })
    await app.getState().start()
    expect(app.getState().recording).toBe(true)
    expect(mics).toHaveLength(0)
    expect(api.phoneStt.start).toHaveBeenCalledOnce()
    phoneHandlers!.onPartial('hola')
    await tick()
    expect(app.getState().draft).toBe('hola')
    phoneHandlers!.onFinal('hola, ¿qué tal?')
    await tick()
    expect(app.getState().raw).toBe('hola, ¿qué tal?')
    expect(app.getState().draft).toBe('')
    const stopping = app.getState().stop()
    await tick(200)
    await stopping
    expect(api.phoneStt.stop).toHaveBeenCalledOnce()
    expect(app.getState().recording).toBe(false)
  })

  it('cae a Whisper si el teléfono no tiene motor on-device', async () => {
    const app = await load({ sttPhone: 'auto' })
    api.platform = 'android'
    api.phoneStt.available.mockResolvedValue({ onDevice: false, sistema: true, motor: 'sistema' })
    await app.getState().start()
    expect(api.phoneStt.start).not.toHaveBeenCalled()
    expect(app.getState().recording).toBe(true)
    expect(mics).toHaveLength(1)
    expect(mics[0].started).toBe(true)
  })

  it('con política inteligente añade la frase limpia a lo que ya estaba redactado', async () => {
    const app = await load({ rewritePolicy: 'smart', rewriteDelayMs: 100 })
    api.transcribe.mockResolvedValueOnce({ text: 'eh, uno', segments: [], ms: 1 }).mockResolvedValueOnce({ text: 'Dos, limpio.', segments: [], ms: 1 })
    await app.getState().start()
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(100)
    expect(app.getState().polished).toBe('R(eh, uno)')
    mics[0].opts.onSegment(seg(), 0, { silenceMs: 900, speechMs: 1000 }); await tick(1000)
    expect(api.rewrite).toHaveBeenCalledOnce()
    expect(app.getState().polished).toBe('R(eh, uno) Dos, limpio.')
  })
})

describe('avisos', () => {
  it('muestra el aviso del proceso principal cuando se protegieron cifras', async () => {
    const app = await load()
    const cb = api.onLlmNotice.mock.calls[0][0] as (m: string) => void
    cb('La redacción cambiaba cifras u horas: se conservó el texto dictado.')
    expect(app.getState().notice).toMatch(/cifras/)
  })
})
