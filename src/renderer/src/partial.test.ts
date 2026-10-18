import { describe, expect, it } from 'vitest'
import { Segmenter } from './audio'
import { PartialTranscriber } from './partial'

const audio = (sec: number): Float32Array => new Float32Array(16000 * sec).fill(0.1)

function setup(over: { busy?: () => boolean; transcribe?: (p: Float32Array) => Promise<string> } = {}) {
  const drafts: string[] = []
  let pcm: Float32Array | null = audio(2)
  const p = new PartialTranscriber({
    snapshot: () => pcm,
    transcribe: over.transcribe ?? (async () => ' hola mundo '),
    onDraft: (t) => drafts.push(t),
    busy: over.busy ?? (() => false)
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
