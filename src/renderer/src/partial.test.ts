import { describe, expect, it } from 'vitest'
import { Segmenter } from './audio'
import { PartialTranscriber } from './partial'

const audio = (sec: number): Float32Array => new Float32Array(16000 * sec).fill(0.1)

function setup(over: { busy?: () => boolean; transcribe?: (p: Float32Array) => Promise<string>; closing?: () => boolean } = {}) {
  const drafts: string[] = []
  let pcm: Float32Array | null = audio(2)
  const p = new PartialTranscriber({
    snapshot: () => pcm,
    transcribe: over.transcribe ?? (async () => ' hola mundo '),
    onDraft: (t) => drafts.push(t),
    busy: over.busy ?? (() => false),
    closing: over.closing
  })
  return { p, drafts, set: (x: Float32Array | null) => { pcm = x } }
}

describe('PartialTranscriber', () => {
  it('publica el borrador recortado', async () => {
    const { p, drafts } = setup()
    await p.tick()
    expect(drafts).toEqual(['hola mundo'])
  })
  it('no transcribe audio demasiado corto ni ausente', async () => {
    const { p, drafts, set } = setup()
    set(audio(0.3)); await p.tick()
    set(null); await p.tick()
    expect(drafts).toEqual([])
  })
  it('no repite si el audio no creció', async () => {
    let n = 0
    const { p } = setup({ transcribe: async () => (++n, 'x') })
    await p.tick(); await p.tick()
    expect(n).toBe(1)
  })
  it('cede el paso a la transcripción definitiva', async () => {
    const { p, drafts } = setup({ busy: () => true })
    await p.tick()
    expect(drafts).toEqual([])
  })
  it('descarta el borrador si la frase se cerró durante la petición', async () => {
    let release!: (t: string) => void
    const { p, drafts } = setup({ transcribe: () => new Promise<string>((r) => { release = r }) })
    const t = p.tick()
    p.reset()
    release('viejo')
    await t
    expect(drafts).toEqual([''])
  })
  it('no se solapan peticiones', async () => {
    let n = 0
    const { p, set } = setup({ transcribe: () => (++n, new Promise<string>(() => undefined)) })
    void p.tick(); set(audio(3)); void p.tick()
    expect(n).toBe(1)
  })
  it('deja libre el motor algo más de lo que ocupó el borrador anterior', async () => {
    let n = 0
    const { p, set } = setup({ transcribe: async () => { ++n; await new Promise((r) => setTimeout(r, 30)); return 'x' } })
    await p.tick()
    set(audio(3)); await p.tick()
    expect(n).toBe(1)
    // 30 ms de inferencia → 45 ms de espera: todavía no se relanza.
    await new Promise((r) => setTimeout(r, 40))
    await p.tick()
    expect(n).toBe(1)
    await new Promise((r) => setTimeout(r, 20))
    await p.tick()
    expect(n).toBe(2)
  })
  it('no lanza borradores mientras la frase está en el silencio que la cierra', async () => {
    let n = 0
    let closing = false
    const { p, set } = setup({ transcribe: async () => { ++n; return 'x' }, closing: () => closing })
    set(audio(3))
    closing = true
    await p.tick()
    expect(n).toBe(0)
  })
  it('un fallo no rompe ni publica nada', async () => {
    const { p, drafts } = setup({ transcribe: async () => { throw new Error('x') } })
    await p.tick()
    expect(drafts).toEqual([])
  })
})

describe('Segmenter.snapshot', () => {
  it('en modo controlado devuelve lo acumulado sin consumirlo', () => {
    const got: number[] = []
    const s = new Segmenter('controlled', (p) => got.push(p.length))
    expect(s.snapshot()).toBeNull()
    s.feed(audio(1))
    expect(s.snapshot()?.length).toBe(16000)
    s.flush()
    expect(got).toEqual([16000])
  })
})

describe('Segmenter.preRoll', () => {
  it('conserva ~300 ms previos a la voz para no cortar la primera palabra', () => {
    const got: number[] = []
    const s = new Segmenter('continuous', (p) => got.push(p.length))
    const block = (v: number): Float32Array => new Float32Array(128).fill(v) // 8 ms, como el worklet
    for (let i = 0; i < 200; i++) s.feed(block(0.0005))
    for (let i = 0; i < 125; i++) s.feed(block(0.2)) // 1 s de voz
    for (let i = 0; i < 125; i++) s.feed(block(0.0005)) // >900 ms de silencio
    expect(got).toHaveLength(1)
    const sec = got[0] / 16000
    expect(sec).toBeGreaterThan(2.0) // 1 s voz + 0,9 s de cola + ~0,3 s previos
    expect(sec).toBeLessThan(2.4)
  })
})
