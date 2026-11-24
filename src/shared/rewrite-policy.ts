// ¿Merece la pena pasar una frase por el LLM? El dictado limpio no: la transcripción ya trae
// puntuación (Whisper y el motor del teléfono) y llamar al modelo solo añade segundos de espera.
//
// La política `smart` de Android usa esta función. Escritorio mantiene `always` por defecto.
import type { Tone } from './types'

/** Muletillas que un dictado real suele arrastrar. «este» y «bueno» se excluyen: también son palabras normales. */
const FILLERS = /(?:^|[^\p{L}])(?:eh|em|mmm+|o sea|digamos)(?:[^\p{L}]|$)/iu
/** Palabra repetida consecutiva: «que que», «la la». */
const REPEATED = /(?:^|[^\p{L}])(\p{L}+)\s+\1(?:[^\p{L}]|$)/iu
/** Fin de frase: si no hay ninguno, el texto probablemente llegó sin puntuar. */
const SENTENCE_END = /[.!?…]/u

/** Frases largas: el LLM puede aportar estructura y quitar repeticiones. */
const LONG_CHARS = 180

/**
 * true si la frase se beneficia de una redacción con IA.
 * Con tono distinto de `neutral` siempre se redacta: el usuario lo pidió.
 */
export function needsRewrite(text: string, tone: Tone = 'neutral'): boolean {
  const t = text.trim()
  if (!t) return false
  if (tone !== 'neutral') return true
  if (t.length > LONG_CHARS) return true
  if (FILLERS.test(t)) return true
  if (REPEATED.test(t)) return true
  if (!SENTENCE_END.test(t)) return true
  return false
}
