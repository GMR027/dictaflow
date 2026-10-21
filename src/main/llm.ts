import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TRANS_LANGS, type ChatMsg, type LLMConfig, type Lang, type RewriteRequest, type Tone, type TransLang } from '@shared/types'
import { netFetch } from './netlog'
import { numbersPreserved } from '@shared/guard'
import { getSecret, getSettings } from './store'

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

function termsLine(): string {
  const terms = getSettings().dictionary.map((d) => d.to || d.from).filter(Boolean)
  return terms.length ? `Respeta exactamente la escritura de estos términos: ${terms.join(', ')}.` : ''
}

function systemPrompt(req: RewriteRequest): string {
  const lang = req.lang === 'es' ? 'español' : 'inglés'
  if (req.mode === 'prompt') {
    return [
      `Convierte el texto dictado por el usuario en un prompt de programación bien estructurado, escrito en ${lang}.`,
      `El prompt será usado en: ${TARGETS[req.target ?? 'generic']}.`,
      'Estructura con estas secciones en Markdown, omitiendo las que no apliquen: Objetivo, Contexto, Requisitos, Restricciones, Criterios de aceptación.',
      req.projectContext ? 'Usa el contexto del proyecto para mencionar rutas y tecnologías reales, pero SOLO las que aparezcan en él.' : '',
      'No inventes detalles que el usuario no dijo. Conserva nombres técnicos tal cual. Responde SOLO con el prompt, sin explicaciones.',
      termsLine()
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
      termsLine()
    ].filter(Boolean).join('\n')
  }
  return [
    `Reescribe el texto dictado en ${lang} con mejor redacción: ${TONES[req.tone]}.`,
    'Elimina muletillas y repeticiones, corrige puntuación y gramática, conserva el significado y no añadas información.',
    'Conserva exactamente las cifras, horas, cantidades y nombres propios dichos; no los conviertas ni los cambies.',
    'Responde SOLO con el texto reescrito, sin comillas ni explicaciones.',
    termsLine()
  ].filter(Boolean).join('\n')
}

function userPrompt(req: RewriteRequest): string {
  const prev = req.previous ? `\n\nVersión anterior (genera una redacción DISTINTA a esta):\n${req.previous}` : ''
  const ctx = req.projectContext ? `Contexto del proyecto:\n${req.projectContext}\n\n` : ''
  return `${ctx}Texto dictado:\n${req.text}${prev}`
}

function runCli(bin: string, args: string[], input: string | null, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // cwd temporal: los agentes no deben tocar ningún proyecto del usuario
    const child = spawn(bin, args, { cwd: mkdtempSync(join(tmpdir(), 'dictaflow-')), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `${bin} terminó con código ${code}`))
    })
    if (input !== null) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function openAiStyle(cfg: LLMConfig, system: string, msgs: ChatMsg[], key: string): Promise<string> {
  const res = await netFetch(`${cfg.kind}:chat`, `${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, ...msgs] })
  })
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { choices: { message: { content: string } }[] }
  return json.choices[0].message.content.trim()
}

// Por defecto Ollama descarga el modelo a los 5 min: la siguiente frase paga 2-5 s de carga (medido)
const KEEP_ALIVE = '30m'

/** Carga el modelo de Ollama en memoria sin generar nada, para que la primera redacción no pague la carga. */
export async function warmLLM(): Promise<void> {
  const cfg = getSettings().llm
  if (cfg.kind !== 'ollama') return
  await netFetch('ollama:warm', `${cfg.baseUrl ?? 'http://127.0.0.1:11434'}/api/generate`, {
    method: 'POST', body: JSON.stringify({ model: cfg.model, keep_alive: KEEP_ALIVE }), signal: AbortSignal.timeout(60_000)
  })
}

/** Punto único de acceso al modelo configurado: todas las herramientas pasan por aquí. */
export async function complete(system: string, msgs: ChatMsg[], temperature = 0.4): Promise<string> {
  const cfg = getSettings().llm
  const flat = msgs.length === 1 ? msgs[0].content : msgs.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`).join('\n\n')

  switch (cfg.kind) {
    case 'ollama': {
      const res = await netFetch('ollama:chat', `${cfg.baseUrl ?? 'http://127.0.0.1:11434'}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: cfg.model, stream: false, keep_alive: KEEP_ALIVE, options: { temperature, num_ctx: 8192 }, messages: [{ role: 'system', content: system }, ...msgs] })
      })
      if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${await res.text()}`)
      return ((await res.json()) as { message: { content: string } }).message.content.trim()
    }
    case 'anthropic': {
      const key = getSecret('anthropic')
      if (!key) throw new Error('Falta la API key de Anthropic (Ajustes → Cuentas).')
      const res = await netFetch('anthropic:messages', 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: msgs })
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
      const json = (await res.json()) as { content: { type: string; text?: string }[] }
      return json.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    }
    case 'openai-compat':
      return openAiStyle(cfg, system, msgs, getSecret('openai-compat'))
    case 'claude-cli':
      // Usa la sesión/suscripción del CLI instalado; sin herramientas para que solo redacte.
      return runCli('claude', [
        '-p', '--system-prompt', system,
        '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch', 'Glob', 'Grep', 'Task',
        ...(cfg.model ? ['--model', cfg.model] : [])
      ], flat)
    case 'opencode':
      return runCli('opencode', ['run', ...(cfg.model ? ['-m', cfg.model] : []), `${system}\n\n${flat}`], null)
  }
}

export function rewrite(req: RewriteRequest): Promise<string> {
  return complete(systemPrompt(req), [{ role: 'user', content: userPrompt(req) }], req.previous ? 0.9 : 0.4)
}

/**
 * Redacción con protección de cifras: si el modelo cambia horas, cantidades o números, se reintenta una vez
 * con temperatura baja y, si persiste, se conserva el texto dictado (`reverted`) en vez de entregar datos alterados.
 */
export async function rewriteGuarded(req: RewriteRequest): Promise<{ text: string; reverted: boolean }> {
  const out = await rewrite(req)
  if (req.mode !== 'rewrite' || !getSettings().guardNumbers || numbersPreserved(req.text, out)) return { text: out, reverted: false }
  const retry = await complete(systemPrompt(req) + '\nIMPORTANTE: tu respuesta anterior alteró cifras. Copia las cifras y horas tal como las dijo el usuario.', [{ role: 'user', content: userPrompt(req) }], 0.1)
  return numbersPreserved(req.text, retry) ? { text: retry, reverted: false } : { text: req.text.trim(), reverted: true }
}

const LANG_NAME = { es: 'español', en: 'inglés' } as const

export function translate(text: string, to: TransLang): Promise<string> {
  return complete(
    `Traduce al ${TRANS_LANGS[to].llm}. Responde SOLO con la traducción, sin comentarios. ${termsLine()}`,
    [{ role: 'user', content: text }], 0.2
  )
}

export type ContentAction = 'summary' | 'chapters' | 'post' | 'notes' | 'meeting' | 'study'
const ACTIONS: Record<ContentAction, string> = {
  summary: 'Resume el texto en un párrafo claro y 5 viñetas con las ideas clave.',
  chapters: 'Divide el contenido en capítulos con título descriptivo. Si hay marcas de tiempo [mm:ss], úsalas: formato "mm:ss Título".',
  post: 'Escribe una publicación para redes sociales (tono atractivo, máximo 150 palabras) y 3 citas destacadas textuales.',
  notes: 'Convierte el texto en notas estructuradas en Markdown con títulos y viñetas.',
  meeting: 'Genera el acta de la reunión en Markdown con estas secciones: Resumen ejecutivo, Decisiones tomadas, Tareas (con responsable si se menciona), Preguntas abiertas.',
  study: 'Crea apuntes de estudio: resumen, glosario de términos clave, 8 flashcards (Pregunta/Respuesta) y 5 preguntas de repaso.'
}

/** Tamaño máximo que se envía de una vez al modelo. */
const CHUNK_CHARS = 12_000
/** A partir de este tamaño el texto se parte y se une. */
const MAX_CHARS = 60_000

/** Parte el texto en trozos por párrafos, sin partir un párrafo por la mitad. */
function splitForChunks(text: string, max = CHUNK_CHARS): string[] {
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

/**
 * Genera el contenido pedido. Si el texto es largo, se procesa por partes y se
 * unen: antes se cortaba en silencio a los 60 000 caracteres y el acta salía
 * incompleta sin ningún aviso.
 */
export async function generate(action: ContentAction, text: string, lang: Lang): Promise<string> {
  const full = text.trim()
  if (full.length <= MAX_CHARS) {
    return complete(
      `${ACTIONS[action]} Escribe en ${LANG_NAME[lang]}. Usa solo información presente en el texto; no inventes. ${termsLine()}`,
      [{ role: 'user', content: full }], 0.3
    )
  }

  const chunks = splitForChunks(full)
  const partes: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    partes.push(await complete(
      `${ACTIONS[action]} Escribe en ${LANG_NAME[lang]}. Usa solo información presente en el texto; no inventes. ${termsLine()}\nEsta es la parte ${i + 1} de ${chunks.length}: no repitas lo de otras partes.`,
      [{ role: 'user', content: chunks[i] }], 0.3
    ))
  }
  // Los capítulos se concatenan; lo demás se une en un solo texto.
  if (action === 'chapters') return partes.join('\n\n')
  try {
    return await complete(
      `Une estas partes en un solo texto en ${LANG_NAME[lang]}, con las mismas secciones y sin repetir contenido. No inventes nada que no esté en las partes. ${termsLine()}`,
      [{ role: 'user', content: partes.map((p, i) => `--- Parte ${i + 1} ---\n${p}`).join('\n\n') }], 0.3
    )
  } catch {
    // Si la unión falla, al menos se entrega todo el material.
    return partes.join('\n\n')
  }
}

export async function testLLM(): Promise<string> {
  return rewrite({ text: 'hola esto es una prueba eh de conexión', lang: 'es', tone: 'neutral', mode: 'rewrite' })
}

export async function pullOllamaModel(name: string, onProgress: (pct: number, status: string) => void): Promise<void> {
  const base = getSettings().llm.baseUrl ?? 'http://127.0.0.1:11434'
  const res = await netFetch('ollama:pull', `${base}/api/pull`, { method: 'POST', body: JSON.stringify({ name, stream: true }) })
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${name}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const j = JSON.parse(line) as { status: string; total?: number; completed?: number; error?: string }
      if (j.error) throw new Error(j.error)
      onProgress(j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : 0, j.status)
    }
  }
}

export type { Lang }
