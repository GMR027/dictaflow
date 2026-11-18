// Compartido por Android (Rust) y escritorio (whisper.cpp y nube).
/**
 * Texto de arranque de Whisper: una frase de ejemplo con la puntuación del idioma (así Whisper
 * pone comas, signos de interrogación y mayúsculas) y los términos del diccionario personal (así
 * escribe los nombres propios como el usuario).
 */
export function whisperPrompt(lang: string, terms: string[]): string {
  const base = lang === 'en'
    ? 'Hello, how are you? Fine, thanks. We will meet at 10:30 to review the report.'
    : 'Hola, ¿qué tal? Bien, gracias. Nos vemos a las 10:30 para revisar el informe.'
  const words = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 40)
  return (words.length ? `${base} ${words.join(', ')}.` : base).slice(0, 600)
}
