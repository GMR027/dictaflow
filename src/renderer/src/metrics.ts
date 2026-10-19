/** Latencias medidas en la app (ms), accesibles desde la consola: `__dictaflowMetrics()`. */
const samples: Record<string, number[]> = {}

export function record(name: string, ms: number): void {
  const a = (samples[name] ??= [])
  a.push(ms)
  if (a.length > 500) a.shift()
}

const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y)
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)])
}

export function summary(): Record<string, { n: number; p50: number; p95: number; p99: number }> {
  return Object.fromEntries(Object.entries(samples).map(([k, a]) => [k, { n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99) }]))
}

;(globalThis as Record<string, unknown>).__dictaflowMetrics = summary
