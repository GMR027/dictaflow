import { describe, expect, it, vi } from 'vitest'
import { LiveTranscriber, type LiveApi } from './live'

const chunk = (n = 2560): Float32Array => new Float32Array(n)
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function fakeApi(over: Partial<LiveApi> = {}): LiveApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    liveStart: vi.fn(async () => 7),
    liveFeed: vi.fn(async () => ({ text: 'hola mundo' })),
    liveReset: vi.fn(async () => undefined),
    liveStop: vi.fn(async () => undefined),
    ...over
  } as LiveApi & Record<string, ReturnType<typeof vi.fn>>
}

describe('LiveTranscriber', () => {
  it('sin modelo (o idioma sin soporte) no se crea', async () => {
    expect(await LiveTranscriber.create('es', () => undefined, fakeApi({ liveStart: vi.fn(async () => null) }))).toBeNull()
    expect(await LiveTranscriber.create('fr', () => undefined, fakeApi())).toBeNull()
    expect(await LiveTranscriber.create('es', () => undefined, fakeApi({ liveStart: vi.fn(async () => { throw new Error('x') }) }))).toBeNull()
  })

  it('manda audio por bloques y escribe el texto con mayúscula', async () => {
    const api = fakeApi()
    const out: string[] = []
    const lt = (await LiveTranscriber.create('es', (t) => out.push(t), api))!
    lt.feed(chunk(1000))
    expect(api.liveFeed).not.toHaveBeenCalled()
    lt.feed(chunk(2000))
    await flush()
    expect(api.liveFeed).toHaveBeenCalledWith(7, expect.any(Float32Array))
    expect((vi.mocked(api.liveFeed).mock.calls[0][1] as Float32Array).length).toBe(3000)
    expect(out).toEqual(['Hola mundo'])
  })

  it('no solapa peticiones: lo que llega mientras tanto va junto en la siguiente', async () => {
    let release!: () => void
    const api = fakeApi({ liveFeed: vi.fn(() => new Promise<{ text: string }>((r) => { release = () => r({ text: 'a' }) })) })
    const lt = (await LiveTranscriber.create('es', () => undefined, api))!
    lt.feed(chunk()); await flush()
    lt.feed(chunk()); lt.feed(chunk()); await flush()
    expect(api.liveFeed).toHaveBeenCalledTimes(1)
    release(); await flush()
    expect(api.liveFeed).toHaveBeenCalledTimes(2)
    expect((vi.mocked(api.liveFeed).mock.calls[1][1] as Float32Array).length).toBe(5120)
  })

  it('tras reiniciar ignora la respuesta de la frase anterior', async () => {
    let release!: () => void
    const api = fakeApi({ liveFeed: vi.fn(() => new Promise<{ text: string }>((r) => { release = () => r({ text: 'vieja' }) })) })
    const out: string[] = []
    const lt = (await LiveTranscriber.create('es', (t) => out.push(t), api))!
    lt.feed(chunk()); await flush()
    lt.reset()
    release(); await flush()
    expect(out).toEqual([''])
    expect(api.liveReset).toHaveBeenCalledWith(7)
  })

  it('al terminar cierra la sesión y no manda más audio', async () => {
    const api = fakeApi()
    const lt = (await LiveTranscriber.create('es', () => undefined, api))!
    lt.stop(); lt.feed(chunk()); await flush()
    expect(api.liveFeed).not.toHaveBeenCalled()
    expect(api.liveStop).toHaveBeenCalledWith(7)
  })
})
