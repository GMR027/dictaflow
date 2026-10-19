import type { HardwareInfo } from './types'

/** Extensiones de CPU relevantes para onnxruntime y whisper.cpp (en Linux, de /proc/cpuinfo). */
export function parseCpuFlags(cpuinfo: string): HardwareInfo['cpuFlags'] {
  const line = cpuinfo.split('\n').find((l) => /^(flags|Features)\s*:/.test(l)) ?? ''
  const flags = new Set(line.split(':')[1]?.trim().split(/\s+/) ?? [])
  return { avx: flags.has('avx'), avx2: flags.has('avx2'), avx512: [...flags].some((f) => f.startsWith('avx512')) }
}
