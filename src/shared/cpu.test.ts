import { describe, expect, it } from 'vitest'
import { parseCpuFlags } from './cpu'

describe('parseCpuFlags', () => {
  it('detecta AVX2 y AVX-512', () => {
    expect(parseCpuFlags('processor : 0\nflags\t\t: fpu sse4_2 avx avx2 avx512f avx512bw')).toEqual({ avx: true, avx2: true, avx512: true })
  })
  it('CPU tipo Sandy Bridge (iMac 2011): AVX pero no AVX2', () => {
    expect(parseCpuFlags('flags : fpu sse4_1 sse4_2 popcnt aes xsave avx lahf_lm')).toEqual({ avx: true, avx2: false, avx512: false })
  })
  it('ARM (línea Features) y entradas vacías', () => {
    expect(parseCpuFlags('Features : fp asimd evtstrm')).toEqual({ avx: false, avx2: false, avx512: false })
    expect(parseCpuFlags('')).toEqual({ avx: false, avx2: false, avx512: false })
  })
})
