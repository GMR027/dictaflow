// Cola de frases de una reunión. En el teléfono Whisper puede tardar más que lo que dura cada frase:
// en vez de acumular atraso sin fin (y memoria), las frases pendientes de la misma fuente se juntan
// en bloques de hasta `maxSec` segundos, que se transcriben de una vez (menos llamadas, mismo texto).

import { SAMPLE_RATE } from './audio'

export interface Pending {
  pcm: Float32Array
  /** Segundo de inicio en la línea de tiempo común de la reunión. */
  start: number
  speaker?: string
}

/** Silencio corto entre frases juntadas, para que Whisper no pegue las palabras. */
const GAP = Math.round(SAMPLE_RATE * 0.3)

/**
 * Saca el siguiente bloque a transcribir. Si hay más de `keep` frases esperando, junta la primera con
 * las siguientes del mismo hablante mientras quepan en `maxSec`.
 */
export function takeNext(queue: Pending[], keep = 2, maxSec = 25): Pending | undefined {
  const first = queue.shift()
  if (!first || queue.length < keep) return first
  const parts = [first.pcm]
  let len = first.pcm.length
  while (queue.length && queue[0].speaker === first.speaker && len + GAP + queue[0].pcm.length <= maxSec * SAMPLE_RATE) {
    const next = queue.shift()!
    parts.push(new Float32Array(GAP), next.pcm)
    len += GAP + next.pcm.length
  }
  if (parts.length === 1) return first
  const pcm = new Float32Array(len)
  let o = 0
  for (const p of parts) { pcm.set(p, o); o += p.length }
  return { pcm, start: first.start, speaker: first.speaker }
}

/** Reintenta una vez: un fallo puntual (memoria, modelo recargándose) no debe perder la frase. */
export async function withRetry<T>(fn: () => Promise<T>, wait = 800): Promise<T> {
  try {
    return await fn()
  } catch {
    await new Promise((r) => setTimeout(r, wait))
    return fn()
  }
}
