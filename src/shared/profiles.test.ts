import { describe, expect, it } from 'vitest'
import { classify, PROFILES, SLOW_MS } from './profiles'
import type { HardwareInfo } from './types'

const hw = (o: Partial<HardwareInfo> = {}): HardwareInfo => ({
  cpu: 'x', cores: 12, cpuFlags: { avx: true, avx2: true, avx512: false }, arch: 'x64', ramGB: 30, gpu: 'AMD Radeon RX 6600', gpuVendor: 'amd',
  diskFreeGB: 100, ollama: { installed: true, running: true, models: [] }, clis: { claude: false, opencode: false }, ...o
})

describe('classify', () => {
  it('equipo de referencia (Ryzen 5 8600G + RX 6600, 30 GB): acelerado', () => {
    expect(classify(hw()).profile).toBe('accelerated')
  })
  it('iMac 2011 (4 GB, AVX sin AVX2, Intel integrada): ligero y explica por qué', () => {
    const c = classify(hw({ cores: 4, ramGB: 4, cpuFlags: { avx: true, avx2: false, avx512: false }, gpu: 'Intel', gpuVendor: 'intel' }))
    expect(c.profile).toBe('light')
    expect(c.reasons.join(' ')).toMatch(/RAM baja/)
    expect(c.reasons.join(' ')).toMatch(/AVX2/)
  })
  it('sin GPU pero con CPU y RAM suficientes: equilibrado', () => {
    expect(classify(hw({ gpuVendor: 'none', gpu: 'No detectada', ramGB: 16 })).profile).toBe('balanced')
  })
  it('GPU pero poca RAM no es acelerado', () => {
    expect(classify(hw({ ramGB: 8 })).profile).toBe('balanced')
  })
  it('la prueba medida manda sobre el hardware nominal', () => {
    expect(classify(hw(), { model: 'm', ms: SLOW_MS - 1 }).profile).toBe('accelerated')
    const slow = classify(hw(), { model: 'm', ms: SLOW_MS + 1 })
    expect(slow.profile).toBe('light')
    expect(slow.reasons.join(' ')).toMatch(/prueba de voz/)
  })
  it('en ARM no exige AVX2', () => {
    expect(classify(hw({ arch: 'arm64', cpuFlags: { avx: false, avx2: false, avx512: false } })).profile).not.toBe('light')
  })
})

describe('PROFILES', () => {
  it('el perfil ligero no activa borradores ni redacción automática', () => {
    expect(PROFILES.light.settings.draftsEnabled).toBe(false)
    expect(PROFILES.light.settings.autoRewrite).toBe(false)
  })
  it('todos usan un modelo Whisper de los soportados', () => {
    for (const p of Object.values(PROFILES)) expect(p.settings.sttModel).toMatch(/^Xenova\/whisper-(tiny|base|small|medium)$/)
  })
})
