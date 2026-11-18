// Comandos de voz del dictado.
//
// Una frase dictada puede ser:
//   • solo un comando («redacta», «Flow, copia»): se ejecuta y no se escribe;
//   • texto + «Flow» + comando al final («…y eso es todo. Flow, redacta»): se escribe el texto y
//     luego se ejecuta el comando. El «Flow» evita que una frase normal que acaba en «copia» o
//     «más corto» dispare algo sin querer;
//   • texto con comandos de formato en medio («…gracias punto y aparte Saludos»): se convierten en
//     saltos de línea sin necesidad de «Flow».
// En el modo «parlante controlado» todo lo dictado hasta pulsar Detener es una sola frase, así que
// sin los dos últimos casos los comandos casi nunca coincidían.

export type CommandId =
  | 'clear' | 'paragraph' | 'newline' | 'copy' | 'redo' | 'rewrite' | 'formal' | 'concise' | 'casual'
  | 'prompt' | 'changes' | 'savePrompt' | 'pause'

export interface CommandSpec {
  id: CommandId
  /** Frase normalizada completa (sin tildes, minúsculas, sin puntuación). */
  re: RegExp
  label: string
  /** Lo que se dice, para la ayuda. */
  say: string
}

export const COMMAND_SPECS: CommandSpec[] = [
  { id: 'paragraph', re: /^(nuevo parrafo|punto y aparte)$/, label: 'Nuevo párrafo', say: '«nuevo párrafo» o «punto y aparte»' },
  { id: 'newline', re: /^(nueva linea|salto de linea)$/, label: 'Nueva línea', say: '«nueva línea» o «salto de línea»' },
  { id: 'clear', re: /^(borra|borrar|elimina|eliminar) (eso|todo)$/, label: 'Borrado', say: '«borra todo»' },
  { id: 'copy', re: /^(copia|copiar|copia eso|copialo)$/, label: 'Copiado', say: '«copia»' },
  { id: 'rewrite', re: /^(redacta|redactar|redactalo)$/, label: 'Redactando', say: '«redacta»' },
  { id: 'redo', re: /^(rehaz|rehacer|rehazlo|otra version)$/, label: 'Rehaciendo', say: '«rehaz» u «otra versión»' },
  { id: 'formal', re: /^(hazlo mas formal|mas formal)$/, label: 'Tono formal', say: '«más formal»' },
  { id: 'concise', re: /^(hazlo mas corto|mas corto|mas conciso|hazlo mas conciso)$/, label: 'Tono conciso', say: '«más corto»' },
  { id: 'casual', re: /^(hazlo mas casual|mas casual|mas cercano|hazlo mas cercano)$/, label: 'Tono cercano', say: '«más cercano»' },
  { id: 'prompt', re: /^(convierte(lo)? en prompt|hazlo prompt|a prompt)$/, label: 'Convirtiendo en prompt', say: '«conviértelo en prompt»' },
  { id: 'changes', re: /^(instrucciones de cambio|convierte(lo)? en cambios|hazlo cambios|a cambios)$/, label: 'Instrucciones de cambio', say: '«instrucciones de cambio»' },
  { id: 'savePrompt', re: /^(guarda (este|el) prompt|guardar prompt)$/, label: 'Prompt guardado', say: '«guarda este prompt»' },
  { id: 'pause', re: /^(pausa|deja de escuchar|detener|para de escuchar)$/, label: 'Micrófono detenido', say: '«pausa» o «deja de escuchar»' }
]

const WAKE = /^(oye )?flow$/

/** Minúsculas, sin tildes ni puntuación, espacios simples. */
export const norm = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Quita «Flow» / «oye Flow» del principio. */
const stripWake = (n: string): string => n.replace(/^(oye )?flow /, '')

export interface CommandMatch {
  spec: CommandSpec
  /** Texto dictado antes del comando (ya con los saltos de formato aplicados); vacío si solo era el comando. */
  rest: string
}

/** Comando de una frase dictada, o null si es texto normal. */
export function matchCommand(text: string, specs: CommandSpec[] = COMMAND_SPECS): CommandMatch | null {
  const n = stripWake(norm(text))
  const whole = specs.find((c) => c.re.test(n))
  if (whole) return { spec: whole, rest: '' }

  // «… Flow, <comando>» al final: se busca el último «flow» y se prueba lo que le sigue.
  const words = text.trim().split(/\s+/)
  for (let i = words.length - 1; i > 0; i--) {
    const w = norm(words[i])
    const prev = i > 1 ? norm(words[i - 1]) : ''
    if (w !== 'flow') continue
    const tail = norm(words.slice(i + 1).join(' '))
    const spec = specs.find((c) => c.re.test(tail))
    if (!spec) return null
    const cut = WAKE.test(`${prev} ${w}`) ? i - 1 : i
    const rest = words.slice(0, cut).join(' ').replace(/[\s,;:]+$/, '')
    return { spec, rest: applyFormatting(rest) }
  }
  return null
}

// Comandos de formato dentro del texto. «nueva línea» suelta es muy común en frases normales
// («una nueva línea de productos»), así que dentro del texto solo valen las formas inequívocas.
const INLINE: [RegExp, string][] = [
  [/[\s,;:]*\b(punto y aparte|nuevo p[aá]rrafo)\b[.,;:]?\s*/giu, '\n\n'],
  [/[\s,;:]*\bsalto de l[ií]nea\b[.,;:]?\s*/giu, '\n']
]

/** Convierte «punto y aparte», «nuevo párrafo» y «salto de línea» dentro del texto en saltos. */
export function applyFormatting(text: string): string {
  let t = text
  for (const [re, by] of INLINE) t = t.replace(re, (_m, _w, off: number) => (off === 0 ? '' : by))
  // Tras un salto, la frase empieza con mayúscula.
  return t.replace(/\n([a-záéíóúñü])/g, (_m, c: string) => `\n${c.toUpperCase()}`).replace(/^\s+/, '').replace(/[ \t]+$/, '')
}
