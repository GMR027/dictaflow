/**
 * Latencias medidas en la app (ms), accesibles desde la consola: `__dictaflowMetrics()`.
 *
 * Se miden por separado las etapas, para saber dónde se va el tiempo:
 *   capture_ms  de que termina la frase a que se cierra el segmento (VAD)
 *   stt_wait_ms espera en cola del motor de voz
 *   stt_ms      inferencia de voz
 *   stt_total_ms de que se cierra la frase a que aparece el texto
 *   rewrite_ms  redacción con IA
 *   rewrite_wait_ms espera a que la redacción termine
 */
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

/** Borra las mediciones para empezar de cero. */
export function reset(): void {
  for (const k of Object.keys(samples)) delete samples[k]
}

/** Nombres y explicación de cada etapa, para el panel de diagnóstico. */
export const STAGES: { key: string; label: string; note: string }[] = [
  { key: 'silence_ms', label: 'Espera de silencio', note: 'Silencio que hay que oír para dar la frase por terminada.' },
  { key: 'stt_ms', label: 'Inferencia de voz', note: 'Lo que tarda Whisper en transcribir (sin esperas).' },
  { key: 'stt_total_ms', label: 'Total hasta el texto', note: 'Desde que se cierra la frase hasta que aparece el texto.' },
  { key: 'draft_ms', label: 'Borrador provisional', note: 'Cada reescritura del texto provisional.' },
  { key: 'rewrite_ms', label: 'Redacción con IA', note: 'Lo que tarda el modelo en redactar.' },
  { key: 'rewrite_wait_ms', label: 'Espera antes de redactar', note: 'Configurada en Ajustes → Rendimiento.' }
]

;(globalThis as Record<string, unknown>).__dictaflowMetrics = summary
