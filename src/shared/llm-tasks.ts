// Tareas de IA (redactar, traducir, resumir, acta…) independientes del modelo que las ejecuta.
//
// Escritorio (src/main/llm.ts) y Android (src/renderer/src/platform/tauri.ts) usan los mismos
// prompts; cada plataforma solo aporta `complete` (cómo se habla con el modelo) y los límites de
// tamaño de su modelo.
import { TRANS_LANGS, type ChatMsg, type DictEntry, type Lang, type MeetingMinutes, type RewriteRequest, type Tone, type TransLang } from './types'
import { numbersPreserved } from './guard'
import { extractJson } from './json'

export type Complete = (system: string, msgs: ChatMsg[], temperature?: number) => Promise<string>

export interface LlmLimits {
  /** Tamaño máximo (caracteres) que se envía de una vez al modelo al procesar por partes. */
  chunkChars: number
  /** A partir de este tamaño el texto se parte y se une. */
  maxChars: number
  /** Lo que se toma de una transcripción para el acta estructurada. */
  minutesChars: number
}

/** Modelos de escritorio (Ollama, Anthropic…): contexto amplio. */
export const DESKTOP_LIMITS: LlmLimits = { chunkChars: 12_000, maxChars: 60_000, minutesChars: 40_000 }

export interface LlmDeps {
  complete: Complete
  /** Ajustes que influyen en los prompts; se leen en cada llamada. */
  settings: () => { dictionary: DictEntry[]; guardNumbers: boolean } | Promise<{ dictionary: DictEntry[]; guardNumbers: boolean }>
  limits?: LlmLimits
}

export type ContentAction = 'summary' | 'chapters' | 'post' | 'notes' | 'meeting' | 'study'

const TONES: Record<Tone, string> = {
  neutral: 'tono neutro y claro',
  formal: 'tono formal y profesional',
  casual: 'tono cercano y natural',
  concise: 'lo más conciso posible sin perder información'
}

const TARGETS: Record<string, string> = {
  generic: 'cualquier asistente de IA para programación',
  'claude-code': 'Claude Code (agente en terminal con acceso al repositorio): indica archivos concretos a leer/modificar, pide que verifique con tests o el build y que explique brevemente qué cambió',
  opencode: 'opencode (agente en terminal): instrucciones concretas por pasos, rutas de archivos y criterio de finalización verificable',
  cursor: 'Cursor (editor con IA): referencia archivos con @ruta cuando sea posible y acota el cambio a lo mínimo necesario',
  chatgpt: 'ChatGPT (chat sin acceso al repositorio): incluye todo el contexto necesario dentro del propio prompt'
}

const LANG_NAME = { es: 'español', en: 'inglés' } as const

const ACTIONS: Record<ContentAction, string> = {
  summary: 'Resume el texto en un párrafo claro y 5 viñetas con las ideas clave.',
  chapters: 'Divide el contenido en capítulos con título descriptivo. Si hay marcas de tiempo [mm:ss], úsalas: formato "mm:ss Título".',
  post: 'Escribe una publicación para redes sociales (tono atractivo, máximo 150 palabras) y 3 citas destacadas textuales.',
  notes: 'Convierte el texto en notas estructuradas en Markdown con títulos y viñetas.',
  meeting: 'Genera el acta de la reunión en Markdown con estas secciones: Resumen ejecutivo, Decisiones tomadas, Tareas (con responsable si se menciona), Preguntas abiertas.',
  study: 'Crea apuntes de estudio: resumen, glosario de términos clave, 8 flashcards (Pregunta/Respuesta) y 5 preguntas de repaso.'
}

const MINUTOS_PROMPT = `Analiza esta transcripción de una reunión y devuelve SOLO un objeto JSON con estas claves:
{
  "summary": "resumen ejecutivo en un párrafo",
  "topics": ["tema tratado", ...],
  "decisions": ["decisión tomada", ...],
  "agreements": ["acuerdo al que se llegó", ...],
  "tasks": [{ "text": "tarea pendiente", "owner": "responsable si se menciona, si no cadena vacía", "due": "fecha límite si se menciona, si no cadena vacía" }]
}
No inventes nada: si no se habla de decisiones, deja el array vacío. Usa el idioma del texto.`

export function termsLine(dictionary: DictEntry[]): string {
  const terms = dictionary.map((d) => d.to || d.from).filter(Boolean)
  return terms.length ? `Respeta exactamente la escritura de estos términos: ${terms.join(', ')}.` : ''
}

export function systemPrompt(req: RewriteRequest, terms: string): string {
  const lang = req.lang === 'es' ? 'español' : 'inglés'
  if (req.mode === 'prompt') {
    return [
      `Convierte el texto dictado por el usuario en un prompt de programación bien estructurado, escrito en ${lang}.`,
      `El prompt será usado en: ${TARGETS[req.target ?? 'generic']}.`,
      'Estructura con estas secciones en Markdown, omitiendo las que no apliquen: Objetivo, Contexto, Requisitos, Restricciones, Criterios de aceptación.',
      req.projectContext ? 'Usa el contexto del proyecto para mencionar rutas y tecnologías reales, pero SOLO las que aparezcan en él.' : '',
      'No inventes detalles que el usuario no dijo. Conserva nombres técnicos tal cual. Responde SOLO con el prompt, sin explicaciones.',
      terms
    ].filter(Boolean).join('\n')
  }
  if (req.mode === 'changes') {
    return [
      `Convierte el texto dictado en instrucciones de cambio para un asistente de IA que trabaja sobre un proyecto existente, escritas en ${lang}.`,
      `El asistente es: ${TARGETS[req.target ?? 'generic']}.`,
      'Es una petición de modificación, no un encargo nuevo: no incluyas Objetivo, Contexto ni Criterios de aceptación.',
      'Redacta una lista numerada de cambios concretos y accionables, cada uno en imperativo, indicando dónde aplicarlo (archivo, componente, pantalla o ajuste) solo si el usuario lo mencionó o aparece en el contexto.',
      'Si algo debe quedar igual, añade al final una línea «No cambiar:» con ello.',
      req.projectContext ? 'Usa el contexto del proyecto para nombrar rutas y tecnologías reales, pero SOLO las que aparezcan en él.' : '',
      'No inventes cambios que el usuario no pidió. Conserva nombres técnicos tal cual. Responde SOLO con las instrucciones, sin explicaciones.',
      terms
    ].filter(Boolean).join('\n')
  }
  return [
    `Reescribe el texto dictado en ${lang} con mejor redacción: ${TONES[req.tone]}.`,
    'Elimina muletillas y repeticiones, corrige puntuación y gramática, conserva el significado y no añadas información.',
    'Conserva exactamente las cifras, horas, cantidades y nombres propios dichos; no los conviertas ni los cambies.',
    'Responde SOLO con el texto reescrito, sin comillas ni explicaciones.',
    terms
  ].filter(Boolean).join('\n')
}

export function userPrompt(req: RewriteRequest): string {
  const prev = req.previous ? `\n\nVersión anterior (genera una redacción DISTINTA a esta):\n${req.previous}` : ''
  const ctx = req.projectContext ? `Contexto del proyecto:\n${req.projectContext}\n\n` : ''
  return `${ctx}Texto dictado:\n${req.text}${prev}`
}

/** Parte el texto en trozos por párrafos, sin partir un párrafo por la mitad. */
export function splitForChunks(text: string, max: number): string[] {
  const paras = text.split(/\n{2,}/)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) {
      out.push(cur)
      cur = p
    } else {
      cur = cur ? `${cur}\n\n${p}` : p
    }
  }
  if (cur.trim()) out.push(cur)
  return out.length ? out : [text]
}

/** Convierte la respuesta JSON del modelo en un acta; null si no es un JSON válido. */
export function parseMinutes(out: string): MeetingMinutes | null {
  const j = extractJson<Partial<MeetingMinutes>>(out)
  if (!j) return null
  const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [])
  return {
    summary: String(j.summary ?? '').trim(),
    topics: lista(j.topics),
    decisions: lista(j.decisions),
    agreements: lista(j.agreements),
    tasks: (Array.isArray(j.tasks) ? j.tasks : []).map((t) => ({
      text: String((t as { text?: unknown })?.text ?? '').trim(),
      owner: String((t as { owner?: unknown })?.owner ?? '').trim(),
      due: String((t as { due?: unknown })?.due ?? '').trim(),
      done: false
    })).filter((t) => t.text)
  }
}

export function createLlmTasks({ complete, settings, limits = DESKTOP_LIMITS }: LlmDeps) {
  const terms = async (): Promise<string> => termsLine((await settings()).dictionary)

  async function rewrite(req: RewriteRequest): Promise<string> {
    return complete(systemPrompt(req, await terms()), [{ role: 'user', content: userPrompt(req) }], req.previous ? 0.9 : 0.4)
  }

  /**
   * Redacción con protección de cifras: si el modelo cambia horas, cantidades o números, se reintenta una vez
   * con temperatura baja y, si persiste, se conserva el texto dictado (`reverted`) en vez de entregar datos alterados.
   */
  async function rewriteGuarded(req: RewriteRequest): Promise<{ text: string; reverted: boolean }> {
    const out = await rewrite(req)
    if (req.mode !== 'rewrite' || !(await settings()).guardNumbers || numbersPreserved(req.text, out)) return { text: out, reverted: false }
    const retry = await complete(systemPrompt(req, await terms()) + '\nIMPORTANTE: tu respuesta anterior alteró cifras. Copia las cifras y horas tal como las dijo el usuario.', [{ role: 'user', content: userPrompt(req) }], 0.1)
    return numbersPreserved(req.text, retry) ? { text: retry, reverted: false } : { text: req.text.trim(), reverted: true }
  }

  async function translate(text: string, to: TransLang): Promise<string> {
    return complete(
      `Traduce al ${TRANS_LANGS[to].llm}. Responde SOLO con la traducción, sin comentarios. ${await terms()}`,
      [{ role: 'user', content: text }], 0.2
    )
  }

  /**
   * Genera el contenido pedido. Si el texto es largo, se procesa por partes y se
   * unen: antes se cortaba en silencio y el acta salía incompleta sin ningún aviso.
   */
  async function generate(action: ContentAction, text: string, lang: Lang): Promise<string> {
    const full = text.trim()
    const t = await terms()
    if (full.length <= limits.maxChars) {
      return complete(
        `${ACTIONS[action]} Escribe en ${LANG_NAME[lang]}. Usa solo información presente en el texto; no inventes. ${t}`,
        [{ role: 'user', content: full }], 0.3
      )
    }

    const chunks = splitForChunks(full, limits.chunkChars)
    const partes: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      partes.push(await complete(
        `${ACTIONS[action]} Escribe en ${LANG_NAME[lang]}. Usa solo información presente en el texto; no inventes. ${t}\nEsta es la parte ${i + 1} de ${chunks.length}: no repitas lo de otras partes.`,
        [{ role: 'user', content: chunks[i] }], 0.3
      ))
    }
    // Los capítulos se concatenan; lo demás se une en un solo texto.
    if (action === 'chapters') return partes.join('\n\n')
    try {
      return await complete(
        `Une estas partes en un solo texto en ${LANG_NAME[lang]}, con las mismas secciones y sin repetir contenido. No inventes nada que no esté en las partes. ${t}`,
        [{ role: 'user', content: partes.map((p, i) => `--- Parte ${i + 1} ---\n${p}`).join('\n\n') }], 0.3
      )
    } catch {
      // Si la unión falla, al menos se entrega todo el material.
      return partes.join('\n\n')
    }
  }

  /**
   * Genera el acta estructurada de una reunión. Devuelve null si el modelo no
   * responde con un JSON válido, para que la interfaz pueda avisar en vez de
   * inventar un acta.
   */
  async function generateMinutes(text: string, _lang: Lang): Promise<MeetingMinutes | null> {
    const out = await complete(
      `${MINUTOS_PROMPT}\n${await terms()}`,
      [{ role: 'user', content: `Transcripción:\n${text.slice(0, limits.minutesChars)}` }],
      0.2
    )
    return parseMinutes(out)
  }

  function testLLM(): Promise<string> {
    return rewrite({ text: 'hola esto es una prueba eh de conexión', lang: 'es', tone: 'neutral', mode: 'rewrite' })
  }

  return { rewrite, rewriteGuarded, translate, generate, generateMinutes, testLLM }
}
