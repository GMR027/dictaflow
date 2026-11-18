import type { ChatMsg, LLMConfig, Lang } from '@shared/types'
import { createLlmTasks, type ContentAction } from '@shared/llm-tasks'
import { netFetch } from './netlog'
import { getSecret, getSettings } from './store'
import { runClaude, runOpencode } from './cli'

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
      return runClaude(flat, system, cfg.model)
    case 'opencode':
      // `--format json` evita el banner y los códigos ANSI; solo se devuelve el texto.
      return runOpencode(`${system}\n\n${flat}`, cfg.model)
  }
}

// Los prompts y la lógica de cada tarea viven en @shared/llm-tasks (los mismos en Android).
const tasks = createLlmTasks({ complete, settings: () => getSettings() })
export const { rewrite, rewriteGuarded, translate, generate, generateMinutes, testLLM } = tasks
export type { ContentAction }

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
