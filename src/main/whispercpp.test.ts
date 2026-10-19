import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { CppServer, findServerBinary, parseInference, serverArgs } from './whispercpp'

const dir = mkdtempSync(join(tmpdir(), 'dfcpp-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Servidor falso con la misma interfaz que whisper-server: GET / y POST /inference (multipart). */
function fakeServer(name: string, behaviour = ''): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env node
const http = require('http')
const a = process.argv, port = +a[a.indexOf('--port') + 1], model = a[a.indexOf('-m') + 1]
${behaviour}
http.createServer((req, res) => {
  if (req.method === 'GET') return res.end('<html>ok</html>')
  let n = 0; let body = ''
  req.on('data', (c) => { n += c.length; body += c.toString('latin1') })
  req.on('end', () => {
    const verbose = body.includes('verbose_json')
    const lang = /name="language"\\r\\n\\r\\n(\\w+)/.exec(body)?.[1]
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(verbose
      ? { text: ' hola mundo\\n', segments: [{ start: 0, end: 1.5, text: ' hola mundo' }], bytes: n, lang, model }
      : { text: ' hola mundo\\n', bytes: n, lang, model }))
  })
}).listen(port, '127.0.0.1')
`)
  chmodSync(p, 0o755)
  return p
}
const model = join(dir, 'ggml-test.bin')
writeFileSync(model, 'x')

let server: CppServer | undefined
afterEach(() => { server?.stop(); server = undefined })

describe('findServerBinary', () => {
  it('usa la ruta configurada si es ejecutable y vacío si no existe', () => {
    const bin = fakeServer('whisper-server')
    expect(findServerBinary(bin)).toBe(bin)
    expect(findServerBinary(join(dir, 'no-existe'))).toBe('')
  })
  it('lo busca en PATH cuando no hay ruta', () => {
    const bin = fakeServer('whisper-server')
    expect(findServerBinary('', `/nada:${dir}`)).toBe(bin)
    expect(findServerBinary('', '/nada')).toBe('')
  })
})

describe('serverArgs / parseInference', () => {
  it('solo escucha en local y pasa modelo y puerto', () => {
    const a = serverArgs('/m.bin', 1234, 6)
    expect(a).toEqual(['-m', '/m.bin', '--host', '127.0.0.1', '--port', '1234', '-t', '6'])
  })
  it('normaliza espacios y segmentos', () => {
    expect(parseInference({ text: ' hola \n mundo ' }).text).toBe('hola mundo')
    expect(parseInference({ segments: [{ start: 0, end: 1, text: ' a ' }, { start: 1, end: 2, text: 'b' }] }).text).toBe('a b')
  })
  it('propaga el error del servidor', () => {
    expect(() => parseInference({ error: 'boom' })).toThrow(/boom/)
  })
})

describe('CppServer', () => {
  it('arranca, transcribe con y sin marcas de tiempo y se detiene', async () => {
    server = new CppServer()
    await server.ensure(fakeServer('ok1'), model)
    expect(server.running).toBe(true)
    const r = await server.infer(new Float32Array(16000), 'es', false)
    expect(r.text).toBe('hola mundo')
    expect(r.segments).toEqual([])
    const t = await server.infer(new Float32Array(16000), undefined, true)
    expect(t.segments).toEqual([{ start: 0, end: 1.5, text: 'hola mundo' }])
    server.stop()
    expect(server.running).toBe(false)
    await expect(server.infer(new Float32Array(10), 'es', false)).rejects.toThrow(/no está en marcha/)
  })
  it('reutiliza el proceso si no cambia nada y lo reinicia si cambia el modelo', async () => {
    server = new CppServer()
    const bin = fakeServer('ok2')
    await server.ensure(bin, model)
    const first = (await server.infer(new Float32Array(100), 'es', false)) as unknown as { text: string }
    await server.ensure(bin, model)
    expect(first.text).toBe('hola mundo')
    const model2 = join(dir, 'ggml-otro.bin')
    writeFileSync(model2, 'y')
    await server.ensure(bin, model2)
    expect(server.running).toBe(true)
  })
  it('falla con mensaje claro si falta el binario o el modelo', async () => {
    server = new CppServer()
    await expect(server.ensure('', model)).rejects.toThrow(/No se encontró whisper-server/)
    await expect(server.ensure(fakeServer('ok3'), join(dir, 'nada.bin'))).rejects.toThrow(/Falta el modelo ggml/)
    expect(server.running).toBe(false)
  })
  it('detecta un servidor que se cierra al arrancar (p. ej. sin memoria)', async () => {
    server = new CppServer()
    const bad = fakeServer('crash', "console.error('ggml: failed to allocate buffer'); process.exit(3)")
    await expect(server.ensure(bad, model, 5000)).rejects.toThrow(/código 3.*failed to allocate/)
    expect(server.running).toBe(false)
  })
  it('detecta un servidor que nunca responde', async () => {
    server = new CppServer()
    const hang = fakeServer('hang', 'setInterval(() => {}, 1000); return')
    await expect(server.ensure(hang, model, 800)).rejects.toThrow(/no respondió a tiempo/)
    expect(server.running).toBe(false)
  })
})
