/**
 * Saca el objeto JSON de una respuesta de un modelo de lenguaje.
 *
 * Los modelos a veces lo envuelven en un bloque de código o añaden texto antes
 * y después. Se busca el primer objeto JSON completo, respetando las cadenas
 * y los escapes.
 */
export function extractJson<T>(text: string): T | null {
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const inicio = limpio.indexOf('{')
  if (inicio < 0) return null
  let nivel = 0
  let comillas = false
  let escapado = false
  for (let i = inicio; i < limpio.length; i++) {
    const c = limpio[i]
    if (escapado) { escapado = false; continue }
    if (c === '\\') { escapado = true; continue }
    if (c === '"') { comillas = !comillas; continue }
    if (comillas) continue
    if (c === '{') nivel++
    else if (c === '}') {
      nivel--
      if (nivel === 0) {
        try {
          return JSON.parse(limpio.slice(inicio, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
