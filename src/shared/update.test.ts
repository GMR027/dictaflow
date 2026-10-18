import { describe, expect, it } from 'vitest'
import { ASSET_BY_KIND, isNewer, sha256For } from './update'

describe('isNewer', () => {
  it('compara versiones numéricamente', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('v0.10.0', '0.9.5')).toBe(true)
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
  })
  it('no avisa con la misma versión o una anterior', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
  })
  it('tolera longitudes distintas', () => {
    expect(isNewer('1.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.1', '1.0')).toBe(true)
  })
})

describe('sha256For', () => {
  const h = 'a'.repeat(64)
  const g = 'b'.repeat(64)
  const sums = `${h}  dictaflow-linux-amd64.deb\n${g} *dictaflow-linux-x86_64.AppImage\n`
  it('encuentra el hash de un archivo', () => {
    expect(sha256For(sums, 'dictaflow-linux-amd64.deb')).toBe(h)
    expect(sha256For(sums, 'dictaflow-linux-x86_64.AppImage')).toBe(g)
  })
  it('devuelve null si no está', () => {
    expect(sha256For(sums, 'otro.deb')).toBeNull()
  })
})

describe('ASSET_BY_KIND', () => {
  it('portable y dev se actualizan a mano', () => {
    expect(ASSET_BY_KIND.portable).toBeUndefined()
    expect(ASSET_BY_KIND.dev).toBeUndefined()
  })
})
