import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadFile, DownloadError, fileSha256, type FetchLike } from './download'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dfdl-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Servidor falso: devuelve el contenido y su longitud. */
const fake = (content: string, status = 200): FetchLike => async () =>
  new Response(content, { status, headers: { 'content-length': String(Buffer.byteLength(content)) } })

describe('downloadFile', () => {
  it('descarga y deja el fichero en su sitio', async () => {
    const dest = join(dir, 'modelo.bin')
    const r = await downloadFile({ purpose: 'test', url: 'https://x/modelo.bin', dest }, fake('hola mundo'))
    expect(readFileSync(dest, 'utf8')).toBe('hola mundo')
    expect(r.bytes).toBe(10)
    expect(r.cached).toBe(false)
  })

  it('acepta el fichero si el SHA-256 coincide', async () => {
    const dest = join(dir, 'modelo.bin')
    const r = await downloadFile({ purpose: 'test', url: 'https://x/m', dest, sha256: sha('hola mundo') }, fake('hola mundo'))
    expect(r.sha256).toBe(sha('hola mundo'))
    expect(existsSync(dest)).toBe(true)
  })

  it('descarta el fichero si el SHA-256 no coincide y no lo deja instalado', async () => {
    const dest = join(dir, 'modelo.bin')
    await expect(downloadFile({ purpose: 'test', url: 'https://x/m', dest, sha256: sha('otra cosa') }, fake('hola mundo')))
      .rejects.toThrow(/suma de verificación/)
    expect(existsSync(dest)).toBe(false)
    // tampoco debe quedar el fichero temporal
    expect(existsSync(join(dir, '.modelo.bin'))).toBe(false)
  })

  it('descarta el fichero si está incompleto', async () => {
    const dest = join(dir, 'modelo.bin')
    await expect(downloadFile({ purpose: 'test', url: 'https://x/m', dest, size: 999 }, fake('hola mundo')))
      .rejects.toThrow(/incompleto/)
    expect(existsSync(dest)).toBe(false)
  })

  it('no vuelve a descargar un fichero que ya está y es el esperado', async () => {
    const dest = join(dir, 'modelo.bin')
    await downloadFile({ purpose: 'test', url: 'https://x/m', dest, sha256: sha('hola mundo') }, fake('hola mundo'))
    let llamado = false
    const r = await downloadFile({ purpose: 'test', url: 'https://x/m', dest, sha256: sha('hola mundo') }, async () => {
      llamado = true
      return new Response('otra cosa')
    })
    expect(llamado).toBe(false)
    expect(r.cached).toBe(true)
  })

  it('vuelve a descargar si el fichero que había no es el esperado', async () => {
    const dest = join(dir, 'modelo.bin')
    await downloadFile({ purpose: 'test', url: 'https://x/m', dest }, fake('basura'))
    const r = await downloadFile({ purpose: 'test', url: 'https://x/m', dest, sha256: sha('hola mundo') }, fake('hola mundo'))
    expect(r.cached).toBe(false)
    expect(readFileSync(dest, 'utf8')).toBe('hola mundo')
  })

  it('informa del error de red sin dejar restos', async () => {
    const dest = join(dir, 'modelo.bin')
    await expect(downloadFile({ purpose: 'test', url: 'https://x/m', dest }, fake('nada', 404)))
      .rejects.toThrow(DownloadError)
    expect(existsSync(dest)).toBe(false)
  })

  it('avisa del progreso hasta el 100 %', async () => {
    const seen: number[] = []
    await downloadFile({ purpose: 'test', url: 'https://x/m', dest: join(dir, 'm.bin'), onPct: (p) => seen.push(p) }, fake('hola mundo'))
    expect(seen.at(-1)).toBe(100)
  })
})

describe('fileSha256', () => {
  it('calcula el hash de un fichero', async () => {
    const dest = join(dir, 'm.bin')
    await downloadFile({ purpose: 'test', url: 'https://x/m', dest }, fake('hola mundo'))
    expect(fileSha256(dest)).toBe(sha('hola mundo'))
  })
})
