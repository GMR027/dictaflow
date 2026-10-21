import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackup, restoreFromBuffer } from './backup'

let dir: string
let base: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dfbackup-'))
  base = join(dir, 'data')
  mkdirSync(join(base, 'library'), { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('copia de seguridad', () => {
  it('guarda y restaura los datos', async () => {
    writeFileSync(join(base, 'settings.json'), JSON.stringify({ version: 2, data: { primaryLang: 'en' } }))
    writeFileSync(join(base, 'library', 'abc.json'), JSON.stringify({ id: 'abc', title: 'Mi libro' }))

    const info = await createBackup(join(dir, 'copia.zip'), base)
    expect(info.contents).toContain('settings.json')
    expect(info.contents).toContain('library/abc.json')
    expect(existsSync(join(dir, 'copia.zip'))).toBe(true)

    // Se borra todo y se restaura.
    rmSync(join(base, 'settings.json'))
    rmSync(join(base, 'library', 'abc.json'))
    const r = await restoreFromBuffer(readFileSync(join(dir, 'copia.zip')), base)
    expect(r.restored).toContain('settings.json')
    expect(r.restored).toContain('library/abc.json')
    expect(JSON.parse(readFileSync(join(base, 'library', 'abc.json'), 'utf8')).title).toBe('Mi libro')
  })

  it('no copia las claves de los servicios en la nube', async () => {
    writeFileSync(join(base, 'settings.json'), '{}')
    writeFileSync(join(base, 'secrets.json'), JSON.stringify({ anthropic: 'clave-cifrada' }))
    const info = await createBackup(join(dir, 'copia.zip'), base)
    expect(info.contents).not.toContain('secrets.json')
    expect(info.contents).toContain('settings.json')
  })

  it('al restaurar, ignora un fichero de claves aunque venga en el ZIP', async () => {
    // Una copia hecha por otra versión (o a mano) podría traer las claves.
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('settings.json', '{}')
    zip.file('secrets.json', JSON.stringify({ anthropic: 'clave-cifrada' }))
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const r = await restoreFromBuffer(buf, base)
    expect(r.restored).toContain('settings.json')
    expect(r.skipped).toContain('secrets.json')
    expect(existsSync(join(base, 'secrets.json'))).toBe(false)
  })

  it('no incluye los trabajos en curso', async () => {
    writeFileSync(join(base, 'jobs.json'), '[]')
    const info = await createBackup(join(dir, 'copia.zip'), base)
    expect(info.contents).not.toContain('jobs.json')
  })

  it('una copia vacía no falla', async () => {
    const info = await createBackup(join(dir, 'vacia.zip'), base)
    expect(info.contents).toEqual([])
  })
})
